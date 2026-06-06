import { randomUUID } from "node:crypto";
import { makeAttemptId, makeRef, type AttemptRef } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import { attemptErr } from "./errors.js";
import { checkpointAttempt } from "./checkpoint.js";
import { finalizeAttempt, readAttemptTrace } from "./finalize.js";
import { runAttemptFlow } from "./flow.js";
import { appendAttemptEvent, attemptEventTypes, createAttemptRuntime, mutateAttempt, terminalStatus } from "./runtime.js";
import type {
  AttemptExplanation,
  AttemptPage,
  AttemptQuery,
  AttemptRecord,
  CreateAttemptInput,
  GrowAttemptRunner,
  GrowAttemptRunnerOptions
} from "./types.js";

export function createGrowAttemptRunner(options: GrowAttemptRunnerOptions): GrowAttemptRunner {
  const runtime = createAttemptRuntime(options);
  return {
    createAttempt: async (input) => {
      const intent = await options.agendaDoDManager.explainAttemptIntent(input.attemptIntentRef);
      if (!intent.ok) return intent;
      const grow = await options.growUnitManager.getGrowUnit(input.growUnitRef);
      if (!grow.ok) return grow;
      if (grow.value.lifecycle === "blocked") {
        return attemptErr({ code: "grow_unit_blocked", message: "blocked grow unit cannot start an attempt" });
      }
      if (grow.value.lifecycle === "archived") {
        return attemptErr({ code: "grow_unit_archived", message: "archived grow unit cannot start an attempt" });
      }
      const id = makeAttemptId(`attempt-${randomUUID()}`);
      const record: AttemptRecord = {
        attemptId: id,
        attemptRef: makeRef("attempt", id),
        growUnitRef: input.growUnitRef,
        attemptIntentRef: input.attemptIntentRef,
        status: "created",
        turnRefs: [],
        checkpointRefs: [],
        messageListRefs: [],
        llmRequestRefs: [],
        providerReceiptRefs: [],
        toolCallRefs: [],
        toolSettlementRefs: [],
        candidateOutputRefs: [],
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        source: input.source,
        version: input.version,
        audit: input.audit,
        recordVersion: 1,
        ...(input.modelSelection === undefined ? {} : { modelSelectionHint: input.modelSelection }),
        ...(input.requiredCapabilities === undefined ? {} : { requiredCapabilitiesHint: input.requiredCapabilities }),
        ...(input.toolCatalogQuery === undefined ? {} : { toolCatalogQueryHint: input.toolCatalogQuery })
      };
      const write = await runtime.storage.writeAttempt(record, "create attempt record");
      if (!write.ok) return write;
      const indexed = await runtime.storage.addAttempt(record.attemptRef);
      if (!indexed.ok) return indexed;
      const event = await appendAttemptEvent({
        runtime,
        record,
        eventType: attemptEventTypes.created,
        body: { attemptRef: record.attemptRef, growUnitRef: input.growUnitRef, attemptIntentRef: input.attemptIntentRef }
      });
      if (!event.ok) return event;
      const linked = await options.growUnitManager.linkAttempt(input.growUnitRef, {
        reason: "link created attempt",
        source: input.source,
        audit: input.audit,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        attempt: { attemptRef: record.attemptRef, statusSummary: "attempt created" }
      });
      return linked.ok ? ok(record.attemptRef) : linked;
    },
    runAttempt: (attemptRef, runOptions) => runAttemptFlow(runtime, attemptRef, runOptions, false),
    resumeAttempt: (attemptRef, runOptions) => runAttemptFlow(runtime, attemptRef, runOptions, true),
    cancelAttempt: (attemptRef, reason) => cancelAttempt(runtime, attemptRef, reason),
    interruptAttempt: async (attemptRef, reason) => {
      const record = await runtime.storage.readAttempt(attemptRef);
      if (!record.ok) return record;
      if (terminalStatus(record.value.status) && record.value.status !== "interrupted") {
        return attemptErr({ code: "invalid_state", message: `attempt is already ${record.value.status}` });
      }
      const next = mutateAttempt(record.value, { status: "interrupted", exitReason: "interrupted_by_process" });
      const write = await runtime.storage.writeAttempt(next, "interrupt attempt");
      if (!write.ok) return write;
      const event = await appendAttemptEvent({
        runtime,
        record: next,
        eventType: attemptEventTypes.interrupted,
        body: { reason, exitReason: "interrupted_by_process" }
      });
      if (!event.ok) return event;
      const checkpoint = await checkpointAttempt({
        runtime,
        record: next,
        phase: "before_interrupt",
        resumeInstructionSummary: reason
      });
      return checkpoint.ok ? ok(checkpoint.value.checkpoint) : checkpoint;
    },
    readAttempt: (attemptRef) => runtime.storage.readAttempt(attemptRef),
    readAttemptTrace: async (attemptRef) => {
      const record = await runtime.storage.readAttempt(attemptRef);
      return record.ok ? readAttemptTrace(runtime, record.value) : record;
    },
    listAttempts: (query) => listAttempts(runtime, query),
    explainAttempt: (attemptRef) => explainAttempt(runtime, attemptRef)
  };
}

async function cancelAttempt(
  runtime: ReturnType<typeof createAttemptRuntime>,
  attemptRef: AttemptRef,
  reason: string
): Promise<Result<AttemptRecord>> {
  const record = await runtime.storage.readAttempt(attemptRef);
  if (!record.ok) return record;
  if (terminalStatus(record.value.status)) return ok(record.value);
  const checkpoint = await checkpointAttempt({
    runtime,
    record: record.value,
    phase: "final",
    resumeInstructionSummary: `cancelled: ${reason}`
  });
  if (!checkpoint.ok) return checkpoint;
  const outcome = await finalizeAttempt({
    runtime,
    record: checkpoint.value.record,
    exitReason: "cancelled_by_user",
    status: "cancelled"
  });
  if (!outcome.ok) return outcome;
  return runtime.storage.readAttempt(attemptRef);
}

async function listAttempts(
  runtime: ReturnType<typeof createAttemptRuntime>,
  query: AttemptQuery | undefined
): Promise<Result<AttemptPage>> {
  const all = await runtime.storage.readAllAttempts();
  if (!all.ok) return all;
  let records = all.value;
  if (query?.growUnitRef !== undefined) {
    records = records.filter((record) => record.growUnitRef.id === query.growUnitRef?.id);
  }
  if (query?.status !== undefined) {
    records = records.filter((record) => record.status === query.status);
  }
  const start = query?.cursor === undefined ? 0 : Number.parseInt(query.cursor, 10);
  const limit = Math.max(1, query?.limit ?? (records.length || 1));
  const page = records.slice(start, start + limit);
  return ok({
    records: page,
    total: records.length,
    ...(start + limit >= records.length ? {} : { nextCursor: String(start + limit) }),
    truncated: start + limit < records.length
  });
}

async function explainAttempt(
  runtime: ReturnType<typeof createAttemptRuntime>,
  attemptRef: AttemptRef
): Promise<Result<AttemptExplanation>> {
  const record = await runtime.storage.readAttempt(attemptRef);
  if (!record.ok) return record;
  const latestCheckpointRef = record.value.checkpointRefs.at(-1);
  const latestCheckpoint = latestCheckpointRef === undefined
    ? undefined
    : await runtime.storage.readCheckpoint(record.value, latestCheckpointRef);
  if (latestCheckpoint !== undefined && !latestCheckpoint.ok) return latestCheckpoint;
  return ok({
    attemptRef,
    summary: `${record.value.status}${record.value.exitReason === undefined ? "" : `: ${record.value.exitReason}`}`,
    facts: [
      `growUnit=${record.value.growUnitRef.id}`,
      `attemptIntent=${record.value.attemptIntentRef.id}`,
      `turns=${record.value.turnRefs.length}`,
      `messageLists=${record.value.messageListRefs.length}`,
      `providerReceipts=${record.value.providerReceiptRefs.length}`,
      `toolSettlements=${record.value.toolSettlementRefs.length}`,
      `candidates=${record.value.candidateOutputRefs.length}`
    ],
    ...(latestCheckpoint === undefined ? {} : { latestCheckpoint: latestCheckpoint.value }),
    ...(record.value.attemptTraceRef === undefined ? {} : { traceRef: record.value.attemptTraceRef })
  });
}

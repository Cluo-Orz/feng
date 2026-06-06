import { randomUUID } from "node:crypto";
import { makeAttemptTraceId, makeAttemptOutcomeSummaryId } from "./brand.js";
import { attemptOutcomeSummaryRef } from "./refs.js";
import { registerAttemptJsonArtifact, readAttemptJsonArtifact } from "./artifacts.js";
import { sha256Text, stableStringify } from "../event-ledger/stable-json.js";
import { ok, type Result } from "../domain/result.js";
import { appendAttemptEvent, attemptEventTypes, mutateAttempt, type AttemptRuntime } from "./runtime.js";
import type {
  AttemptExitReason,
  AttemptOutcomeSummary,
  AttemptRecord,
  AttemptTraceArtifact
} from "./types.js";

export async function finalizeAttempt(input: {
  readonly runtime: AttemptRuntime;
  readonly record: AttemptRecord;
  readonly exitReason: AttemptExitReason;
  readonly status?: "completed" | "failed" | "cancelled" | "interrupted";
}): Promise<Result<AttemptOutcomeSummary>> {
  const completedAt = new Date().toISOString();
  const terminalStatus = input.status ?? (isSuccessfulExit(input.exitReason) ? "completed" : "failed");
  const trace = buildTrace(input.record, input.exitReason);
  const traceArtifact = await registerAttemptJsonArtifact({
    runtime: input.runtime,
    kind: "attempt_trace",
    content: trace,
    source: input.record.source,
    version: input.record.version,
    audit: input.record.audit,
    privacyClass: "contains_model_output",
    retentionClass: "attempt_scoped",
    parentRefs: [...input.record.providerReceiptRefs, ...input.record.toolSettlementRefs],
    correlationId: input.record.correlationId
  });
  if (!traceArtifact.ok) return traceArtifact;
  const outcomeId = makeAttemptOutcomeSummaryId(`attempt-outcome-${randomUUID()}`);
  const outcome: AttemptOutcomeSummary = {
    outcomeSummaryId: outcomeId,
    outcomeSummaryRef: attemptOutcomeSummaryRef(outcomeId),
    attemptRef: input.record.attemptRef,
    growUnitRef: input.record.growUnitRef,
    status: terminalStatus,
    exitReason: input.exitReason,
    completedTurnCount: input.record.turnRefs.length,
    candidateOutputRefs: input.record.candidateOutputRefs,
    toolSettlementRefs: input.record.toolSettlementRefs,
    providerReceiptRefs: input.record.providerReceiptRefs,
    attemptTraceRef: traceArtifact.value,
    observedIssueSummaries: observedIssues(input.exitReason),
    evidenceCandidateRefs: input.record.providerReceiptRefs,
    nextModuleHints: moduleHints(input.exitReason),
    source: input.record.source,
    audit: input.record.audit,
    createdAt: completedAt
  };
  const outcomeWrite = await input.runtime.storage.writeOutcome(outcome);
  if (!outcomeWrite.ok) return outcomeWrite;
  let record = mutateAttempt(input.record, {
    status: terminalStatus,
    completedAt,
    exitReason: input.exitReason,
    attemptTraceRef: traceArtifact.value,
    outcomeSummaryRef: outcome.outcomeSummaryRef
  });
  const recordWrite = await input.runtime.storage.writeAttempt(record, "finalize attempt");
  if (!recordWrite.ok) return recordWrite;
  const traceEvent = await appendAttemptEvent({
    runtime: input.runtime,
    record,
    eventType: attemptEventTypes.traceRegistered,
    body: { attemptTraceRef: traceArtifact.value, exitReason: input.exitReason }
  });
  if (!traceEvent.ok) return traceEvent;
  const outcomeEvent = await appendAttemptEvent({
    runtime: input.runtime,
    record,
    eventType: attemptEventTypes.outcomeRecorded,
    body: { outcomeSummaryRef: outcome.outcomeSummaryRef, status: outcome.status, exitReason: outcome.exitReason }
  });
  if (!outcomeEvent.ok) return outcomeEvent;
  const finalEventType = terminalStatus === "completed"
    ? attemptEventTypes.completed
    : terminalStatus === "cancelled"
      ? attemptEventTypes.cancelled
      : terminalStatus === "interrupted"
        ? attemptEventTypes.interrupted
        : attemptEventTypes.failed;
  const finalEvent = await appendAttemptEvent({
    runtime: input.runtime,
    record,
    eventType: finalEventType,
    body: { status: terminalStatus, exitReason: input.exitReason }
  });
  if (!finalEvent.ok) return finalEvent;
  await input.runtime.options.growUnitManager.linkAttempt(input.record.growUnitRef, {
    reason: "record attempt outcome",
    source: input.record.source,
    audit: input.record.audit,
    ...(input.record.correlationId === undefined ? {} : { correlationId: input.record.correlationId }),
    attempt: {
      attemptRef: input.record.attemptRef,
      statusSummary: `${terminalStatus}: ${input.exitReason}`,
      ...(input.record.startedAt === undefined ? {} : { startedAt: input.record.startedAt }),
      exitReason: input.exitReason
    }
  });
  return ok(outcome);
}

export async function readAttemptTrace(
  runtime: AttemptRuntime,
  record: AttemptRecord
): Promise<Result<AttemptTraceArtifact>> {
  if (record.attemptTraceRef === undefined) {
    return {
      ok: false,
      error: {
        code: "not_found",
        message: "attempt trace is not registered",
        module: "grow-attempt-runner",
        severity: "error",
        retryable: false
      }
    };
  }
  return readAttemptJsonArtifact<AttemptTraceArtifact>({
    runtime,
    artifactRef: record.attemptTraceRef,
    reason: "read attempt trace"
  });
}

function buildTrace(record: AttemptRecord, exitReason: AttemptExitReason): AttemptTraceArtifact {
  const traceWithoutHash = {
    attemptTraceId: makeAttemptTraceId(`attempt-trace-${randomUUID()}`),
    attemptRef: record.attemptRef,
    growUnitRef: record.growUnitRef,
    ...(record.inputSnapshotRef === undefined ? {} : { inputSnapshotRef: record.inputSnapshotRef }),
    ...(record.executionPlanRef === undefined ? {} : { executionPlanRef: record.executionPlanRef }),
    turnRefs: record.turnRefs,
    checkpointRefs: record.checkpointRefs,
    eventRefs: [],
    messageListRefs: record.messageListRefs,
    providerReceiptRefs: record.providerReceiptRefs,
    toolSettlementRefs: record.toolSettlementRefs,
    candidateOutputRefs: record.candidateOutputRefs,
    exitReason,
    source: record.source,
    audit: record.audit
  };
  return {
    ...traceWithoutHash,
    contentHash: sha256Text(stableStringify(traceWithoutHash))
  };
}

function isSuccessfulExit(exit: AttemptExitReason): boolean {
  return exit === "completed_no_tool_calls" || exit === "completed_after_tool_settlement" || exit === "stop_condition_reached";
}

function observedIssues(exit: AttemptExitReason): readonly string[] {
  if (isSuccessfulExit(exit)) return [];
  return [`attempt exited with ${exit}`];
}

function moduleHints(exit: AttemptExitReason): readonly string[] {
  if (exit === "context_compile_failed") return ["Agenda DoD Manager may need narrower context or gap resolution"];
  if (exit === "policy_blocked" || exit === "approval_required") return ["Policy Boundary or Admission may need explicit approval"];
  if (exit === "tool_failed") return ["Tool Runtime settlement should be inspected before next attempt"];
  if (exit === "max_turns_reached" || exit === "max_tool_calls_reached") return ["Agenda may need smaller attempt intent"];
  return [];
}

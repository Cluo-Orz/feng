import { ok, type Result } from "../domain/result.js";
import type { EventAppendReceipt } from "../event-ledger/index.js";
import type { WriteReceipt } from "../file-store/index.js";
import { getAgendaRecord } from "./agenda-flow.js";
import { agendaEventTypes } from "./events.js";
import { agendaErr } from "./errors.js";
import {
  assertGapMutable,
  assertNoDuplicateOpenGap,
  compact,
  isOpenGap,
  matchesGapQuery,
  newGapRef,
  nonEmpty,
  paginate,
  updatedAgenda,
  withAgendaRef
} from "./logic.js";
import type { AgendaRuntime } from "./runtime.js";
import { appendAgendaEvent, ensureGrowUnitWritable } from "./runtime.js";
import type { AgendaReceipt, GapRecord, GapRef, GapUpdateInput, Page, PageQuery, RecordGapInput } from "./types.js";

export async function recordGapRecord(
  runtime: AgendaRuntime,
  growUnitRef: GapRecord["growUnitRef"],
  input: RecordGapInput
): Promise<Result<GapRef>> {
  const summary = nonEmpty(input.summary, "summary");
  if (!summary.ok) return summary;
  const writable = await ensureGrowUnitWritable(runtime, growUnitRef);
  if (!writable.ok) return writable;
  const agenda = await getAgendaRecord(runtime, growUnitRef);
  if (!agenda.ok) return agenda;
  const gaps = await runtime.storage.readAllGaps();
  if (!gaps.ok) return gaps;
  const duplicate = assertNoDuplicateOpenGap(gaps.value, { growUnitRef, kind: input.kind, summary: summary.value });
  if (!duplicate.ok) return duplicate;
  const gapRef = newGapRef();
  const now = new Date().toISOString();
  const record: GapRecord = {
    gapId: gapRef.id,
    gapRef,
    growUnitRef,
    kind: input.kind,
    status: "open",
    summary: summary.value,
    requiredInput: compact(input.requiredInput, 2_000),
    requiredEvidence: compact(input.requiredEvidence, 2_000),
    blockingReason: compact(input.blockingReason, 2_000),
    relatedAdmissionRefs: input.relatedAdmissionRefs ?? [],
    relatedFeedbackRefs: input.relatedFeedbackRefs ?? [],
    relatedPolicyDecisionRefs: input.relatedPolicyDecisionRefs ?? [],
    attemptCount: 0,
    retryLimit: Math.max(1, Math.floor(input.retryLimit ?? 3)),
    source: input.source,
    audit: input.audit,
    createdAt: now,
    updatedAt: now,
    recordVersion: 1
  };
  const agendaRecord = updatedAgenda(agenda.value, { gapRefs: withAgendaRef(agenda.value.gapRefs, gapRef) });
  const event = await appendAgendaEvent({
    runtime,
    growUnitRef,
    eventType: agendaEventTypes.gapRecorded,
    body: { record, agendaRecord },
    source: input.source,
    audit: input.audit
  });
  if (!event.ok) return event;
  const write = await writeGapMutation(runtime, record, agendaRecord, "write recorded gap", true);
  return write.ok ? ok(gapRef) : write;
}

export function updateGapRecord(
  runtime: AgendaRuntime,
  gapRef: GapRef,
  input: GapUpdateInput
): Promise<Result<AgendaReceipt>> {
  return mutateGap(runtime, gapRef, input, agendaEventTypes.gapUpdated);
}

export function resolveGapRecordForNow(
  runtime: AgendaRuntime,
  gapRef: GapRef,
  input: GapUpdateInput
): Promise<Result<AgendaReceipt>> {
  return mutateGap(runtime, gapRef, { ...input, status: "resolved_for_now" }, agendaEventTypes.gapResolvedForNow);
}

export async function listOpenGapRecords(
  runtime: AgendaRuntime,
  growUnitRef: GapRecord["growUnitRef"],
  query: PageQuery<GapRecord["status"]> = {}
): Promise<Result<Page<GapRecord>>> {
  const gaps = await runtime.storage.readAllGaps();
  if (!gaps.ok) return gaps;
  const selected = gaps.value
    .filter((gap) => gap.growUnitRef.id === growUnitRef.id)
    .filter((gap) => query.status !== undefined || isOpenGap(gap))
    .filter((gap) => matchesGapQuery(gap, query))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const page = paginate(selected, query);
  return ok({
    records: page.page,
    total: page.total,
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    truncated: page.truncated
  });
}

async function mutateGap(
  runtime: AgendaRuntime,
  ref: GapRef,
  input: GapUpdateInput,
  eventType: string
): Promise<Result<AgendaReceipt>> {
  const current = await runtime.storage.readGap(ref);
  if (!current.ok) return current;
  const mutable = assertGapMutable(current.value);
  if (!mutable.ok) return mutable;
  const writable = await ensureGrowUnitWritable(runtime, current.value.growUnitRef);
  if (!writable.ok) return writable;
  const agenda = await getAgendaRecord(runtime, current.value.growUnitRef);
  if (!agenda.ok) return agenda;
  const updated = updatedGap(current.value, input);
  if (!updated.ok) return updated;
  const agendaRecord = updatedAgenda(agenda.value, {});
  const event = await appendAgendaEvent({
    runtime,
    growUnitRef: current.value.growUnitRef,
    eventType,
    body: { gapRef: ref, from: current.value.status, to: updated.value.status, record: updated.value, agendaRecord },
    source: input.source,
    audit: input.audit
  });
  if (!event.ok) return event;
  const write = await writeGapMutation(runtime, updated.value, agendaRecord, `write ${eventType}`, false);
  return write.ok ? ok({ ref, eventReceipt: event.value, recordWriteReceipt: write.value }) : write;
}

function updatedGap(record: GapRecord, input: GapUpdateInput): Result<GapRecord> {
  const nextAttemptCount = record.attemptCount + (input.incrementAttempt === true ? 1 : 0);
  if (nextAttemptCount > record.retryLimit) {
    return agendaErr({ code: "retry_limit_reached", message: `retry limit reached for gap ${record.gapId}` });
  }
  const status = input.status ?? (nextAttemptCount >= record.retryLimit ? "blocked" : record.status);
  return ok({
    ...record,
    status,
    ...(input.summary === undefined ? {} : { summary: compact(input.summary, 4_000) }),
    ...(input.requiredInput === undefined ? {} : { requiredInput: compact(input.requiredInput, 2_000) }),
    ...(input.requiredEvidence === undefined ? {} : { requiredEvidence: compact(input.requiredEvidence, 2_000) }),
    ...(input.blockingReason === undefined ? {} : { blockingReason: compact(input.blockingReason, 2_000) }),
    attemptCount: nextAttemptCount,
    source: input.source,
    audit: input.audit,
    updatedAt: new Date().toISOString(),
    recordVersion: record.recordVersion + 1
  });
}

async function writeGapMutation(
  runtime: AgendaRuntime,
  record: GapRecord,
  agendaRecord: Parameters<typeof runtime.storage.writeAgenda>[0],
  reason: string,
  addIndex: boolean
): Promise<Result<WriteReceipt>> {
  const gap = await runtime.storage.writeGap(record, reason);
  if (!gap.ok) return gap;
  const agenda = await runtime.storage.writeAgenda(agendaRecord, "write agenda after gap change");
  if (!agenda.ok) return agenda;
  if (!addIndex) return ok(gap.value);
  const index = await runtime.storage.addGap(record.gapRef);
  return index.ok ? ok(gap.value) : index;
}

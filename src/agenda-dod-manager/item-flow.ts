import { ok, type Result } from "../domain/result.js";
import type { EventAppendReceipt } from "../event-ledger/index.js";
import type { WriteReceipt } from "../file-store/index.js";
import { getAgendaRecord } from "./agenda-flow.js";
import { agendaEventTypes } from "./events.js";
import {
  assertItemMutable,
  compact,
  newAgendaItemRef,
  nonEmpty,
  normalizeRetryPolicy,
  updatedAgenda,
  withAgendaRef
} from "./logic.js";
import { ensureArtifacts, ensureInputArtifacts, ensureKnownDoD, ensureKnownGaps } from "./ref-validation.js";
import type { AgendaRuntime } from "./runtime.js";
import { appendAgendaEvent, ensureGrowUnitWritable } from "./runtime.js";
import type {
  AgendaItemRecord,
  AgendaItemRef,
  AgendaItemUpdateInput,
  AgendaReceipt,
  ProposeAgendaItemInput
} from "./types.js";

export async function proposeAgendaItemRecord(
  runtime: AgendaRuntime,
  growUnitRef: AgendaItemRecord["growUnitRef"],
  input: ProposeAgendaItemInput
): Promise<Result<AgendaItemRef>> {
  const checked = await validateItemRefs(runtime, input.inputRefs ?? [], input.relatedGapRefs ?? [], input.relatedDoDRefs ?? [], input.evidenceRequirementRefs ?? []);
  if (!checked.ok) return checked;
  const summary = nonEmpty(input.summary, "summary");
  if (!summary.ok) return summary;
  const agenda = await getAgendaRecord(runtime, growUnitRef);
  if (!agenda.ok) return agenda;
  const writable = await ensureGrowUnitWritable(runtime, growUnitRef);
  if (!writable.ok) return writable;
  const agendaItemRef = newAgendaItemRef();
  const now = new Date().toISOString();
  const record: AgendaItemRecord = {
    agendaItemId: agendaItemRef.id,
    agendaItemRef,
    growUnitRef,
    kind: input.kind,
    status: "proposed",
    summary: summary.value,
    reason: compact(input.reason, 2_000),
    inputRefs: input.inputRefs ?? [],
    relatedGapRefs: input.relatedGapRefs ?? [],
    relatedDoDRefs: input.relatedDoDRefs ?? [],
    expectedOutput: compact(input.expectedOutput, 2_000),
    evidenceRequirementRefs: input.evidenceRequirementRefs ?? [],
    attemptIntentRefs: [],
    priority: input.priority ?? "medium",
    retryPolicy: normalizeRetryPolicy(input.retryPolicy),
    source: input.source,
    audit: input.audit,
    createdAt: now,
    updatedAt: now,
    recordVersion: 1
  };
  const agendaRecord = updatedAgenda(agenda.value, {
    agendaItemRefs: withAgendaRef(agenda.value.agendaItemRefs, agendaItemRef)
  });
  const event = await appendAgendaEvent({
    runtime,
    growUnitRef,
    eventType: agendaEventTypes.agendaItemProposed,
    body: { record, agendaRecord },
    source: input.source,
    audit: input.audit
  });
  if (!event.ok) return event;
  const write = await writeItemMutation(runtime, record, agendaRecord, "write proposed agenda item", true);
  return write.ok ? ok(agendaItemRef) : write;
}

export function activateAgendaItemRecord(
  runtime: AgendaRuntime,
  ref: AgendaItemRef,
  input: AgendaItemUpdateInput
): Promise<Result<AgendaReceipt>> {
  return mutateAgendaItem(runtime, ref, { ...input, status: "active" }, agendaEventTypes.agendaItemActivated);
}

export function updateAgendaItemRecord(
  runtime: AgendaRuntime,
  ref: AgendaItemRef,
  input: AgendaItemUpdateInput
): Promise<Result<AgendaReceipt>> {
  const eventType = input.status === "blocked" ? agendaEventTypes.agendaItemBlocked : agendaEventTypes.agendaItemUpdated;
  return mutateAgendaItem(runtime, ref, input, eventType);
}

export function retireAgendaItemRecord(
  runtime: AgendaRuntime,
  ref: AgendaItemRef,
  input: AgendaItemUpdateInput
): Promise<Result<AgendaReceipt>> {
  return mutateAgendaItem(runtime, ref, { ...input, status: "retired" }, agendaEventTypes.agendaItemRetired);
}

async function mutateAgendaItem(
  runtime: AgendaRuntime,
  ref: AgendaItemRef,
  input: AgendaItemUpdateInput,
  eventType: string
): Promise<Result<AgendaReceipt>> {
  const current = await runtime.storage.readAgendaItem(ref);
  if (!current.ok) return current;
  const mutable = assertItemMutable(current.value);
  if (!mutable.ok) return mutable;
  const checked = await validateItemRefs(runtime, [], input.relatedGapRefs ?? [], input.relatedDoDRefs ?? [], input.evidenceRequirementRefs ?? []);
  if (!checked.ok) return checked;
  const writable = await ensureGrowUnitWritable(runtime, current.value.growUnitRef);
  if (!writable.ok) return writable;
  const agenda = await getAgendaRecord(runtime, current.value.growUnitRef);
  if (!agenda.ok) return agenda;
  const updated = updatedItem(current.value, input);
  const agendaRecord = updated.status === "active"
    ? updatedAgenda(agenda.value, { currentFocus: updated.summary })
    : updatedAgenda(agenda.value, {});
  const event = await appendAgendaEvent({
    runtime,
    growUnitRef: updated.growUnitRef,
    eventType,
    body: { agendaItemRef: ref, from: current.value.status, to: updated.status, record: updated, agendaRecord },
    source: input.source,
    audit: input.audit
  });
  if (!event.ok) return event;
  const write = await writeItemMutation(runtime, updated, agendaRecord, `write ${eventType}`, false);
  return write.ok ? ok(receipt(ref, event.value, write.value)) : write;
}

function updatedItem(record: AgendaItemRecord, input: AgendaItemUpdateInput): AgendaItemRecord {
  return {
    ...record,
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.summary === undefined ? {} : { summary: compact(input.summary, 4_000) }),
    reason: compact(input.reason, 2_000),
    ...(input.relatedGapRefs === undefined ? {} : { relatedGapRefs: input.relatedGapRefs }),
    ...(input.relatedDoDRefs === undefined ? {} : { relatedDoDRefs: input.relatedDoDRefs }),
    ...(input.expectedOutput === undefined ? {} : { expectedOutput: compact(input.expectedOutput, 2_000) }),
    ...(input.evidenceRequirementRefs === undefined ? {} : { evidenceRequirementRefs: input.evidenceRequirementRefs }),
    ...(input.priority === undefined ? {} : { priority: input.priority }),
    source: input.source,
    audit: input.audit,
    updatedAt: new Date().toISOString(),
    recordVersion: record.recordVersion + 1
  };
}

async function validateItemRefs(
  runtime: AgendaRuntime,
  inputRefs: ProposeAgendaItemInput["inputRefs"],
  gapRefs: ProposeAgendaItemInput["relatedGapRefs"],
  dodRefs: ProposeAgendaItemInput["relatedDoDRefs"],
  evidenceRefs: ProposeAgendaItemInput["evidenceRequirementRefs"]
): Promise<Result<void>> {
  const input = await ensureInputArtifacts(runtime, inputRefs ?? []);
  if (!input.ok) return input;
  const evidence = await ensureArtifacts(runtime, evidenceRefs ?? []);
  if (!evidence.ok) return evidence;
  const gaps = await ensureKnownGaps(runtime, gapRefs ?? []);
  if (!gaps.ok) return gaps;
  const dod = await ensureKnownDoD(runtime, dodRefs ?? []);
  return dod.ok ? ok(undefined) : dod;
}

async function writeItemMutation(
  runtime: AgendaRuntime,
  record: AgendaItemRecord,
  agendaRecord: Parameters<typeof runtime.storage.writeAgenda>[0],
  reason: string,
  addIndex: boolean
): Promise<Result<WriteReceipt>> {
  const item = await runtime.storage.writeAgendaItem(record, reason);
  if (!item.ok) return item;
  const agenda = await runtime.storage.writeAgenda(agendaRecord, "write agenda after item change");
  if (!agenda.ok) return agenda;
  if (!addIndex) return ok(item.value);
  const index = await runtime.storage.addAgendaItem(record.agendaItemRef);
  return index.ok ? ok(item.value) : index;
}

function receipt(ref: AgendaItemRef, eventReceipt: EventAppendReceipt, recordWriteReceipt: WriteReceipt): AgendaReceipt {
  return { ref, eventReceipt, recordWriteReceipt };
}

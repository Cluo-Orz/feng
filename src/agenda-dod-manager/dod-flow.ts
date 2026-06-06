import type { ArtifactRef } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import type { EventAppendReceipt } from "../event-ledger/index.js";
import type { WriteReceipt } from "../file-store/index.js";
import { getAgendaRecord } from "./agenda-flow.js";
import { agendaEventTypes } from "./events.js";
import {
  assertDoDMutable,
  compact,
  newDoDRef,
  nonEmpty,
  updatedAgenda,
  withAgendaRef
} from "./logic.js";
import { ensureArtifacts, ensureKnownGaps } from "./ref-validation.js";
import type { AgendaRuntime } from "./runtime.js";
import { appendAgendaEvent, ensureGrowUnitWritable } from "./runtime.js";
import type { AgendaReceipt, DefineDoDInput, DoDItemRecord, DoDRef, DoDRevisionInput } from "./types.js";

export async function defineDoDRecord(
  runtime: AgendaRuntime,
  growUnitRef: DoDItemRecord["growUnitRef"],
  input: DefineDoDInput
): Promise<Result<DoDRef>> {
  const valid = await validateDoDInput(runtime, input);
  if (!valid.ok) return valid;
  const writable = await ensureGrowUnitWritable(runtime, growUnitRef);
  if (!writable.ok) return writable;
  const agenda = await getAgendaRecord(runtime, growUnitRef);
  if (!agenda.ok) return agenda;
  const dodRef = newDoDRef();
  const now = new Date().toISOString();
  const record: DoDItemRecord = {
    dodId: dodRef.id,
    dodRef,
    growUnitRef,
    statement: compact(input.statement, 4_000),
    scope: compact(input.scope, 2_000),
    evidenceRequirement: compact(input.evidenceRequirement, 4_000),
    validationIntent: compact(input.validationIntent, 2_000),
    ...(input.targetWorldSummaryRef === undefined ? {} : { targetWorldSummaryRef: input.targetWorldSummaryRef }),
    relatedAgendaItemRefs: input.relatedAgendaItemRefs ?? [],
    relatedGapRefs: input.relatedGapRefs ?? [],
    lifecycle: "active",
    source: input.source,
    version: input.version,
    audit: input.audit,
    createdAt: now,
    updatedAt: now,
    recordVersion: 1
  };
  const agendaRecord = updatedAgenda(agenda.value, { dodRefs: withAgendaRef(agenda.value.dodRefs, dodRef) });
  const event = await appendAgendaEvent({
    runtime,
    growUnitRef,
    eventType: agendaEventTypes.dodDefined,
    body: { record, agendaRecord },
    source: input.source,
    audit: input.audit
  });
  if (!event.ok) return event;
  const written = await writeDoDMutation(runtime, record, agendaRecord, "write dod", true);
  return written.ok ? ok(dodRef) : written;
}

export async function reviseDoDRecord(
  runtime: AgendaRuntime,
  dodRef: DoDRef,
  input: DoDRevisionInput
): Promise<Result<AgendaReceipt>> {
  const current = await runtime.storage.readDoD(dodRef);
  if (!current.ok) return current;
  const mutable = assertDoDMutable(current.value);
  if (!mutable.ok) return mutable;
  const valid = await validateDoDRevision(runtime, current.value, input);
  if (!valid.ok) return valid;
  const writable = await ensureGrowUnitWritable(runtime, current.value.growUnitRef);
  if (!writable.ok) return writable;
  const agenda = await getAgendaRecord(runtime, current.value.growUnitRef);
  if (!agenda.ok) return agenda;
  const now = new Date().toISOString();
  const replacementRef = newDoDRef();
  const superseded = {
    ...current.value,
    lifecycle: "superseded" as const,
    updatedAt: now,
    recordVersion: current.value.recordVersion + 1
  };
  const replacement = revisedRecord(current.value, replacementRef, input, now);
  const agendaRecord = updatedAgenda(agenda.value, {
    dodRefs: withAgendaRef(agenda.value.dodRefs, replacementRef)
  });
  const event = await appendAgendaEvent({
    runtime,
    growUnitRef: current.value.growUnitRef,
    eventType: agendaEventTypes.dodRevised,
    body: { dodRef, replacementRef, record: replacement, supersededRecord: superseded, agendaRecord },
    source: input.source,
    audit: input.audit
  });
  if (!event.ok) return event;
  const written = await writeDoDRevision(runtime, superseded, replacement, agendaRecord);
  return written.ok ? ok({ ref: replacementRef, eventReceipt: event.value, recordWriteReceipt: written.value }) : written;
}

export function retireDoDRecord(
  runtime: AgendaRuntime,
  dodRef: DoDRef,
  input: DoDRevisionInput
): Promise<Result<AgendaReceipt>> {
  return mutateDoD(runtime, dodRef, input, "retired", agendaEventTypes.dodRetired);
}

export async function linkDoDEvaluationRecord(
  runtime: AgendaRuntime,
  dodRef: DoDRef,
  evaluationRef: ArtifactRef,
  input: DoDRevisionInput
): Promise<Result<AgendaReceipt>> {
  const checked = await ensureArtifacts(runtime, [evaluationRef]);
  if (!checked.ok) return checked;
  return mutateDoD(runtime, dodRef, input, undefined, agendaEventTypes.dodEvaluationLinked, evaluationRef);
}

export async function listActiveDoDRecords(
  runtime: AgendaRuntime,
  growUnitRef: DoDItemRecord["growUnitRef"]
): Promise<Result<readonly DoDItemRecord[]>> {
  const records = await runtime.storage.readAllDoD();
  if (!records.ok) return records;
  return ok(records.value.filter((record) => record.growUnitRef.id === growUnitRef.id && record.lifecycle === "active"));
}

async function mutateDoD(
  runtime: AgendaRuntime,
  dodRef: DoDRef,
  input: DoDRevisionInput,
  lifecycle: DoDItemRecord["lifecycle"] | undefined,
  eventType: string,
  evaluationRef?: ArtifactRef
): Promise<Result<AgendaReceipt>> {
  const current = await runtime.storage.readDoD(dodRef);
  if (!current.ok) return current;
  const mutable = assertDoDMutable(current.value);
  if (!mutable.ok) return mutable;
  const writable = await ensureGrowUnitWritable(runtime, current.value.growUnitRef);
  if (!writable.ok) return writable;
  const agenda = await getAgendaRecord(runtime, current.value.growUnitRef);
  if (!agenda.ok) return agenda;
  const record = updatedDoD(current.value, input, lifecycle, evaluationRef);
  const agendaRecord = updatedAgenda(agenda.value, {
    latestEvaluationRefs: evaluationRef === undefined
      ? agenda.value.latestEvaluationRefs
      : withAgendaRef(agenda.value.latestEvaluationRefs, evaluationRef)
  });
  const event = await appendAgendaEvent({
    runtime,
    growUnitRef: current.value.growUnitRef,
    eventType,
    body: { dodRef, record, agendaRecord, evaluationRef },
    source: input.source,
    audit: input.audit
  });
  if (!event.ok) return event;
  const written = await writeDoDMutation(runtime, record, agendaRecord, `write ${eventType}`, false);
  return written.ok ? ok({ ref: dodRef, eventReceipt: event.value, recordWriteReceipt: written.value }) : written;
}

async function validateDoDInput(runtime: AgendaRuntime, input: DefineDoDInput): Promise<Result<void>> {
  const required = [nonEmpty(input.statement, "statement"), nonEmpty(input.evidenceRequirement, "evidenceRequirement")];
  const failed = required.find((item) => !item.ok);
  if (failed !== undefined && !failed.ok) return failed;
  const artifacts = await ensureArtifacts(runtime, input.targetWorldSummaryRef === undefined ? [] : [input.targetWorldSummaryRef]);
  if (!artifacts.ok) return artifacts;
  const gaps = await ensureKnownGaps(runtime, input.relatedGapRefs ?? []);
  return gaps.ok ? ok(undefined) : gaps;
}

async function validateDoDRevision(
  runtime: AgendaRuntime,
  current: DoDItemRecord,
  input: DoDRevisionInput
): Promise<Result<void>> {
  return validateDoDInput(runtime, {
    statement: input.statement ?? current.statement,
    scope: input.scope ?? current.scope,
    evidenceRequirement: input.evidenceRequirement ?? current.evidenceRequirement,
    validationIntent: input.validationIntent ?? current.validationIntent,
    ...(input.targetWorldSummaryRef === undefined ? {} : { targetWorldSummaryRef: input.targetWorldSummaryRef }),
    relatedAgendaItemRefs: input.relatedAgendaItemRefs ?? current.relatedAgendaItemRefs,
    relatedGapRefs: input.relatedGapRefs ?? current.relatedGapRefs,
    source: input.source,
    version: input.version ?? current.version,
    audit: input.audit
  });
}

function revisedRecord(current: DoDItemRecord, dodRef: DoDRef, input: DoDRevisionInput, now: string): DoDItemRecord {
  return {
    ...current,
    dodId: dodRef.id,
    dodRef,
    statement: compact(input.statement ?? current.statement, 4_000),
    scope: compact(input.scope ?? current.scope, 2_000),
    evidenceRequirement: compact(input.evidenceRequirement ?? current.evidenceRequirement, 4_000),
    validationIntent: compact(input.validationIntent ?? current.validationIntent, 2_000),
    ...(input.targetWorldSummaryRef === undefined ? {} : { targetWorldSummaryRef: input.targetWorldSummaryRef }),
    relatedAgendaItemRefs: input.relatedAgendaItemRefs ?? current.relatedAgendaItemRefs,
    relatedGapRefs: input.relatedGapRefs ?? current.relatedGapRefs,
    lifecycle: input.lifecycle ?? current.lifecycle,
    version: input.version ?? current.version,
    source: input.source,
    audit: input.audit,
    createdAt: now,
    updatedAt: now,
    recordVersion: 1
  };
}

function updatedDoD(
  record: DoDItemRecord,
  input: DoDRevisionInput,
  lifecycle: DoDItemRecord["lifecycle"] | undefined,
  evaluationRef: ArtifactRef | undefined
): DoDItemRecord {
  return {
    ...record,
    ...(lifecycle === undefined ? {} : { lifecycle }),
    ...(evaluationRef === undefined ? {} : { latestEvaluationRef: evaluationRef }),
    source: input.source,
    audit: input.audit,
    updatedAt: new Date().toISOString(),
    recordVersion: record.recordVersion + 1
  };
}

async function writeDoDMutation(
  runtime: AgendaRuntime,
  record: DoDItemRecord,
  agendaRecord: Parameters<typeof runtime.storage.writeAgenda>[0],
  reason: string,
  addIndex: boolean
): Promise<Result<WriteReceipt>> {
  const dod = await runtime.storage.writeDoD(record, reason);
  if (!dod.ok) return dod;
  const agenda = await runtime.storage.writeAgenda(agendaRecord, "write agenda after dod change");
  if (!agenda.ok) return agenda;
  if (!addIndex) return ok(dod.value);
  const index = await runtime.storage.addDoD(record.dodRef);
  return index.ok ? ok(dod.value) : index;
}

async function writeDoDRevision(
  runtime: AgendaRuntime,
  superseded: DoDItemRecord,
  replacement: DoDItemRecord,
  agendaRecord: Parameters<typeof runtime.storage.writeAgenda>[0]
): Promise<Result<WriteReceipt>> {
  const oldWrite = await runtime.storage.writeDoD(superseded, "supersede dod");
  if (!oldWrite.ok) return oldWrite;
  const newWrite = await writeDoDMutation(runtime, replacement, agendaRecord, "write revised dod", true);
  return newWrite.ok ? ok(newWrite.value) : newWrite;
}

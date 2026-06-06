import type { ArtifactRef, GrowUnitRef } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import type { WriteReceipt } from "../file-store/index.js";
import { getAgendaRecord } from "./agenda-flow.js";
import { agendaEventTypes } from "./events.js";
import { assertRetryBudget, compact, isOpenGap, newAttemptIntentRef, updatedAgenda, withAgendaRef } from "./logic.js";
import type { AgendaRuntime } from "./runtime.js";
import { appendAgendaEvent, ensureGrowUnitWritable } from "./runtime.js";
import type {
  ActiveSkillSummary,
  AgendaInputRef,
  AgendaItemRecord,
  AttemptIntentOptions,
  AttemptIntentRecord,
  AttemptIntentRef,
  DoDItemRecord,
  GapRecord
} from "./types.js";

export async function buildAttemptIntentRecord(
  runtime: AgendaRuntime,
  growUnitRef: GrowUnitRef,
  options: AttemptIntentOptions
): Promise<Result<AttemptIntentRef>> {
  const writable = await ensureGrowUnitWritable(runtime, growUnitRef);
  if (!writable.ok) return writable;
  const agenda = await getAgendaRecord(runtime, growUnitRef);
  if (!agenda.ok) return agenda;
  const [items, gaps, dod] = await readGrowRecords(runtime, growUnitRef);
  if (!items.ok) return items;
  if (!gaps.ok) return gaps;
  if (!dod.ok) return dod;
  const openGaps = gaps.value.filter(isOpenGap);
  const retryBudget = assertRetryBudget(openGaps);
  if (!retryBudget.ok) return retryBudget;
  const skills = await activeSkillSummaries(runtime, growUnitRef);
  if (!skills.ok) return skills;
  const admission = await runtime.options.admissionInbox.buildAdmissionSummary(growUnitRef);
  if (!admission.ok) return admission;
  const focusItems = items.value.filter((item) => item.status === "active");
  const attemptIntentRef = newAttemptIntentRef();
  const record: AttemptIntentRecord = {
    attemptIntentId: attemptIntentRef.id,
    attemptIntentRef,
    growUnitRef,
    purpose: compact(options.purpose ?? defaultPurpose(agenda.value.currentFocus, focusItems, openGaps), 2_000),
    focusAgendaItemRefs: focusItems.map((item) => item.agendaItemRef),
    inputCandidateRefs: inputCandidateRefs(focusItems, openGaps, admission.value.latestInboxRefs, admission.value.latestFeedbackRefs),
    requiredContextRefs: requiredContextRefs(focusItems, dod.value),
    visibleSkillScopeSummary: skills.value,
    toolNeedSummary: compact(options.toolNeedSummary ?? defaultToolNeed(openGaps), 2_000),
    policyBoundarySummary: compact(options.policyBoundarySummary ?? "agenda-only intent; no tool or lifecycle mutation authorized", 2_000),
    expectedOutputs: expectedOutputs(focusItems, openGaps),
    expectedEvidence: expectedEvidence(focusItems, openGaps, dod.value),
    stopCondition: compact(options.stopCondition ?? defaultStopCondition(openGaps), 2_000),
    source: options.source,
    audit: options.audit,
    createdAt: new Date().toISOString()
  };
  const agendaRecord = updatedAgenda(agenda.value, { attemptIntentRef, currentFocus: record.purpose });
  const updatedItems = focusItems.map((item) => ({
    ...item,
    attemptIntentRefs: withAgendaRef(item.attemptIntentRefs, attemptIntentRef),
    updatedAt: new Date().toISOString(),
    recordVersion: item.recordVersion + 1
  }));
  const event = await appendAgendaEvent({
    runtime,
    growUnitRef,
    eventType: agendaEventTypes.attemptIntentCreated,
    body: { record, agendaRecord, focusAgendaItemRefs: record.focusAgendaItemRefs },
    source: options.source,
    audit: options.audit
  });
  if (!event.ok) return event;
  const written = await writeIntentMutation(runtime, record, agendaRecord, updatedItems);
  return written.ok ? ok(attemptIntentRef) : written;
}

export function explainAttemptIntentRecord(
  runtime: AgendaRuntime,
  attemptIntentRef: AttemptIntentRef
): Promise<Result<AttemptIntentRecord>> {
  return runtime.storage.readAttemptIntent(attemptIntentRef);
}

async function readGrowRecords(runtime: AgendaRuntime, growUnitRef: GrowUnitRef) {
  const items = await runtime.storage.readAllAgendaItems();
  const gaps = await runtime.storage.readAllGaps();
  const dod = await runtime.storage.readAllDoD();
  return [
    items.ok ? ok(items.value.filter((item) => item.growUnitRef.id === growUnitRef.id)) : items,
    gaps.ok ? ok(gaps.value.filter((gap) => gap.growUnitRef.id === growUnitRef.id)) : gaps,
    dod.ok ? ok(dod.value.filter((item) => item.growUnitRef.id === growUnitRef.id && item.lifecycle === "active")) : dod
  ] as const;
}

async function activeSkillSummaries(runtime: AgendaRuntime, growUnitRef: GrowUnitRef): Promise<Result<readonly ActiveSkillSummary[]>> {
  const grow = await runtime.options.growUnitManager.getGrowUnit(growUnitRef);
  if (!grow.ok) return grow;
  const scopes = [
    { workspace: grow.value.workspace },
    { workspace: grow.value.workspace, growUnit: grow.value.growUnitId },
    { workspace: grow.value.workspace, systemDefault: true }
  ];
  const byId = new Map<string, ActiveSkillSummary>();
  for (const scope of scopes) {
    const active = await runtime.options.skillRegistry.listActiveSkills(scope);
    if (!active.ok) return active;
    for (const item of active.value.skills) {
      byId.set(item.record.skillId, {
        skillRef: item.record.skillRef,
        name: item.record.name,
        family: item.record.family,
        version: item.record.version
      });
    }
  }
  return ok([...byId.values()]);
}

function inputCandidateRefs(
  items: readonly AgendaItemRecord[],
  gaps: readonly GapRecord[],
  inbox: readonly AgendaInputRef[],
  feedback: readonly AgendaInputRef[]
): readonly AgendaInputRef[] {
  const refs = new Map<string, AgendaInputRef>();
  for (const ref of [...inbox, ...feedback]) refs.set(`${ref.kind}:${ref.id}`, ref);
  for (const item of items) for (const ref of item.inputRefs) refs.set(`${ref.kind}:${ref.id}`, ref);
  for (const gap of gaps) {
    for (const ref of gap.relatedAdmissionRefs) refs.set(`${ref.kind}:${ref.id}`, ref);
    for (const ref of gap.relatedFeedbackRefs) refs.set(`${ref.kind}:${ref.id}`, ref);
  }
  return [...refs.values()];
}

function requiredContextRefs(items: readonly AgendaItemRecord[], dod: readonly DoDItemRecord[]): readonly ArtifactRef[] {
  const refs = new Map<string, ArtifactRef>();
  for (const item of items) {
    for (const ref of item.inputRefs) if (ref.kind === "artifact") refs.set(ref.id, ref);
    for (const ref of item.evidenceRequirementRefs) refs.set(ref.id, ref);
  }
  for (const item of dod) {
    if (item.targetWorldSummaryRef !== undefined) refs.set(item.targetWorldSummaryRef.id, item.targetWorldSummaryRef);
  }
  return [...refs.values()];
}

function expectedOutputs(items: readonly AgendaItemRecord[], gaps: readonly GapRecord[]): readonly string[] {
  return [
    ...items.map((item) => item.expectedOutput),
    ...gaps.map((gap) => `Resolve gap input: ${gap.requiredInput}`)
  ].filter((item) => item.trim().length > 0);
}

function expectedEvidence(
  items: readonly AgendaItemRecord[],
  gaps: readonly GapRecord[],
  dod: readonly DoDItemRecord[]
): readonly string[] {
  return [
    ...items.map((item) => `Agenda item evidence refs=${item.evidenceRequirementRefs.length}`),
    ...gaps.map((gap) => gap.requiredEvidence),
    ...dod.map((item) => item.evidenceRequirement)
  ].filter((item) => item.trim().length > 0);
}

function defaultPurpose(focus: string, items: readonly AgendaItemRecord[], gaps: readonly GapRecord[]): string {
  if (items.length > 0) return `Advance active agenda: ${items.map((item) => item.summary).join("; ")}`;
  if (gaps.length > 0) return `Resolve open agenda gaps: ${gaps.map((gap) => gap.summary).join("; ")}`;
  return focus;
}

function defaultToolNeed(gaps: readonly GapRecord[]): string {
  return gaps.length === 0 ? "No tool execution requested by agenda." : `Tools may be needed to collect: ${gaps.map((gap) => gap.requiredInput).join("; ")}`;
}

function defaultStopCondition(gaps: readonly GapRecord[]): string {
  return gaps.length === 0 ? "Stop after producing evidence for the active DoD." : "Stop when each targeted gap has new evidence or a blocking reason.";
}

async function writeIntentMutation(
  runtime: AgendaRuntime,
  record: AttemptIntentRecord,
  agendaRecord: Parameters<typeof runtime.storage.writeAgenda>[0],
  items: readonly AgendaItemRecord[]
): Promise<Result<WriteReceipt>> {
  const intent = await runtime.storage.writeAttemptIntent(record, "write attempt intent");
  if (!intent.ok) return intent;
  const agenda = await runtime.storage.writeAgenda(agendaRecord, "write agenda after intent");
  if (!agenda.ok) return agenda;
  for (const item of items) {
    const write = await runtime.storage.writeAgendaItem(item, "link attempt intent to agenda item");
    if (!write.ok) return write;
  }
  const index = await runtime.storage.addAttemptIntent(record.attemptIntentRef);
  return index.ok ? ok(intent.value) : index;
}

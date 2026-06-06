import { randomUUID } from "node:crypto";
import type { ArtifactRef, DomainRef, FeedbackUnitRef } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import type { ToolSurfaceSummary as ContextToolSurfaceSummary } from "../context-message-compiler/index.js";
import type { ToolSurfaceSummary as RuntimeToolSurfaceSummary } from "../tool-runtime/index.js";
import { makeAttemptInputSnapshotId } from "./brand.js";
import { attemptInputSnapshotRef } from "./refs.js";
import { registerAttemptJsonArtifact } from "./artifacts.js";
import { appendAttemptEvent, attemptEventTypes, mutateAttempt, type AttemptRuntime } from "./runtime.js";
import type {
  AttemptInputSnapshot,
  AttemptPreparedInputs,
  AttemptRecord,
  RunAttemptOptions
} from "./types.js";

export async function captureAttemptSnapshot(
  runtime: AttemptRuntime,
  record: AttemptRecord,
  options: RunAttemptOptions
): Promise<Result<{ readonly record: AttemptRecord; readonly snapshot: AttemptInputSnapshot; readonly prepared: AttemptPreparedInputs }>> {
  const prepared = await readPreparedInputs(runtime, record, options);
  if (!prepared.ok) return prepared;
  const source = options.source ?? record.source;
  const version = options.version ?? record.version;
  const audit = options.audit ?? record.audit;
  const correlationId = options.correlationId ?? record.correlationId;
  const summaryRefs = await registerSnapshotSummaries(runtime, record, prepared.value, source, version, audit, correlationId);
  if (!summaryRefs.ok) return summaryRefs;
  const snapshotId = makeAttemptInputSnapshotId(`attempt-snapshot-${randomUUID()}`);
  const snapshot: AttemptInputSnapshot = {
    snapshotId,
    snapshotRef: attemptInputSnapshotRef(snapshotId),
    attemptRef: record.attemptRef,
    growUnitSnapshotRef: summaryRefs.value.grow,
    admissionSummaryRef: summaryRefs.value.admission,
    agendaSummaryRef: summaryRefs.value.agenda,
    attemptIntentRef: record.attemptIntentRef,
    activeDoDRefs: prepared.value.agendaSummary.latestDoDRefs,
    openGapRefs: prepared.value.agendaSummary.latestGapRefs,
    toolSurfaceSummaryRef: prepared.value.toolSurfaceRef,
    skillCandidateSummaryRef: summaryRefs.value.skills,
    policyBoundarySummaryRef: summaryRefs.value.policy,
    artifactCandidateRefs: artifactCandidates(prepared.value),
    source,
    version,
    audit,
    createdAt: new Date().toISOString()
  };
  const write = await runtime.storage.writeSnapshot(snapshot);
  if (!write.ok) return write;
  const next = mutateAttempt(record, { inputSnapshotRef: snapshot.snapshotRef });
  const recordWrite = await runtime.storage.writeAttempt(next, "link attempt input snapshot");
  if (!recordWrite.ok) return recordWrite;
  const event = await appendAttemptEvent({
    runtime,
    record: next,
    eventType: attemptEventTypes.inputSnapshotCaptured,
    body: {
      inputSnapshotRef: snapshot.snapshotRef,
      growUnitSnapshotRef: snapshot.growUnitSnapshotRef,
      admissionSummaryRef: snapshot.admissionSummaryRef,
      agendaSummaryRef: snapshot.agendaSummaryRef
    }
  });
  return event.ok ? ok({ record: next, snapshot, prepared: prepared.value }) : event;
}

export async function readPreparedInputs(
  runtime: AttemptRuntime,
  record: AttemptRecord,
  options: RunAttemptOptions
): Promise<Result<AttemptPreparedInputs>> {
  const growUnitSnapshot = await runtime.options.growUnitManager.buildGrowUnitSnapshot(record.growUnitRef, {
    includeActiveSkills: true,
    reason: "capture attempt input snapshot"
  });
  if (!growUnitSnapshot.ok) return growUnitSnapshot;
  const admissionSummary = await runtime.options.admissionInbox.buildAdmissionSummary(record.growUnitRef);
  if (!admissionSummary.ok) return admissionSummary;
  const agendaSummary = await runtime.options.agendaDoDManager.buildAgendaSummary(record.growUnitRef);
  if (!agendaSummary.ok) return agendaSummary;
  const attemptIntent = await runtime.options.agendaDoDManager.explainAttemptIntent(record.attemptIntentRef);
  if (!attemptIntent.ok) return attemptIntent;
  const toolSurface = await runtime.options.toolRuntime.describeToolSurface(
    options.toolCatalogQuery ?? {},
    options.source ?? record.source,
    options.audit ?? record.audit
  );
  if (!toolSurface.ok) return toolSurface;
  return ok({
    growUnitSnapshot: growUnitSnapshot.value,
    admissionSummary: admissionSummary.value,
    agendaSummary: agendaSummary.value,
    attemptIntent: attemptIntent.value,
    toolSurfaceRef: toolSurface.value.surfaceRef,
    contextToolSurface: toContextToolSurface(toolSurface.value.surface),
    toolSettlementArtifacts: [],
    domainSourceRefs: domainSourceRefs(attemptIntent.value)
  });
}

function toContextToolSurface(surface: RuntimeToolSurfaceSummary): readonly ContextToolSurfaceSummary[] {
  return surface.entries.map((entry) => ({
    toolId: entry.toolRef.id,
    name: `${entry.namespace}.${entry.name}`,
    capabilitySummary: entry.declaredCapabilities.length === 0
      ? "runtime.target_action"
      : entry.declaredCapabilities.join(", "),
    policyBoundarySummary: `${entry.risk} risk; ${entry.sideEffects.summary}`,
    inclusionReason: "visible in current tool surface",
    safeForModel: entry.lifecycle === "active"
  }));
}

async function registerSnapshotSummaries(
  runtime: AttemptRuntime,
  record: AttemptRecord,
  prepared: AttemptPreparedInputs,
  source: AttemptRecord["source"],
  version: AttemptRecord["version"],
  audit: AttemptRecord["audit"],
  correlationId: string | undefined
): Promise<Result<{
  readonly grow: ArtifactRef;
  readonly admission: ArtifactRef;
  readonly agenda: ArtifactRef;
  readonly skills: ArtifactRef;
  readonly policy: ArtifactRef;
}>> {
  const grow = await registerAttemptJsonArtifact({ runtime, kind: "summary", content: prepared.growUnitSnapshot, source, version, audit, correlationId });
  if (!grow.ok) return grow;
  const admission = await registerAttemptJsonArtifact({ runtime, kind: "summary", content: prepared.admissionSummary, source, version, audit, correlationId });
  if (!admission.ok) return admission;
  const agenda = await registerAttemptJsonArtifact({ runtime, kind: "summary", content: prepared.agendaSummary, source, version, audit, correlationId });
  if (!agenda.ok) return agenda;
  const skills = await registerAttemptJsonArtifact({ runtime, kind: "summary", content: prepared.attemptIntent.visibleSkillScopeSummary, source, version, audit, correlationId });
  if (!skills.ok) return skills;
  const policy = await registerAttemptJsonArtifact({ runtime, kind: "summary", content: prepared.attemptIntent.policyBoundarySummary, source, version, audit, correlationId });
  if (!policy.ok) return policy;
  return ok({ grow: grow.value, admission: admission.value, agenda: agenda.value, skills: skills.value, policy: policy.value });
}

function artifactCandidates(prepared: AttemptPreparedInputs): readonly ArtifactRef[] {
  const intent = prepared.attemptIntent;
  return uniqueArtifacts([
    ...intent.requiredContextRefs,
    ...intent.inputCandidateRefs.filter((ref): ref is ArtifactRef => ref.kind === "artifact"),
    ...prepared.toolSettlementArtifacts
  ]);
}

function domainSourceRefs(intent: AttemptPreparedInputs["attemptIntent"]): readonly DomainRef[] {
  const admissible = intent.inputCandidateRefs.filter(
    (ref): ref is ArtifactRef | FeedbackUnitRef => ref.kind === "artifact" || ref.kind === "feedback_unit"
  );
  return [
    intent.growUnitRef,
    ...admissible
  ];
}

function uniqueArtifacts(refs: readonly ArtifactRef[]): readonly ArtifactRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (seen.has(ref.id)) return false;
    seen.add(ref.id);
    return true;
  });
}

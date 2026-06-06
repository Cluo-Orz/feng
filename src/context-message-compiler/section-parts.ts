import type { ArtifactRef, MessageListRef } from "../domain/index.js";
import type {
  ActiveSkillScopeSummary,
  GrowUnitStateSnapshot
} from "../grow-unit-manager/index.js";
import type {
  ActiveSkillSummary,
  AgendaInputRef,
  AgendaSummary,
  AttemptIntentRecord,
  DoDItemRecord,
  GapRecord
} from "../agenda-dod-manager/index.js";
import type { FeedbackUnitRef } from "../domain/index.js";
import type { InboxItemRef } from "../admission-feedback-inbox/index.js";
import { readArtifactForContext } from "./source-readers.js";
import type { ContextRuntime } from "./runtime.js";
import type { SectionComposer, SectionPart } from "./section-builder.js";
import type { ContextCompileInput, ExclusionRecord, ToolSurfaceSummary } from "./types.js";

interface BuildState {
  readonly exclusions: ExclusionRecord[];
  readonly unavailable: string[];
  readonly sourceRefs: ArtifactRef[];
  readonly excludedRefs: ArtifactRef[];
}

export function coreInvariantParts(): readonly SectionPart[] {
  return [{
    text: [
      "Message list is an active representation, not the source of truth.",
      "Do not call tools unless a later runtime grants and validates execution.",
      "Do not treat visible skills or tools as authority to mutate lifecycle.",
      "Preserve file-native traceability for every produced output."
    ].join("\n"),
    sourceType: "manual_instruction",
    inclusionReason: "fixed Context Compiler invariants",
    transformation: "fixed template"
  }];
}

export function growGoalParts(snapshot: GrowUnitStateSnapshot): readonly SectionPart[] {
  const record = snapshot.record;
  return [{
    text: [
      `Grow unit: ${record.title}`,
      `Lifecycle: ${record.lifecycle}; phase: ${record.currentPhase}`,
      `Goal boundary: ${record.goalBoundarySummary}`,
      `Target behavior: ${record.targetBehaviorSummary}`
    ].join("\n"),
    sourceType: "grow_unit_snapshot",
    sourceRef: record.growUnitRef,
    sourceVersion: record.version,
    inclusionReason: "current grow unit goal boundary",
    transformation: "snapshot summary"
  }];
}

export async function addTargetWorldSection(
  runtime: ContextRuntime,
  composer: SectionComposer,
  input: ContextCompileInput,
  ref: ArtifactRef | undefined,
  state: BuildState
): Promise<void> {
  if (ref === undefined) {
    composer.addSection({ kind: "target_world_summary", title: "Target World", priority: 65, parts: [] });
    return;
  }
  const read = await readArtifactForContext({
    registry: runtime.options.artifactRegistry,
    ref,
    reason: input.compileReason,
    section: "target_world_summary",
    maxBytes: 6 * 1024
  });
  absorbRead(read, state);
  composer.addSection({
    kind: "target_world_summary",
    title: "Target World",
    priority: 65,
    parts: read.part === undefined ? [] : [read.part]
  });
}

export function agendaParts(
  summary: AgendaSummary,
  gaps: readonly GapRecord[],
  dod: readonly DoDItemRecord[]
): readonly SectionPart[] {
  return [
    {
      text: [
        `Focus: ${summary.currentFocus}`,
        `Active agenda items: ${summary.activeAgendaItemCount}`,
        `Open gaps: ${summary.openGapCount}`,
        `Active DoD: ${summary.activeDoDCount}`,
        `Blocked agenda facts: ${summary.blockedCount}`
      ].join("\n"),
      sourceType: "agenda_item",
      inclusionReason: "agenda summary projection",
      transformation: "summary projection"
    },
    ...gaps.map((gap): SectionPart => ({
      text: `Gap ${gap.kind}: ${gap.summary}; required input=${gap.requiredInput}; evidence=${gap.requiredEvidence}; attempts=${gap.attemptCount}/${gap.retryLimit}`,
      sourceType: "gap_record",
      sourceRef: gap.gapRef,
      inclusionReason: "open gap affects next attempt context",
      transformation: "gap summary"
    })),
    ...dod.map((item): SectionPart => ({
      text: `DoD: ${item.statement}; scope=${item.scope}; evidence=${item.evidenceRequirement}; validation=${item.validationIntent}`,
      sourceType: "dod_item",
      sourceRef: item.dodRef,
      sourceVersion: item.version,
      inclusionReason: "active DoD defines expected evidence",
      transformation: "DoD summary"
    }))
  ];
}

export async function addAdmissionSections(
  runtime: ContextRuntime,
  composer: SectionComposer,
  input: ContextCompileInput,
  visibleRefs: readonly AgendaInputRef[],
  latestInbox: readonly InboxItemRef[],
  latestFeedback: readonly FeedbackUnitRef[],
  state: BuildState
): Promise<void> {
  const visible = refKeySet(visibleRefs);
  const inboxParts = await explanationParts(runtime, latestInbox, visible, state);
  const feedbackParts = await explanationParts(runtime, latestFeedback, visible, state);
  composer.addSection({ kind: "admitted_materials", title: "Admitted Materials", priority: 70, parts: inboxParts });
  composer.addSection({ kind: "feedback_state", title: "Feedback State", priority: 72, parts: feedbackParts });
}

export async function addArtifactSection(
  runtime: ContextRuntime,
  composer: SectionComposer,
  input: ContextCompileInput,
  refs: readonly ArtifactRef[],
  state: BuildState
): Promise<void> {
  const parts: SectionPart[] = [];
  for (const ref of refs) {
    const read = await readArtifactForContext({
      registry: runtime.options.artifactRegistry,
      ref,
      reason: input.compileReason,
      section: "evidence_summary",
      maxBytes: 8 * 1024
    });
    absorbRead(read, state);
    if (read.part !== undefined) parts.push(read.part);
  }
  composer.addSection({ kind: "evidence_summary", title: "Evidence Summary", priority: 78, parts });
}

export async function addSkillSection(
  runtime: ContextRuntime,
  composer: SectionComposer,
  input: ContextCompileInput,
  active: readonly ActiveSkillScopeSummary[],
  visible: readonly ActiveSkillSummary[],
  state: BuildState
): Promise<void> {
  const visibleIds = new Set(visible.map((skill) => skill.skillRef.id));
  for (const skill of active) {
    if (!visibleIds.has(skill.skillRef.id)) {
      state.exclusions.push({
        sourceType: "skill",
        sourceRef: skill.skillRef,
        reason: "not_relevant_to_attempt_intent",
        summary: `Active skill ${skill.name} was not selected by attempt intent`,
        section: "visible_skills"
      });
    }
  }
  const parts: SectionPart[] = [];
  for (const skill of visible) {
    const summary = await runtime.options.skillRegistry.loadSkillSummary(skill.skillRef, { reason: input.compileReason });
    if (!summary.ok) {
      state.exclusions.push(skillExclusion(skill.skillRef, "incompatible_version", summary.error.message));
      continue;
    }
    let text = `Skill ${summary.value.name}@${summary.value.version.schemaVersion}: ${summary.value.description}\nTrigger: ${summary.value.triggerSummary}`;
    if (input.skillBodyMode === "bounded_body") {
      const body = await runtime.options.skillRegistry.loadSkillBody(skill.skillRef, { reason: input.compileReason, maxBytes: 4 * 1024 });
      if (body.ok && body.value.privacyClass !== "contains_secret" && body.value.privacyClass !== "unknown" && body.value.privacyClass !== "redacted") {
        text += `\nBody excerpt:\n${toText(body.value.content)}`;
      } else if (body.ok) {
        state.exclusions.push(skillExclusion(skill.skillRef, "privacy_blocked", `skill body hidden by privacy metadata: ${body.value.privacyClass}`));
      } else {
        state.exclusions.push(skillExclusion(skill.skillRef, body.error.code === "privacy_blocked" ? "privacy_blocked" : "artifact_unavailable", body.error.message));
      }
    }
    parts.push({
      text,
      sourceType: "skill",
      sourceRef: skill.skillRef,
      sourceVersion: summary.value.version,
      inclusionReason: "attempt intent selected skill as visible",
      transformation: input.skillBodyMode === "bounded_body" ? "summary plus bounded body" : "summary only"
    });
  }
  composer.addSection({ kind: "visible_skills", title: "Visible Skills", priority: 62, parts });
}

export function toolParts(tools: readonly ToolSurfaceSummary[], exclusions: ExclusionRecord[]): readonly SectionPart[] {
  const parts: SectionPart[] = [];
  for (const tool of tools) {
    if (!tool.safeForModel) {
      exclusions.push({
        sourceType: "tool_surface",
        reason: "unsafe_tool_surface",
        summary: `Tool ${tool.name} was hidden because safeForModel=false`,
        section: "visible_tools",
        ...(tool.policyDecisionId === undefined ? {} : { policyDecisionId: tool.policyDecisionId })
      });
      continue;
    }
    parts.push({
      text: `Tool ${tool.name}: ${tool.capabilitySummary}; policy=${tool.policyBoundarySummary}; reason=${tool.inclusionReason}`,
      sourceType: "tool_surface",
      inclusionReason: tool.inclusionReason,
      transformation: "read-only tool summary",
      ...(tool.policyDecisionId === undefined ? {} : { policyDecisionId: tool.policyDecisionId })
    });
  }
  return parts;
}

export function policyParts(summary: string | undefined, tools: readonly ToolSurfaceSummary[]): readonly SectionPart[] {
  return [{
    text: [
      summary ?? "No attempt-specific policy boundary summary.",
      ...tools.map((tool) => `Tool boundary ${tool.name}: ${tool.policyBoundarySummary}`)
    ].join("\n"),
    sourceType: "policy_decision",
    inclusionReason: "policy and capability boundary summary only",
    transformation: "policy summary; no policy evaluation"
  }];
}

export function attemptParts(
  intent: AttemptIntentRecord | undefined,
  _ref: AttemptIntentRecord["attemptIntentRef"] | undefined
): readonly SectionPart[] {
  if (intent === undefined) return [];
  return [{
    text: [
      `Purpose: ${intent.purpose}`,
      `Tool need: ${intent.toolNeedSummary}`,
      `Stop condition: ${intent.stopCondition}`,
      `Input candidates: ${intent.inputCandidateRefs.map((item) => `${item.kind}:${item.id}`).join(", ") || "none"}`
    ].join("\n"),
    sourceType: "attempt_intent",
    sourceRef: intent.attemptIntentRef,
    inclusionReason: "current attempt intent compiled into next message list",
    transformation: "intent summary"
  }];
}

export function outputParts(
  intent: AttemptIntentRecord | undefined,
  dod: readonly DoDItemRecord[]
): readonly SectionPart[] {
  return [{
    text: [
      ...(intent?.expectedOutputs ?? []).map((item) => `Expected output: ${item}`),
      ...(intent?.expectedEvidence ?? []).map((item) => `Expected evidence: ${item}`),
      ...dod.map((item) => `DoD evidence: ${item.evidenceRequirement}`)
    ].join("\n") || "No explicit output expectation for this compile.",
    sourceType: "readiness_or_evidence_summary",
    inclusionReason: "output and evidence expectation for downstream attempt",
    transformation: "expectation summary"
  }];
}

export function exclusionParts(
  exclusions: readonly ExclusionRecord[],
  messageListRef: MessageListRef
): readonly SectionPart[] {
  const text = exclusions.length === 0
    ? "No source exclusions before budget fitting. Budget exclusions, if any, are recorded in the exclusion list artifact."
    : exclusions.map((item) => `${item.reason}: ${item.summary}`).join("\n");
  return [{
    text,
    sourceType: "manual_instruction",
    sourceRef: messageListRef,
    inclusionReason: "visible summary of omitted source candidates",
    transformation: "exclusion summary"
  }];
}

async function explanationParts(
  runtime: ContextRuntime,
  refs: readonly (InboxItemRef | FeedbackUnitRef)[],
  visible: ReadonlySet<string>,
  state: BuildState
): Promise<readonly SectionPart[]> {
  const parts: SectionPart[] = [];
  for (const ref of refs) {
    if (!visible.has(refKey(ref))) {
      state.exclusions.push({
        sourceType: ref.kind === "feedback_unit" ? "feedback_unit" : "admission_item",
        sourceRef: ref,
        reason: "not_relevant_to_attempt_intent",
        summary: `${ref.kind}:${ref.id} was not selected by attempt intent`
      });
      continue;
    }
    const explanation = await runtime.options.admissionInbox.explainAdmissionDecision(ref);
    if (!explanation.ok) {
      state.exclusions.push({
        sourceType: ref.kind === "feedback_unit" ? "feedback_unit" : "admission_item",
        sourceRef: ref,
        reason: "artifact_unavailable",
        summary: explanation.error.message
      });
      continue;
    }
    parts.push({
      text: `${explanation.value.summary}\n${explanation.value.facts.join("\n")}`,
      sourceType: ref.kind === "feedback_unit" ? "feedback_unit" : "admission_item",
      sourceRef: ref,
      inclusionReason: "attempt intent selected admission or feedback ref",
      transformation: "privacy-safe admission explanation"
    });
  }
  return parts;
}

function absorbRead(read: Awaited<ReturnType<typeof readArtifactForContext>>, state: BuildState): void {
  state.exclusions.push(...read.exclusions);
  state.unavailable.push(...read.unavailableSources);
  state.sourceRefs.push(...read.sourceArtifactRefs);
  state.excludedRefs.push(...read.excludedArtifactRefs);
}

function skillExclusion(
  sourceRef: ActiveSkillSummary["skillRef"],
  reason: ExclusionRecord["reason"],
  summary: string
): ExclusionRecord {
  return { sourceType: "skill", sourceRef, reason, summary, section: "visible_skills" };
}

function refKeySet(refs: readonly AgendaInputRef[]): ReadonlySet<string> {
  return new Set(refs.map(refKey));
}

function refKey(ref: { readonly kind: string; readonly id: string }): string {
  return `${ref.kind}:${ref.id}`;
}

function toText(content: string | Uint8Array): string {
  return typeof content === "string" ? content : `<binary skill body ${content.length} bytes>`;
}

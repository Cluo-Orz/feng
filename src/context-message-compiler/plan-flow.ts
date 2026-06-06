import { randomUUID } from "node:crypto";
import { ok, type Result } from "../domain/result.js";
import type { ArtifactRef } from "../domain/index.js";
import { makeContextCompilePlanId } from "./brand.js";
import { contextEventTypes } from "./events.js";
import { makeContextCompilePlanRef } from "./refs.js";
import { appendContextEvent, ensureGrowUnitCompilable, type ContextRuntime } from "./runtime.js";
import { defaultTotalBudget, normalizeBudget } from "./budget.js";
import type {
  CandidateSource,
  CompilePlanExplanation,
  ContextCompileInput,
  ContextCompilePlan,
  ContextCompilePlanRef,
  ContextSectionKind
} from "./types.js";

export async function buildCompilePlanRecord(
  runtime: ContextRuntime,
  input: ContextCompileInput
): Promise<Result<ContextCompilePlan>> {
  const writable = await ensureGrowUnitCompilable(runtime, input.growUnitRef);
  if (!writable.ok) return writable;
  const grow = await runtime.options.growUnitManager.getGrowUnit(input.growUnitRef);
  if (!grow.ok) return grow;
  const agenda = await runtime.options.agendaDoDManager.buildAgendaSummary(input.growUnitRef);
  if (!agenda.ok) return agenda;
  const attemptIntentRef = input.attemptIntentRef ?? agenda.value.attemptIntentRef;
  const intent = attemptIntentRef === undefined
    ? undefined
    : await runtime.options.agendaDoDManager.explainAttemptIntent(attemptIntentRef);
  if (intent !== undefined && !intent.ok) return intent;
  const candidates = await candidateSources(runtime, input, attemptIntentRef, intent?.value.requiredContextRefs ?? []);
  if (!candidates.ok) return candidates;
  const planRef = makeContextCompilePlanRef(makeContextCompilePlanId(`context-plan-${randomUUID()}`));
  const plan: ContextCompilePlan = {
    compilePlanId: planRef.id,
    compilePlanRef: planRef,
    growUnitRef: input.growUnitRef,
    ...(attemptIntentRef === undefined ? {} : { attemptIntentRef }),
    candidateSources: candidates.value,
    sectionPlan: defaultSectionPlan(),
    priorityRules: [
      "attempt intent and active DoD outrank broad admitted summaries",
      "privacy-blocked, retracted, and unsafe tool surfaces are excluded before budgeting",
      "budget truncates lower-priority representation only; original facts stay on disk"
    ],
    budget: normalizeBudget(input.budget, runtime.options.defaultBudgetTokens ?? defaultTotalBudget),
    redactionRules: [
      "contains_secret, unknown, and redacted privacy classes are not materialized as original text",
      "redacted artifact lifecycle produces an explicit exclusion record"
    ],
    exclusionRules: [
      "admitted does not imply visible",
      "active skill does not imply visible",
      "visible tool does not imply executable"
    ],
    skillVisibilityPlan: input.skillBodyMode === "bounded_body"
      ? "use attempt intent visible skills; include bounded body through Skill Registry"
      : "use attempt intent visible skills; include summaries only",
    toolVisibilityPlan: "include only caller-supplied safe read-only tool summaries",
    source: input.source,
    audit: input.audit,
    createdAt: new Date().toISOString(),
    recordVersion: 1
  };
  const written = await runtime.storage.writeCompilePlan(plan, input.compileReason);
  if (!written.ok) return written;
  const indexed = await runtime.storage.addCompilePlan(plan.compilePlanRef);
  if (!indexed.ok) return indexed;
  const event = await appendContextEvent({
    runtime,
    growUnitRef: input.growUnitRef,
    eventType: contextEventTypes.compilePlanCreated,
    body: {
      compilePlanRef: plan.compilePlanRef,
      attemptIntentRef,
      candidateCount: plan.candidateSources.length,
      sectionPlan: plan.sectionPlan
    },
    source: input.source,
    audit: input.audit,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId })
  });
  return event.ok ? ok(plan) : event;
}

export async function explainCompilePlanRecord(
  runtime: ContextRuntime,
  ref: ContextCompilePlanRef
): Promise<Result<CompilePlanExplanation>> {
  const plan = await runtime.storage.readCompilePlan(ref);
  if (!plan.ok) return plan;
  return ok({
    compilePlanRef: ref,
    summary: `Compile plan for grow unit ${plan.value.growUnitRef.id} with ${plan.value.candidateSources.length} candidates`,
    candidateCount: plan.value.candidateSources.length,
    sectionPlan: plan.value.sectionPlan,
    priorityRules: plan.value.priorityRules
  });
}

function defaultSectionPlan(): readonly ContextSectionKind[] {
  return [
    "core_invariants",
    "grow_goal",
    "target_world_summary",
    "agenda_and_dod",
    "admitted_materials",
    "feedback_state",
    "evidence_summary",
    "visible_skills",
    "visible_tools",
    "policy_boundaries",
    "attempt_intent",
    "output_expectation",
    "excluded_or_unavailable_summary"
  ];
}

async function candidateSources(
  runtime: ContextRuntime,
  input: ContextCompileInput,
  attemptIntentRef: ContextCompileInput["attemptIntentRef"] | undefined,
  requiredContextRefs: readonly ArtifactRef[]
): Promise<Result<readonly CandidateSource[]>> {
  const admission = await runtime.options.admissionInbox.buildAdmissionSummary(input.growUnitRef);
  if (!admission.ok) return admission;
  const gaps = await runtime.options.agendaDoDManager.listOpenGaps(input.growUnitRef);
  if (!gaps.ok) return gaps;
  const dod = await runtime.options.agendaDoDManager.listActiveDoD(input.growUnitRef);
  if (!dod.ok) return dod;
  const artifacts = uniqueArtifactRefs([...(input.artifactCandidateRefs ?? []), ...requiredContextRefs]);
  return ok([
    { sourceType: "grow_unit_snapshot", sourceRef: input.growUnitRef, intendedSection: "grow_goal", inclusionReason: "grow unit boundary", priority: 100 },
    ...(attemptIntentRef === undefined ? [] : [{
      sourceType: "attempt_intent" as const,
      sourceRef: attemptIntentRef,
      intendedSection: "attempt_intent" as const,
      inclusionReason: "current attempt intent",
      priority: 100
    }]),
    ...admission.value.latestInboxRefs.map((sourceRef): CandidateSource => ({
      sourceType: "admission_item",
      sourceRef,
      intendedSection: "admitted_materials",
      inclusionReason: "latest admission explanation candidate",
      priority: 60
    })),
    ...admission.value.latestFeedbackRefs.map((sourceRef): CandidateSource => ({
      sourceType: "feedback_unit",
      sourceRef,
      intendedSection: "feedback_state",
      inclusionReason: "latest feedback explanation candidate",
      priority: 70
    })),
    ...gaps.value.records.map((sourceRef): CandidateSource => ({
      sourceType: "gap_record",
      sourceRef: sourceRef.gapRef,
      intendedSection: "agenda_and_dod",
      inclusionReason: "open gap candidate",
      priority: 90
    })),
    ...dod.value.map((sourceRef): CandidateSource => ({
      sourceType: "dod_item",
      sourceRef: sourceRef.dodRef,
      intendedSection: "agenda_and_dod",
      inclusionReason: "active DoD candidate",
      priority: 95
    })),
    ...artifacts.map((sourceRef): CandidateSource => ({
      sourceType: "artifact",
      sourceRef,
      intendedSection: "evidence_summary",
      inclusionReason: "required or supplied artifact candidate",
      priority: 80
    }))
  ]);
}

function uniqueArtifactRefs(refs: readonly ArtifactRef[]): readonly ArtifactRef[] {
  const byId = new Map<string, ArtifactRef>();
  for (const ref of refs) byId.set(ref.id, ref);
  return [...byId.values()];
}

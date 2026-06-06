import { ok, type Result } from "../domain/result.js";
import type { ArtifactRef, ReadinessVerdict } from "../domain/index.js";
import type { DoDRef } from "../agenda-dod-manager/index.js";
import { evidenceEventTypes } from "./events.js";
import {
  compact,
  lifecycleFromVerdict,
  newAssessmentRef,
  newGapRef,
  newVerdictRef,
  uniqueById
} from "./logic.js";
import { appendEvidenceEvent, ensureGrowUnitWritable } from "./runtime.js";
import type { EvidenceRuntime } from "./runtime.js";
import { evaluateActiveDoDRecords } from "./evaluation-flow.js";
import type {
  AssessReadinessOptions,
  DoDEvaluation,
  EvidenceRecord,
  ReadinessAssessment,
  ReadinessExplanation,
  ReadinessGap,
  ReadinessGapKind,
  ReadinessVerdictRecord
} from "./types.js";

export async function assessReadinessRecord(
  runtime: EvidenceRuntime,
  growUnitRef: ReadinessAssessment["growUnitRef"],
  options: AssessReadinessOptions
): Promise<Result<ReadinessAssessment>> {
  const writable = await ensureGrowUnitWritable(runtime, growUnitRef);
  if (!writable.ok) return writable;
  const activeDoD = await runtime.options.agendaDoDManager.listActiveDoD(growUnitRef);
  if (!activeDoD.ok) return activeDoD;
  const agendaSummaryRef = await registerAgendaSummary(runtime, growUnitRef, options);
  if (!agendaSummaryRef.ok) return agendaSummaryRef;
  const evaluationSet = await evaluateActiveDoDRecords(runtime, growUnitRef, {
    growUnitRef,
    source: options.source,
    audit: options.audit,
    ...(options.evidenceRefs === undefined ? {} : { evidenceRefs: options.evidenceRefs })
  });
  if (!evaluationSet.ok) return evaluationSet;
  const evidence = await assessmentEvidence(runtime, growUnitRef, options.evidenceRefs);
  if (!evidence.ok) return evidence;
  const gaps = await writeReadinessGaps(runtime, growUnitRef, activeDoD.value.map((item) => item.dodRef), evaluationSet.value.evaluations, options);
  if (!gaps.ok) return gaps;
  const assessmentRef = newAssessmentRef();
  const assessment: ReadinessAssessment = {
    readinessAssessmentId: assessmentRef.id,
    readinessAssessmentRef: assessmentRef,
    growUnitRef,
    agendaSummaryRef: agendaSummaryRef.value,
    activeDoDRefs: activeDoD.value.map((item) => item.dodRef),
    dodEvaluationRefs: evaluationSet.value.evaluations.map((item) => item.dodEvaluationRef),
    evidenceRefs: evidence.value.map((item) => item.evidenceRef),
    attemptOutcomeRefs: artifactRefsBySource(evidence.value, "attempt_outcome"),
    validationReportRefs: artifactRefsBySource(evidence.value, "validation_report", "external_test_report", "llm_judge_report"),
    feedbackEvidenceRefs: artifactRefsBySource(evidence.value, "feedback_evidence"),
    readinessGapRefs: gaps.value.map((item) => item.readinessGapRef),
    riskSummary: riskSummary(evaluationSet.value.evaluations, gaps.value),
    privacySummary: privacySummary(evidence.value, gaps.value),
    policyDecisionRefs: uniqueById(evidence.value.flatMap((item) =>
      item.policyDecisionRefs.map((id) => ({ id }))
    )).map((item) => item.id),
    createdAt: new Date().toISOString(),
    source: options.source,
    audit: options.audit
  };
  const write = await runtime.storage.writeAssessment(assessment, "write readiness assessment");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addAssessment(assessmentRef);
  if (!indexed.ok) return indexed;
  const event = await appendEvidenceEvent({
    runtime,
    growUnitRef,
    eventType: evidenceEventTypes.readinessAssessmentCreated,
    body: {
      assessmentRef,
      activeDoDCount: assessment.activeDoDRefs.length,
      evaluationCount: assessment.dodEvaluationRefs.length,
      gapCount: assessment.readinessGapRefs.length
    },
    source: options.source,
    audit: options.audit
  });
  return event.ok ? ok(assessment) : event;
}

export async function produceReadinessVerdictRecord(
  runtime: EvidenceRuntime,
  assessmentRef: ReadinessAssessment["readinessAssessmentRef"]
): Promise<Result<ReadinessVerdictRecord>> {
  const assessment = await runtime.storage.readAssessment(assessmentRef);
  if (!assessment.ok) return assessment;
  const evaluations = await readEvaluations(runtime, assessment.value.dodEvaluationRefs);
  if (!evaluations.ok) return evaluations;
  const gaps = await readGaps(runtime, assessment.value.readinessGapRefs);
  if (!gaps.ok) return gaps;
  const decision = decideVerdict(assessment.value, evaluations.value, gaps.value);
  const verdictRef = newVerdictRef();
  const artifact = await registerVerdictArtifact(runtime, verdictRef, assessment.value, evaluations.value, gaps.value, decision);
  if (!artifact.ok) return artifact;
  const record: ReadinessVerdictRecord = {
    readinessVerdictId: verdictRef.id,
    readinessVerdictRef: verdictRef,
    artifactRef: artifact.value,
    growUnitRef: assessment.value.growUnitRef,
    assessmentRef,
    verdict: decision.verdict,
    reason: decision.reason,
    dodEvaluationRefs: assessment.value.dodEvaluationRefs,
    requiredInput: decision.requiredInput,
    requiredFeedback: decision.requiredFeedback,
    requiredValidation: decision.requiredValidation,
    blockingGaps: gaps.value.filter((item) => item.blocking).map((item) => item.readinessGapRef),
    evidenceRefs: assessment.value.evidenceRefs,
    evidenceArtifactRefs: uniqueById([
      ...assessment.value.attemptOutcomeRefs,
      ...assessment.value.validationReportRefs,
      ...assessment.value.feedbackEvidenceRefs
    ]),
    policyDecisionRefs: assessment.value.policyDecisionRefs,
    recommendedGrowLifecycle: lifecycleFromVerdict(decision.verdict),
    createdAt: new Date().toISOString(),
    source: assessment.value.source,
    audit: assessment.value.audit
  };
  const write = await runtime.storage.writeVerdict(record, "write readiness verdict");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addVerdict(verdictRef);
  if (!indexed.ok) return indexed;
  const event = await appendEvidenceEvent({
    runtime,
    growUnitRef: record.growUnitRef,
    eventType: evidenceEventTypes.readinessVerdictRecorded,
    body: { verdictRef, artifactRef: record.artifactRef, verdict: record.verdict, reason: record.reason },
    source: record.source,
    audit: record.audit
  });
  if (!event.ok) return event;
  const reportEvent = await appendEvidenceEvent({
    runtime,
    growUnitRef: record.growUnitRef,
    eventType: evidenceEventTypes.readinessReportRegistered,
    body: { verdictRef, artifactRef: record.artifactRef },
    source: record.source,
    audit: record.audit
  });
  return reportEvent.ok ? ok(record) : reportEvent;
}

export async function explainReadinessVerdictRecord(
  runtime: EvidenceRuntime,
  verdictRef: ReadinessVerdictRecord["readinessVerdictRef"]
): Promise<Result<ReadinessExplanation>> {
  const record = await runtime.storage.readVerdict(verdictRef);
  if (!record.ok) return record;
  const assessment = await runtime.storage.readAssessment(record.value.assessmentRef);
  if (!assessment.ok) return assessment;
  const gaps = await readGaps(runtime, assessment.value.readinessGapRefs);
  if (!gaps.ok) return gaps;
  return ok({
    verdictRef,
    artifactRef: record.value.artifactRef,
    summary: `${record.value.verdict}: ${record.value.reason}`,
    facts: [
      `growUnit=${record.value.growUnitRef.id}`,
      `assessment=${record.value.assessmentRef.id}`,
      `activeDoD=${assessment.value.activeDoDRefs.length}`,
      `evaluations=${record.value.dodEvaluationRefs.length}`,
      `evidence=${record.value.evidenceRefs.length}`,
      `blockingGaps=${record.value.blockingGaps.length}`,
      ...gaps.value.map((gap) => `gap=${gap.kind}: ${gap.summary}`)
    ]
  });
}

async function registerAgendaSummary(
  runtime: EvidenceRuntime,
  growUnitRef: ReadinessAssessment["growUnitRef"],
  options: AssessReadinessOptions
): Promise<Result<ArtifactRef>> {
  const summary = await runtime.options.agendaDoDManager.buildAgendaSummary(growUnitRef);
  const content = summary.ok
    ? JSON.stringify(summary.value, null, 2)
    : JSON.stringify({ growUnitRef, unavailable: true, reason: summary.error.message }, null, 2);
  return runtime.options.artifactRegistry.registerArtifact({
    kind: "summary",
    content,
    mediaType: "application/json",
    encoding: "utf8",
    source: options.source,
    version: { schemaVersion: "1", producerVersion: runtime.options.producer },
    audit: options.audit,
    privacyClass: options.source.privacyLevel,
    retentionClass: "grow_scoped",
    producerModule: "evidence-readiness"
  });
}

async function assessmentEvidence(
  runtime: EvidenceRuntime,
  growUnitRef: ReadinessAssessment["growUnitRef"],
  evidenceRefs: readonly EvidenceRecord["evidenceRef"][] | undefined
): Promise<Result<readonly EvidenceRecord[]>> {
  if (evidenceRefs !== undefined) {
    const records: EvidenceRecord[] = [];
    for (const ref of evidenceRefs) {
      const record = await runtime.storage.readEvidence(ref);
      if (!record.ok) return record;
      if (record.value.growUnitRef.id === growUnitRef.id) records.push(record.value);
    }
    return ok(records);
  }
  const all = await runtime.storage.readAllEvidence();
  return all.ok ? ok(all.value.filter((item) => item.growUnitRef.id === growUnitRef.id)) : all;
}

async function writeReadinessGaps(
  runtime: EvidenceRuntime,
  growUnitRef: ReadinessAssessment["growUnitRef"],
  activeDoDRefs: readonly DoDRef[],
  evaluations: readonly DoDEvaluation[],
  options: AssessReadinessOptions
): Promise<Result<readonly ReadinessGap[]>> {
  const gapInputs = activeDoDRefs.length === 0
    ? [gapInput("missing_evidence", "no active DoD exists", [], [], ["define active DoD and evidence gate"], [], true)]
    : evaluations.flatMap((evaluation) => gapsForEvaluation(evaluation));
  const gaps: ReadinessGap[] = [];
  for (const item of gapInputs) {
    const gapRef = newGapRef();
    const gap: ReadinessGap = {
      readinessGapId: gapRef.id,
      readinessGapRef: gapRef,
      growUnitRef,
      kind: item.kind,
      summary: item.summary,
      relatedDoDRefs: item.relatedDoDRefs,
      relatedEvidenceRefs: item.relatedEvidenceRefs,
      requiredInput: item.requiredInput,
      requiredValidation: item.requiredValidation,
      requiredFeedback: item.requiredFeedback,
      blocking: item.blocking,
      source: options.source,
      audit: options.audit,
      createdAt: new Date().toISOString()
    };
    const write = await runtime.storage.writeGap(gap, "write readiness gap");
    if (!write.ok) return write;
    const indexed = await runtime.storage.addGap(gapRef);
    if (!indexed.ok) return indexed;
    const event = await appendEvidenceEvent({
      runtime,
      growUnitRef,
      eventType: evidenceEventTypes.readinessGapRecorded,
      body: { gapRef, kind: gap.kind, summary: gap.summary, blocking: gap.blocking },
      source: options.source,
      audit: options.audit
    });
    if (!event.ok) return event;
    gaps.push(gap);
  }
  return ok(gaps);
}

function gapsForEvaluation(evaluation: DoDEvaluation): readonly ReturnType<typeof gapInput>[] {
  if (evaluation.status === "passed") return [];
  if (evaluation.status === "failed") {
    return [gapInput("contradicting_evidence", evaluation.explanation, [evaluation.dodRef], evaluation.contradictingEvidenceRefs, [], [], true)];
  }
  if (evaluation.status === "blocked") {
    const kind = evaluation.blockedReasons.some((reason) => reason.includes("redacted"))
      ? "privacy_blocked"
      : "policy_blocked";
    return [gapInput(kind, evaluation.explanation, [evaluation.dodRef], [], [], evaluation.blockedReasons, true)];
  }
  return [gapInput("missing_evidence", evaluation.explanation, [evaluation.dodRef], [], [], evaluation.missingEvidence, true)];
}

function gapInput(
  kind: ReadinessGapKind,
  summary: string,
  relatedDoDRefs: readonly DoDRef[],
  relatedEvidenceRefs: readonly EvidenceRecord["evidenceRef"][],
  requiredInput: readonly string[],
  requiredValidation: readonly string[],
  blocking: boolean
) {
  return {
    kind,
    summary: compact(summary, 1_000),
    relatedDoDRefs,
    relatedEvidenceRefs,
    requiredInput,
    requiredValidation,
    requiredFeedback: [],
    blocking
  };
}

async function readEvaluations(runtime: EvidenceRuntime, refs: readonly DoDEvaluation["dodEvaluationRef"][]) {
  const records: DoDEvaluation[] = [];
  for (const ref of refs) {
    const record = await runtime.storage.readEvaluation(ref);
    if (!record.ok) return record;
    records.push(record.value);
  }
  return ok(records);
}

async function readGaps(runtime: EvidenceRuntime, refs: readonly ReadinessGap["readinessGapRef"][]) {
  const records: ReadinessGap[] = [];
  for (const ref of refs) {
    const record = await runtime.storage.readGap(ref);
    if (!record.ok) return record;
    records.push(record.value);
  }
  return ok(records);
}

function decideVerdict(
  assessment: ReadinessAssessment,
  evaluations: readonly DoDEvaluation[],
  gaps: readonly ReadinessGap[]
): {
  readonly verdict: ReadinessVerdict;
  readonly reason: string;
  readonly requiredInput: readonly string[];
  readonly requiredFeedback: readonly string[];
  readonly requiredValidation: readonly string[];
} {
  if (assessment.activeDoDRefs.length === 0) {
    return decision("waiting_validation", "active DoD is missing", ["define active DoD"], [], ["define evidence gate"]);
  }
  if (evaluations.some((item) => item.status === "blocked") || gaps.some((item) => item.kind === "policy_blocked" || item.kind === "privacy_blocked")) {
    return decision("blocked", "readiness is blocked by policy, privacy, or unreadable evidence", [], [], gaps.flatMap((item) => item.requiredValidation));
  }
  if (evaluations.some((item) => item.status === "failed")) {
    return decision("not_ready", "contradicting evidence prevents hatch readiness", [], [], gaps.flatMap((item) => item.requiredValidation));
  }
  if (evaluations.every((item) => item.status === "passed") && gaps.length === 0) {
    return decision("ready_to_hatch", "all active DoD passed with accepted evidence", [], [], []);
  }
  return decision("waiting_validation", "required validation evidence is missing", [], [], gaps.flatMap((item) => item.requiredValidation));
}

function decision(
  verdict: ReadinessVerdict,
  reason: string,
  requiredInput: readonly string[],
  requiredFeedback: readonly string[],
  requiredValidation: readonly string[]
) {
  return { verdict, reason, requiredInput, requiredFeedback, requiredValidation };
}

async function registerVerdictArtifact(
  runtime: EvidenceRuntime,
  verdictRef: ReadinessVerdictRecord["readinessVerdictRef"],
  assessment: ReadinessAssessment,
  evaluations: readonly DoDEvaluation[],
  gaps: readonly ReadinessGap[],
  decisionValue: ReturnType<typeof decision>
): Promise<Result<ArtifactRef>> {
  const parentRefs = uniqueById([assessment.agendaSummaryRef, ...assessment.validationReportRefs, ...assessment.feedbackEvidenceRefs]);
  return runtime.options.artifactRegistry.registerDerivedArtifact({
    kind: "summary",
    content: JSON.stringify({ verdictRef, assessment, evaluations, gaps, decision: decisionValue }, null, 2),
    mediaType: "application/json",
    encoding: "utf8",
    source: assessment.source,
    version: { schemaVersion: "1", producerVersion: runtime.options.producer },
    audit: assessment.audit,
    privacyClass: assessment.source.privacyLevel,
    retentionClass: "hatch_scoped",
    producerModule: "evidence-readiness",
    parentRefs
  });
}

function artifactRefsBySource(records: readonly EvidenceRecord[], ...sourceKinds: readonly EvidenceRecord["sourceKind"][]) {
  return uniqueById(records.flatMap((item) =>
    sourceKinds.includes(item.sourceKind) && item.artifactRef !== undefined ? [item.artifactRef] : []
  ));
}

function riskSummary(evaluations: readonly DoDEvaluation[], gaps: readonly ReadinessGap[]): string {
  return `${evaluations.filter((item) => item.status !== "passed").length} non-passed DoD evaluation(s), ${gaps.length} readiness gap(s)`;
}

function privacySummary(evidence: readonly EvidenceRecord[], gaps: readonly ReadinessGap[]): string {
  const blocked = gaps.filter((item) => item.kind === "privacy_blocked" || item.kind === "policy_blocked").length;
  return `${evidence.filter((item) => item.status === "accepted_for_evaluation").length} accepted evidence item(s), ${blocked} privacy/policy gap(s)`;
}

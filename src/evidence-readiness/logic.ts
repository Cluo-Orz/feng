import { randomUUID } from "node:crypto";
import type { ArtifactKind, ArtifactRecord } from "../artifact-registry/index.js";
import type { GrowLifecycle, ReadinessVerdict } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import type { DoDItemRecord, DoDRef } from "../agenda-dod-manager/index.js";
import {
  makeDoDEvaluationId,
  makeEvidenceId,
  makeReadinessAssessmentId,
  makeReadinessGapId,
  makeReadinessVerdictId
} from "./brand.js";
import { evidenceErr } from "./errors.js";
import {
  makeDoDEvaluationRef,
  makeEvidenceRef,
  makeReadinessAssessmentRef,
  makeReadinessGapRef,
  makeReadinessVerdictRef
} from "./refs.js";
import type {
  DoDEvaluationRef,
  EvidenceQuality,
  EvidenceRecord,
  EvidenceRef,
  EvidenceRelation,
  EvidenceSourceKind,
  EvidenceStatus,
  ReadinessAssessmentRef,
  ReadinessGapRef,
  ReadinessVerdictRef,
  TrustLevel
} from "./types.js";

export const newEvidenceRef = (): EvidenceRef =>
  makeEvidenceRef(makeEvidenceId(`evidence-${randomUUID()}`));
export const newDoDEvaluationRef = (): DoDEvaluationRef =>
  makeDoDEvaluationRef(makeDoDEvaluationId(`dod-evaluation-${randomUUID()}`));
export const newAssessmentRef = (): ReadinessAssessmentRef =>
  makeReadinessAssessmentRef(makeReadinessAssessmentId(`readiness-assessment-${randomUUID()}`));
export const newGapRef = (): ReadinessGapRef =>
  makeReadinessGapRef(makeReadinessGapId(`readiness-gap-${randomUUID()}`));
export const newVerdictRef = (): ReadinessVerdictRef =>
  makeReadinessVerdictRef(makeReadinessVerdictId(`readiness-verdict-${randomUUID()}`));

export function compact(value: string, max = 4_000): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 3)}...`;
}

export function nonEmpty(value: string, field: string): Result<void> {
  return value.trim().length === 0
    ? evidenceErr({ code: "invalid_input", message: `${field} is required` })
    : ok(undefined);
}

export function artifactKindForSource(sourceKind: EvidenceSourceKind): ArtifactKind {
  if (sourceKind === "candidate_output") return "candidate_output";
  if (sourceKind === "tool_result") return "tool_result";
  if (sourceKind === "validation_report") return "validation_report";
  if (sourceKind === "attempt_trace") return "attempt_trace";
  if (sourceKind === "runtime_trace") return "runtime_trace";
  if (sourceKind === "feedback_evidence") return "feedback_evidence";
  if (sourceKind === "external_test_report" || sourceKind === "llm_judge_report") return "validation_report";
  if (sourceKind === "attempt_outcome" || sourceKind === "artifact_metadata") return "summary";
  return "source_material";
}

export function defaultQuality(sourceKind: EvidenceSourceKind): EvidenceQuality {
  if (sourceKind === "manual_review") {
    return quality("manual_reviewed", "moderate", "reviewed by a named source and scoped to this grow unit");
  }
  if (sourceKind === "tool_result") return quality("tool_measured", "moderate", "tool result needs DoD relation");
  if (sourceKind === "validation_report" || sourceKind === "external_test_report") {
    return quality("test_reported", "strong", "validation report can support DoD when scoped");
  }
  if (sourceKind === "runtime_trace" || sourceKind === "attempt_trace") {
    return quality("observed_runtime", "moderate", "runtime observation can support process facts");
  }
  if (sourceKind === "llm_judge_report") return quality("model_judged", "weak", "LLM judge is weak evidence");
  if (sourceKind === "candidate_output" || sourceKind === "attempt_outcome") {
    return quality("model_self_claim", "weak", "candidate or attempt completion is not proof of readiness");
  }
  return quality("unknown", "weak", "unknown evidence source");
}

export function mergeQuality(base: EvidenceQuality, patch: Partial<EvidenceQuality> | undefined): EvidenceQuality {
  return patch === undefined ? base : { ...base, ...patch };
}

export function classifyRecord(record: EvidenceRecord): {
  readonly status: EvidenceStatus;
  readonly usable: boolean;
  readonly reason: string;
} {
  if (record.status === "redacted" || record.quality.privacyFit === "redacted") {
    return { status: "redacted", usable: false, reason: "artifact is redacted" };
  }
  if (record.status === "unavailable") return { status: "unavailable", usable: false, reason: "artifact is unavailable" };
  if (record.status === "stale" || record.quality.freshnessStatus === "stale") {
    return { status: "stale", usable: false, reason: "evidence is stale" };
  }
  if (record.status !== "accepted_for_evaluation") {
    return { status: record.status, usable: false, reason: "evidence is not accepted for evaluation" };
  }
  if (record.quality.privacyFit === "blocked" || record.quality.trustLevel === "blocked") {
    return { status: "waiting_policy", usable: false, reason: "evidence is blocked by policy or privacy" };
  }
  if (record.quality.trustLevel === "unsupported") return { status: record.status, usable: false, reason: "unsupported evidence" };
  return { status: record.status, usable: true, reason: "accepted evidence can be evaluated" };
}

export function relationMatchesDoD(relation: EvidenceRelation, dodRef: DoDRef): boolean {
  return relation.relatedDoDRef === undefined || relation.relatedDoDRef.id === dodRef.id;
}

export function supportingFor(record: EvidenceRecord, dodRef: DoDRef): boolean {
  return record.relationHints.some((relation) => relationMatchesDoD(relation, dodRef) && relation.relation === "supports");
}

export function contradictsFor(record: EvidenceRecord, dodRef: DoDRef): boolean {
  return record.relationHints.some((relation) => relationMatchesDoD(relation, dodRef) && relation.relation === "contradicts");
}

export function hasCriticalContradiction(record: EvidenceRecord, dodRef: DoDRef): boolean {
  return record.relationHints.some((relation) =>
    relationMatchesDoD(relation, dodRef) && relation.relation === "contradicts" && relation.criticality === "critical"
  );
}

export function canPassDoD(record: EvidenceRecord): boolean {
  return record.status === "accepted_for_evaluation"
    && record.quality.freshnessStatus !== "stale"
    && record.quality.privacyFit === "fit"
    && (record.quality.trustLevel === "strong" || record.quality.trustLevel === "moderate");
}

export function qualityRank(trust: TrustLevel): number {
  if (trust === "strong") return 4;
  if (trust === "moderate") return 3;
  if (trust === "weak") return 2;
  if (trust === "unsupported") return 1;
  return 0;
}

export function evaluationQualitySummary(records: readonly EvidenceRecord[]): string {
  if (records.length === 0) return "no supporting evidence";
  const best = records.reduce((current, item) =>
    qualityRank(item.quality.trustLevel) > qualityRank(current.quality.trustLevel) ? item : current
  );
  return `${best.quality.trustLevel} ${best.quality.observationKind}; ${records.length} supporting evidence item(s)`;
}

export function requiredEvidenceText(dod: DoDItemRecord): string {
  return compact(dod.evidenceRequirement || dod.validationIntent || dod.statement, 1_000);
}

export function artifactUsableForReadiness(record: ArtifactRecord): boolean {
  return lifecycleUsableForReadiness(record.lifecycle);
}

export function lifecycleUsableForReadiness(lifecycle: string): boolean {
  return lifecycle === "active" || lifecycle === "registered" || lifecycle === "archived";
}

export function lifecycleFromVerdict(verdict: ReadinessVerdict): GrowLifecycle {
  if (verdict === "ready_to_hatch") return "ready_to_hatch";
  if (verdict === "waiting_input") return "waiting_input";
  if (verdict === "waiting_feedback") return "waiting_feedback";
  if (verdict === "waiting_validation") return "verifying";
  if (verdict === "blocked") return "blocked";
  if (verdict === "continue_grow") return "growing";
  return "planning";
}

export function uniqueById<T extends { readonly id: string }>(items: readonly T[]): readonly T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function quality(observationKind: EvidenceQuality["observationKind"], trustLevel: TrustLevel, explanation: string): EvidenceQuality {
  return {
    observationKind,
    trustLevel,
    reproducibility: "unknown",
    freshnessStatus: "current",
    scopeFit: "fit",
    privacyFit: "fit",
    contradictionRisk: "unknown",
    explanation
  };
}

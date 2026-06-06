import type {
  DoDEvaluationId,
  DoDEvaluationRef,
  EvidenceId,
  EvidenceRef,
  ReadinessAssessmentId,
  ReadinessAssessmentRef,
  ReadinessGapId,
  ReadinessGapRef,
  ReadinessVerdictId,
  ReadinessVerdictRef
} from "./types.js";

export const makeEvidenceRef = (id: EvidenceId): EvidenceRef => ({ kind: "evidence", id, uri: `evidence://${id}` });
export const makeDoDEvaluationRef = (id: DoDEvaluationId): DoDEvaluationRef => ({
  kind: "dod_evaluation",
  id,
  uri: `dod-evaluation://${id}`
});
export const makeReadinessAssessmentRef = (id: ReadinessAssessmentId): ReadinessAssessmentRef => ({
  kind: "readiness_assessment",
  id,
  uri: `readiness-assessment://${id}`
});
export const makeReadinessVerdictRef = (id: ReadinessVerdictId): ReadinessVerdictRef => ({
  kind: "readiness_verdict",
  id,
  uri: `readiness-verdict://${id}`
});
export const makeReadinessGapRef = (id: ReadinessGapId): ReadinessGapRef => ({
  kind: "readiness_gap",
  id,
  uri: `readiness-gap://${id}`
});

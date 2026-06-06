import type {
  DoDEvaluationId,
  EvidenceId,
  ReadinessAssessmentId,
  ReadinessGapId,
  ReadinessVerdictId
} from "./types.js";

const root = ".feng/evidence-readiness";

export const evidenceIndexPath = `${root}/evidence/index.json`;
export const evaluationIndexPath = `${root}/dod-evaluations/index.json`;
export const assessmentIndexPath = `${root}/readiness/assessments/index.json`;
export const gapIndexPath = `${root}/readiness/gaps/index.json`;
export const verdictIndexPath = `${root}/readiness/verdicts/index.json`;

export const evidenceRecordPath = (id: EvidenceId): string => `${root}/evidence/records/${id}.json`;
export const evaluationRecordPath = (id: DoDEvaluationId): string => `${root}/dod-evaluations/${id}.json`;
export const assessmentRecordPath = (id: ReadinessAssessmentId): string =>
  `${root}/readiness/assessments/${id}.json`;
export const gapRecordPath = (id: ReadinessGapId): string => `${root}/readiness/gaps/${id}.json`;
export const verdictRecordPath = (id: ReadinessVerdictId): string => `${root}/readiness/verdicts/${id}.json`;

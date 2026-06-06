import { makeNonEmptyBrand } from "../domain/brand.js";
import type {
  DoDEvaluationId,
  EvidenceId,
  ReadinessAssessmentId,
  ReadinessGapId,
  ReadinessVerdictId
} from "./types.js";

export const makeEvidenceId = (value: string): EvidenceId => makeNonEmptyBrand("EvidenceId", value);
export const makeDoDEvaluationId = (value: string): DoDEvaluationId =>
  makeNonEmptyBrand("DoDEvaluationId", value);
export const makeReadinessAssessmentId = (value: string): ReadinessAssessmentId =>
  makeNonEmptyBrand("ReadinessAssessmentId", value);
export const makeReadinessVerdictId = (value: string): ReadinessVerdictId =>
  makeNonEmptyBrand("ReadinessVerdictId", value);
export const makeReadinessGapId = (value: string): ReadinessGapId =>
  makeNonEmptyBrand("ReadinessGapId", value);

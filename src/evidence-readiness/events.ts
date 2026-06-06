import type { GrowUnitRef } from "../domain/index.js";
import { makeLedgerStreamId, type LedgerStream } from "../event-ledger/index.js";

export const evidenceEventTypes = {
  candidateRecorded: "evidence_candidate_recorded",
  classified: "evidence_classified",
  acceptedForEvaluation: "evidence_accepted_for_evaluation",
  rejected: "evidence_rejected",
  markedStale: "evidence_marked_stale",
  redacted: "evidence_redacted",
  unavailable: "evidence_unavailable",
  dodEvaluationCreated: "dod_evaluation_created",
  readinessAssessmentCreated: "readiness_assessment_created",
  readinessGapRecorded: "readiness_gap_recorded",
  readinessVerdictRecorded: "readiness_verdict_recorded",
  readinessVerdictSuperseded: "readiness_verdict_superseded",
  readinessReportRegistered: "readiness_report_registered"
} as const;

export function evidenceGrowStream(growUnitRef: GrowUnitRef): LedgerStream {
  return { streamType: "grow_unit", streamId: makeLedgerStreamId(growUnitRef.id) };
}

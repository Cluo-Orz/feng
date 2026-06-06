import { evaluateActiveDoDRecords, evaluateDoDRecord, explainDoDEvaluationRecord } from "./evaluation-flow.js";
import {
  acceptEvidenceRecord,
  classifyEvidenceRecord,
  listEvidenceRecords,
  markEvidenceStaleRecord,
  recordEvidenceCandidate,
  rejectEvidenceRecord
} from "./evidence-flow.js";
import {
  assessReadinessRecord,
  explainReadinessVerdictRecord,
  produceReadinessVerdictRecord
} from "./readiness-flow.js";
import { createEvidenceRuntime, type EvidenceRuntime } from "./runtime.js";
import { buildEvidenceSummaryRecord, buildReadinessSummaryRecord } from "./summary-flow.js";
import type { GrowUnitRef } from "../domain/index.js";
import type { DoDRef } from "../agenda-dod-manager/index.js";
import type {
  AssessReadinessOptions,
  DoDEvaluationRef,
  EvaluateDoDOptions,
  EvidenceQuery,
  EvidenceReadiness,
  EvidenceReadinessOptions,
  EvidenceRef,
  EvidenceTransitionInput,
  ReadinessAssessmentRef,
  ReadinessVerdictRef,
  RecordEvidenceCandidateInput
} from "./types.js";

export function createEvidenceReadiness(options: EvidenceReadinessOptions): EvidenceReadiness {
  return new NodeEvidenceReadiness(createEvidenceRuntime(options));
}

class NodeEvidenceReadiness implements EvidenceReadiness {
  constructor(private readonly runtime: EvidenceRuntime) {}

  recordEvidenceCandidate(input: RecordEvidenceCandidateInput) {
    return recordEvidenceCandidate(this.runtime, input);
  }

  classifyEvidence(evidenceRef: EvidenceRef) {
    return classifyEvidenceRecord(this.runtime, evidenceRef);
  }

  acceptEvidenceForEvaluation(evidenceRef: EvidenceRef, input: EvidenceTransitionInput) {
    return acceptEvidenceRecord(this.runtime, evidenceRef, input);
  }

  rejectEvidence(evidenceRef: EvidenceRef, input: EvidenceTransitionInput) {
    return rejectEvidenceRecord(this.runtime, evidenceRef, input);
  }

  markEvidenceStale(evidenceRef: EvidenceRef, input: EvidenceTransitionInput) {
    return markEvidenceStaleRecord(this.runtime, evidenceRef, input);
  }

  listEvidence(growUnitRef: GrowUnitRef, query?: EvidenceQuery) {
    return listEvidenceRecords(this.runtime, growUnitRef, query);
  }

  evaluateDoD(dodRef: DoDRef, options: EvaluateDoDOptions) {
    return evaluateDoDRecord(this.runtime, dodRef, options);
  }

  evaluateActiveDoD(growUnitRef: GrowUnitRef, options: EvaluateDoDOptions) {
    return evaluateActiveDoDRecords(this.runtime, growUnitRef, options);
  }

  explainDoDEvaluation(evaluationRef: DoDEvaluationRef) {
    return explainDoDEvaluationRecord(this.runtime, evaluationRef);
  }

  assessReadiness(growUnitRef: GrowUnitRef, options: AssessReadinessOptions) {
    return assessReadinessRecord(this.runtime, growUnitRef, options);
  }

  produceReadinessVerdict(assessmentRef: ReadinessAssessmentRef) {
    return produceReadinessVerdictRecord(this.runtime, assessmentRef);
  }

  explainReadinessVerdict(verdictRef: ReadinessVerdictRef) {
    return explainReadinessVerdictRecord(this.runtime, verdictRef);
  }

  buildEvidenceSummary(growUnitRef: GrowUnitRef) {
    return buildEvidenceSummaryRecord(this.runtime, growUnitRef);
  }

  buildReadinessSummary(growUnitRef: GrowUnitRef) {
    return buildReadinessSummaryRecord(this.runtime, growUnitRef);
  }
}

import type { BrandedString } from "../domain/brand.js";
import type {
  ArtifactRef,
  AttemptRef,
  AuditDescriptor,
  FeedbackUnitRef,
  GrowLifecycle,
  GrowUnitRef,
  PolicyDecisionId,
  PrivacyLevel,
  ReadinessVerdict,
  SourceDescriptor,
  ValidationReportRef,
  VersionDescriptor
} from "../domain/index.js";
import type { Result } from "../domain/result.js";
import type { ArtifactKind, ArtifactRegistry, RetentionClass } from "../artifact-registry/index.js";
import type { DoDItemRecord, DoDRef } from "../agenda-dod-manager/index.js";
import type { AgendaDoDManager } from "../agenda-dod-manager/index.js";
import type { AdmissionFeedbackInbox } from "../admission-feedback-inbox/index.js";
import type { EventAppendReceipt, EventLedger } from "../event-ledger/index.js";
import type { FileNativeStore, WorkspaceHandle, WriteReceipt } from "../file-store/index.js";
import type { GrowUnitManager } from "../grow-unit-manager/index.js";
import type { PolicyBoundary, PolicyContext, PolicyDecision } from "../policy-boundary/index.js";

export type EvidenceId = BrandedString<"EvidenceId">;
export type DoDEvaluationId = BrandedString<"DoDEvaluationId">;
export type ReadinessAssessmentId = BrandedString<"ReadinessAssessmentId">;
export type ReadinessVerdictId = BrandedString<"ReadinessVerdictId">;
export type ReadinessGapId = BrandedString<"ReadinessGapId">;

export interface EvidenceRef { readonly kind: "evidence"; readonly id: EvidenceId; readonly uri?: string; }
export interface DoDEvaluationRef { readonly kind: "dod_evaluation"; readonly id: DoDEvaluationId; readonly uri?: string; }
export interface ReadinessAssessmentRef {
  readonly kind: "readiness_assessment";
  readonly id: ReadinessAssessmentId;
  readonly uri?: string;
}
export interface ReadinessVerdictRef {
  readonly kind: "readiness_verdict";
  readonly id: ReadinessVerdictId;
  readonly uri?: string;
}
export interface ReadinessGapRef { readonly kind: "readiness_gap"; readonly id: ReadinessGapId; readonly uri?: string; }

export type EvidenceSourceKind =
  | "attempt_outcome" | "candidate_output" | "tool_result" | "validation_report" | "attempt_trace"
  | "runtime_trace" | "feedback_evidence" | "manual_review" | "policy_decision" | "artifact_metadata"
  | "external_test_report" | "llm_judge_report" | "unknown";

export type EvidenceStatus =
  | "candidate" | "accepted_for_evaluation" | "rejected" | "waiting_policy" | "waiting_human"
  | "waiting_validation" | "stale" | "superseded" | "redacted" | "unavailable";

export type ObservationKind =
  | "observed_runtime" | "tool_measured" | "test_reported" | "manual_reviewed" | "model_self_claim"
  | "model_judged" | "derived_summary" | "unknown";
export type TrustLevel = "strong" | "moderate" | "weak" | "unsupported" | "blocked";
export type EvidenceRelationKind =
  | "supports" | "contradicts" | "inconclusive" | "out_of_scope" | "stale_for_scope"
  | "blocked_by_policy" | "missing_required_evidence";
export type DoDEvaluationStatus =
  | "passed" | "failed" | "unknown" | "blocked" | "needs_input" | "needs_validation" | "stale"
  | "not_applicable";
export type ReadinessGapKind =
  | "missing_evidence" | "contradicting_evidence" | "stale_evidence" | "artifact_unavailable"
  | "privacy_blocked" | "policy_blocked" | "validation_environment_missing" | "target_world_unverified"
  | "runtime_contract_unverified" | "manual_review_required" | "feedback_required";

export interface EvidenceQuality {
  readonly observationKind: ObservationKind;
  readonly trustLevel: TrustLevel;
  readonly reproducibility: string;
  readonly freshnessStatus: "current" | "stale" | "unknown";
  readonly scopeFit: "fit" | "partial" | "out_of_scope" | "unknown";
  readonly privacyFit: "fit" | "redacted" | "blocked" | "unknown";
  readonly contradictionRisk: "none" | "low" | "medium" | "high" | "critical" | "unknown";
  readonly explanation: string;
}

export interface EvidenceRelation {
  readonly relation: EvidenceRelationKind;
  readonly relatedDoDRef?: DoDRef;
  readonly relatedEvidenceRef?: EvidenceRef;
  readonly relatedArtifactRef?: ArtifactRef;
  readonly criticality: "normal" | "critical";
  readonly reason: string;
}

export interface EvidenceRecord {
  readonly evidenceId: EvidenceId;
  readonly evidenceRef: EvidenceRef;
  readonly growUnitRef: GrowUnitRef;
  readonly sourceKind: EvidenceSourceKind;
  readonly status: EvidenceStatus;
  readonly summary: string;
  readonly artifactRef?: ArtifactRef;
  readonly relatedAttemptRef?: AttemptRef;
  readonly relatedFeedbackRef?: FeedbackUnitRef;
  readonly relationHints: readonly EvidenceRelation[];
  readonly quality: EvidenceQuality;
  readonly policyDecisionRefs: readonly PolicyDecisionId[];
  readonly scope: string;
  readonly rejectionReason?: string;
  readonly staleReason?: string;
  readonly acceptedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
  readonly recordVersion: number;
}

export interface RecordEvidenceCandidateInput {
  readonly growUnitRef: GrowUnitRef;
  readonly sourceKind: EvidenceSourceKind;
  readonly summary: string;
  readonly artifactRef?: ArtifactRef;
  readonly content?: string | Uint8Array;
  readonly artifactKind?: ArtifactKind;
  readonly mediaType?: string;
  readonly encoding?: "utf8" | "binary";
  readonly privacyClass?: PrivacyLevel;
  readonly retentionClass?: RetentionClass;
  readonly relatedAttemptRef?: AttemptRef;
  readonly relatedFeedbackRef?: FeedbackUnitRef;
  readonly relationHints?: readonly EvidenceRelation[];
  readonly quality?: Partial<EvidenceQuality>;
  readonly scope?: string;
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
}

export interface EvidenceClassification {
  readonly evidenceRef: EvidenceRef;
  readonly status: EvidenceStatus;
  readonly quality: EvidenceQuality;
  readonly relations: readonly EvidenceRelation[];
  readonly usableForReadiness: boolean;
  readonly reason: string;
  readonly policyDecisionRefs: readonly PolicyDecisionId[];
  readonly classifiedAt: string;
}

export interface EvidenceTransitionInput {
  readonly reason: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly policyContext?: PolicyContext;
}

export interface EvidenceReceipt {
  readonly evidenceRef: EvidenceRef;
  readonly from: EvidenceStatus;
  readonly to: EvidenceStatus;
  readonly policyDecision?: PolicyDecision;
  readonly eventReceipt?: EventAppendReceipt;
  readonly recordWriteReceipt?: WriteReceipt;
}

export interface EvidenceQuery {
  readonly status?: EvidenceStatus;
  readonly sourceKind?: EvidenceSourceKind;
  readonly text?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface EvidencePage {
  readonly records: readonly EvidenceRecord[];
  readonly total: number;
  readonly nextCursor?: string;
  readonly truncated: boolean;
}

export interface DoDEvaluation {
  readonly dodEvaluationId: DoDEvaluationId;
  readonly dodEvaluationRef: DoDEvaluationRef;
  readonly dodRef: DoDRef;
  readonly growUnitRef: GrowUnitRef;
  readonly status: DoDEvaluationStatus;
  readonly supportingEvidenceRefs: readonly EvidenceRef[];
  readonly contradictingEvidenceRefs: readonly EvidenceRef[];
  readonly supportingArtifactRefs: readonly ArtifactRef[];
  readonly contradictingArtifactRefs: readonly ArtifactRef[];
  readonly missingEvidence: readonly string[];
  readonly blockedReasons: readonly string[];
  readonly evaluationScope: string;
  readonly evidenceQualitySummary: string;
  readonly explanation: string;
  readonly createdAt: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface EvaluateDoDOptions {
  readonly growUnitRef?: GrowUnitRef;
  readonly evidenceRefs?: readonly EvidenceRef[];
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface DoDEvaluationSet {
  readonly growUnitRef: GrowUnitRef;
  readonly evaluations: readonly DoDEvaluation[];
  readonly createdAt: string;
}

export interface ReadinessGap {
  readonly readinessGapId: ReadinessGapId;
  readonly readinessGapRef: ReadinessGapRef;
  readonly growUnitRef: GrowUnitRef;
  readonly kind: ReadinessGapKind;
  readonly summary: string;
  readonly relatedDoDRefs: readonly DoDRef[];
  readonly relatedEvidenceRefs: readonly EvidenceRef[];
  readonly requiredInput: readonly string[];
  readonly requiredValidation: readonly string[];
  readonly requiredFeedback: readonly string[];
  readonly blocking: boolean;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly createdAt: string;
}

export interface ReadinessAssessment {
  readonly readinessAssessmentId: ReadinessAssessmentId;
  readonly readinessAssessmentRef: ReadinessAssessmentRef;
  readonly growUnitRef: GrowUnitRef;
  readonly agendaSummaryRef: ArtifactRef;
  readonly activeDoDRefs: readonly DoDRef[];
  readonly dodEvaluationRefs: readonly DoDEvaluationRef[];
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly attemptOutcomeRefs: readonly ArtifactRef[];
  readonly validationReportRefs: readonly ArtifactRef[];
  readonly feedbackEvidenceRefs: readonly ArtifactRef[];
  readonly readinessGapRefs: readonly ReadinessGapRef[];
  readonly riskSummary: string;
  readonly privacySummary: string;
  readonly policyDecisionRefs: readonly PolicyDecisionId[];
  readonly createdAt: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface AssessReadinessOptions {
  readonly evidenceRefs?: readonly EvidenceRef[];
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface ReadinessVerdictRecord {
  readonly readinessVerdictId: ReadinessVerdictId;
  readonly readinessVerdictRef: ReadinessVerdictRef;
  readonly artifactRef: ArtifactRef;
  readonly growUnitRef: GrowUnitRef;
  readonly assessmentRef: ReadinessAssessmentRef;
  readonly verdict: ReadinessVerdict;
  readonly reason: string;
  readonly dodEvaluationRefs: readonly DoDEvaluationRef[];
  readonly requiredInput: readonly string[];
  readonly requiredFeedback: readonly string[];
  readonly requiredValidation: readonly string[];
  readonly blockingGaps: readonly ReadinessGapRef[];
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly evidenceArtifactRefs: readonly ArtifactRef[];
  readonly policyDecisionRefs: readonly PolicyDecisionId[];
  readonly recommendedGrowLifecycle: GrowLifecycle;
  readonly createdAt: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface ReadinessExplanation {
  readonly verdictRef: ReadinessVerdictRef;
  readonly artifactRef: ArtifactRef;
  readonly summary: string;
  readonly facts: readonly string[];
}

export interface DoDEvaluationExplanation {
  readonly evaluationRef: DoDEvaluationRef;
  readonly summary: string;
  readonly facts: readonly string[];
}

export interface EvidenceSummary {
  readonly growUnitRef: GrowUnitRef;
  readonly total: number;
  readonly accepted: number;
  readonly blocked: number;
  readonly stale: number;
  readonly latestEvidenceRefs: readonly EvidenceRef[];
  readonly builtAt: string;
}

export interface ReadinessSummary {
  readonly growUnitRef: GrowUnitRef;
  readonly latestVerdictRef?: ReadinessVerdictRef;
  readonly latestVerdictArtifactRef?: ArtifactRef;
  readonly verdict?: ReadinessVerdict;
  readonly readyToHatch: boolean;
  readonly activeDoDCount: number;
  readonly blockingGapCount: number;
  readonly builtAt: string;
}

export interface EvidenceReadinessOptions {
  readonly workspace: WorkspaceHandle;
  readonly store: FileNativeStore;
  readonly ledger: EventLedger;
  readonly artifactRegistry: ArtifactRegistry;
  readonly policyBoundary: PolicyBoundary;
  readonly growUnitManager: GrowUnitManager;
  readonly admissionInbox: AdmissionFeedbackInbox;
  readonly agendaDoDManager: AgendaDoDManager;
  readonly producer: string;
}

export interface EvidenceReadiness {
  readonly recordEvidenceCandidate: (input: RecordEvidenceCandidateInput) => Promise<Result<EvidenceRef>>;
  readonly classifyEvidence: (evidenceRef: EvidenceRef) => Promise<Result<EvidenceClassification>>;
  readonly acceptEvidenceForEvaluation: (evidenceRef: EvidenceRef, input: EvidenceTransitionInput) => Promise<Result<EvidenceReceipt>>;
  readonly rejectEvidence: (evidenceRef: EvidenceRef, input: EvidenceTransitionInput) => Promise<Result<EvidenceReceipt>>;
  readonly markEvidenceStale: (evidenceRef: EvidenceRef, input: EvidenceTransitionInput) => Promise<Result<EvidenceReceipt>>;
  readonly listEvidence: (growUnitRef: GrowUnitRef, query?: EvidenceQuery) => Promise<Result<EvidencePage>>;
  readonly evaluateDoD: (dodRef: DoDRef, options: EvaluateDoDOptions) => Promise<Result<DoDEvaluation>>;
  readonly evaluateActiveDoD: (growUnitRef: GrowUnitRef, options: EvaluateDoDOptions) => Promise<Result<DoDEvaluationSet>>;
  readonly explainDoDEvaluation: (evaluationRef: DoDEvaluationRef) => Promise<Result<DoDEvaluationExplanation>>;
  readonly assessReadiness: (growUnitRef: GrowUnitRef, options: AssessReadinessOptions) => Promise<Result<ReadinessAssessment>>;
  readonly produceReadinessVerdict: (assessmentRef: ReadinessAssessmentRef) => Promise<Result<ReadinessVerdictRecord>>;
  readonly explainReadinessVerdict: (verdictRef: ReadinessVerdictRef) => Promise<Result<ReadinessExplanation>>;
  readonly buildEvidenceSummary: (growUnitRef: GrowUnitRef) => Promise<Result<EvidenceSummary>>;
  readonly buildReadinessSummary: (growUnitRef: GrowUnitRef) => Promise<Result<ReadinessSummary>>;
}

export interface EvidenceIndex { readonly evidenceRefs: readonly EvidenceRef[]; }
export interface EvaluationIndex { readonly evaluationRefs: readonly DoDEvaluationRef[]; }
export interface AssessmentIndex { readonly assessmentRefs: readonly ReadinessAssessmentRef[]; }
export interface GapIndex { readonly gapRefs: readonly ReadinessGapRef[]; }
export interface VerdictIndex { readonly verdictRefs: readonly ReadinessVerdictRef[]; }

export interface EvaluationContext {
  readonly dod: DoDItemRecord;
  readonly evidence: readonly EvidenceRecord[];
}

import type {
  ArtifactRef,
  AuditDescriptor,
  FeedbackUnitRef,
  GrowUnitRef,
  HatchPackageRef,
  PolicyDecisionId,
  PrivacyLevel,
  RuntimeContractRef,
  SkillRef,
  SourceDescriptor,
  TargetWorldRef
} from "../domain/index.js";
import type {
  RuntimeFeedbackCandidateHintRef,
  RuntimeInvocationRef,
  RuntimeTraceRef
} from "../agent-runtime-kernel/index.js";
import type {
  TargetDebugSignalRef,
  TargetFailureMappingRef,
  TargetValidationReportRef
} from "../target-world-adapter/index.js";
import type { UpstreamProposalRef } from "../admission-feedback-inbox/index.js";
import type {
  DebugCorrelationId,
  FeedbackAttributionId,
  FeedbackBridgePacketId,
  PrivacyFilterResultId,
  RuntimeReportEnvelopeId,
  UpstreamProposalRequestId
} from "./brand.js";

export const bridgeModes = [
  "runtime_debug",
  "developer_debug",
  "replay_debug",
  "feedback_reporting",
  "upstream_proposal",
  "manual_review"
] as const;
export type BridgeMode = (typeof bridgeModes)[number];

export const correlationStatuses = [
  "created",
  "collecting",
  "normalized",
  "waiting_policy",
  "waiting_human",
  "packet_built",
  "submitted_local",
  "proposed_upstream",
  "local_only",
  "rejected",
  "closed",
  "archived"
] as const;
export type CorrelationStatus = (typeof correlationStatuses)[number];

export const reportSourceKinds = [
  "runtime_trace",
  "target_debug_signal",
  "runtime_feedback_hint",
  "failure_mapping",
  "validation_report",
  "manual_observation",
  "external_runtime_report"
] as const;
export type ReportSourceKind = (typeof reportSourceKinds)[number];

export const bridgeLayers = [
  "current_project",
  "target_agent_project",
  "upstream_feng_project",
  "external_runtime",
  "target_world_adapter",
  "runtime_kernel",
  "feedback_router",
  "unknown"
] as const;
export type BridgeLayer = (typeof bridgeLayers)[number];

export const confidenceLevels = ["high", "medium", "low", "unknown"] as const;
export type ConfidenceLevel = (typeof confidenceLevels)[number];

export const privacyDecisions = [
  "pass_local",
  "redact_then_local",
  "redact_then_upstream_candidate",
  "block_upstream",
  "block_all",
  "waiting_policy",
  "waiting_human"
] as const;
export type PrivacyDecision = (typeof privacyDecisions)[number];

export const bridgeImpacts = [
  "runtime_failure",
  "quality_regression",
  "contract_gap",
  "adapter_gap",
  "kernel_gap",
  "feedback_policy_gap",
  "context_gap",
  "tool_gap",
  "target_world_gap",
  "unknown"
] as const;
export type BridgeImpact = (typeof bridgeImpacts)[number];

export const suggestedActions = [
  "keep_local_observation",
  "create_local_feedback_candidate",
  "request_more_evidence",
  "request_human_review",
  "propose_to_target_agent",
  "propose_to_upstream_feng",
  "reject_as_noise",
  "quarantine"
] as const;
export type SuggestedAction = (typeof suggestedActions)[number];

export interface DebugCorrelationRef {
  readonly kind: "debug_correlation";
  readonly id: DebugCorrelationId;
  readonly uri?: string;
}
export interface RuntimeReportEnvelopeRef {
  readonly kind: "runtime_report_envelope";
  readonly id: RuntimeReportEnvelopeId;
  readonly uri?: string;
}
export interface FeedbackAttributionRef {
  readonly kind: "feedback_attribution";
  readonly id: FeedbackAttributionId;
  readonly uri?: string;
}
export interface PrivacyFilterResultRef {
  readonly kind: "privacy_filter_result";
  readonly id: PrivacyFilterResultId;
  readonly uri?: string;
}
export interface FeedbackBridgePacketRef {
  readonly kind: "feedback_bridge_packet";
  readonly id: FeedbackBridgePacketId;
  readonly uri?: string;
}
export interface UpstreamProposalRequestRef {
  readonly kind: "upstream_proposal_request";
  readonly id: UpstreamProposalRequestId;
  readonly uri?: string;
}

export interface DebugCorrelation {
  readonly debugCorrelationId: DebugCorrelationId;
  readonly debugCorrelationRef: DebugCorrelationRef;
  readonly originGrowUnitRef: GrowUnitRef;
  readonly targetGrowUnitRef?: GrowUnitRef;
  readonly hatchPackageRef: HatchPackageRef;
  readonly runtimeContractRef: RuntimeContractRef;
  readonly targetWorldRef?: TargetWorldRef;
  readonly runtimeInvocationRefs: readonly RuntimeInvocationRef[];
  readonly runtimeTraceRefs: readonly RuntimeTraceRef[];
  readonly debugSignalRefs: readonly TargetDebugSignalRef[];
  readonly feedbackHintRefs: readonly RuntimeFeedbackCandidateHintRef[];
  readonly envelopeRefs: readonly RuntimeReportEnvelopeRef[];
  readonly mode: BridgeMode;
  readonly status: CorrelationStatus;
  readonly privacyBoundary: PrivacyLevel;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt?: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly recordVersion: number;
}

export interface RuntimeReportEnvelope {
  readonly runtimeReportId: RuntimeReportEnvelopeId;
  readonly runtimeReportRef: RuntimeReportEnvelopeRef;
  readonly debugCorrelationRef: DebugCorrelationRef;
  readonly sourceKind: ReportSourceKind;
  readonly runtimeTraceRef?: RuntimeTraceRef;
  readonly debugSignalRef?: TargetDebugSignalRef;
  readonly feedbackHintRef?: RuntimeFeedbackCandidateHintRef;
  readonly failureMappingRef?: TargetFailureMappingRef;
  readonly validationReportRef?: TargetValidationReportRef;
  readonly summary: string;
  readonly evidenceRefs: readonly ArtifactRef[];
  readonly privacyClass: PrivacyLevel;
  readonly sourceLayer: BridgeLayer;
  readonly targetLayerHint: BridgeLayer;
  readonly attributionHint: string;
  readonly receivedAt: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly recordVersion: number;
}

export interface FeedbackAttribution {
  readonly attributionId: FeedbackAttributionId;
  readonly attributionRef: FeedbackAttributionRef;
  readonly debugCorrelationRef: DebugCorrelationRef;
  readonly originLayer: BridgeLayer;
  readonly candidateTargetLayer: BridgeLayer;
  readonly confidence: ConfidenceLevel;
  readonly reason: string;
  readonly evidenceRefs: readonly ArtifactRef[];
  readonly counterEvidenceRefs: readonly ArtifactRef[];
  readonly sourceRefs: readonly RuntimeReportEnvelopeRef[];
  readonly routerVersionRef?: SkillRef;
  readonly upstreamEligible: boolean;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface PrivacyFilterResult {
  readonly privacyFilterId: PrivacyFilterResultId;
  readonly privacyFilterRef: PrivacyFilterResultRef;
  readonly debugCorrelationRef: DebugCorrelationRef;
  readonly inputArtifactRefs: readonly ArtifactRef[];
  readonly originalPrivacyClasses: readonly PrivacyLevel[];
  readonly resultPrivacyClass: PrivacyLevel;
  readonly redactedSummaryRef?: ArtifactRef;
  readonly redactedEvidenceRefs: readonly ArtifactRef[];
  readonly blockedRefs: readonly ArtifactRef[];
  readonly policyDecisionId?: PolicyDecisionId;
  readonly decision: PrivacyDecision;
  readonly reason: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface FeedbackBridgePacket {
  readonly bridgePacketId: FeedbackBridgePacketId;
  readonly bridgePacketRef: FeedbackBridgePacketRef;
  readonly debugCorrelationRef: DebugCorrelationRef;
  readonly originGrowUnitRef: GrowUnitRef;
  readonly targetGrowUnitRef?: GrowUnitRef;
  readonly summary: string;
  readonly detailRef?: ArtifactRef;
  readonly redactedSummaryRef?: ArtifactRef;
  readonly evidenceRefs: readonly ArtifactRef[];
  readonly runtimeTraceRefs: readonly RuntimeTraceRef[];
  readonly debugSignalRefs: readonly TargetDebugSignalRef[];
  readonly attribution: FeedbackAttribution;
  readonly privacy: PrivacyFilterResult;
  readonly impact: BridgeImpact;
  readonly suggestedAction: SuggestedAction;
  readonly privacyClass: PrivacyLevel;
  readonly policyDecisionId?: PolicyDecisionId;
  readonly routerTraceRef?: ArtifactRef;
  readonly contractRefs: readonly RuntimeContractRef[];
  readonly localOnlyReason?: string;
  readonly feedbackUnitRef?: FeedbackUnitRef;
  readonly upstreamProposalRef?: UpstreamProposalRef;
  readonly status: CorrelationStatus;
  readonly createdAt: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly recordVersion: number;
}

export interface UpstreamProposalRequest {
  readonly upstreamProposalRequestId: UpstreamProposalRequestId;
  readonly upstreamProposalRequestRef: UpstreamProposalRequestRef;
  readonly debugCorrelationRef: DebugCorrelationRef;
  readonly feedbackUnitRefs: readonly FeedbackUnitRef[];
  readonly fromGrowUnitRef: GrowUnitRef;
  readonly toGrowUnitRef: GrowUnitRef;
  readonly summary: string;
  readonly redactedSummaryRef: ArtifactRef;
  readonly evidenceRefs: readonly ArtifactRef[];
  readonly policyDecisionId?: PolicyDecisionId;
  readonly attribution: string;
  readonly reason: string;
  readonly upstreamProposalRef: UpstreamProposalRef;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface RefIndex<T> {
  readonly refs: readonly T[];
}

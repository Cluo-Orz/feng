import type {
  ArtifactRef,
  AuditDescriptor,
  GrowUnitRef,
  HatchPackageRef,
  PrivacyLevel,
  RuntimeContractRef,
  SourceDescriptor,
  TargetWorldRef
} from "../domain/index.js";
import type { Result } from "../domain/result.js";
import type { EventAppendReceipt } from "../event-ledger/index.js";
import type { WriteReceipt, WorkspaceHandle, FileNativeStore } from "../file-store/index.js";
import type { ArtifactRegistry } from "../artifact-registry/index.js";
import type { EventLedger } from "../event-ledger/index.js";
import type { PolicyBoundary, PolicyContext, PolicyDecision } from "../policy-boundary/index.js";
import type { SkillRegistry } from "../skill-registry/index.js";
import type { RuntimeContractRegistry } from "../runtime-contract-registry/index.js";
import type { HatchBuilder } from "../hatch-builder/index.js";
import type { TargetWorldAdapter } from "../target-world-adapter/index.js";
import type { AgentRuntimeKernel } from "../agent-runtime-kernel/index.js";
import type { AdmissionFeedbackInbox } from "../admission-feedback-inbox/index.js";
import type {
  RuntimeFeedbackCandidateHintRef,
  RuntimeInvocationRef,
  RuntimeTraceRef
} from "../agent-runtime-kernel/index.js";
import type { TargetDebugSignalRef } from "../target-world-adapter/index.js";
import type {
  BridgeImpact,
  BridgeLayer,
  BridgeMode,
  ConfidenceLevel,
  CorrelationStatus,
  DebugCorrelation,
  DebugCorrelationRef,
  FeedbackBridgePacket,
  FeedbackBridgePacketRef,
  PrivacyFilterResult,
  PrivacyFilterResultRef,
  RuntimeReportEnvelope,
  RuntimeReportEnvelopeRef,
  SuggestedAction,
  UpstreamProposalRequestRef
} from "./types.js";

export interface OpenDebugCorrelationInput {
  readonly originGrowUnitRef: GrowUnitRef;
  readonly targetGrowUnitRef?: GrowUnitRef;
  readonly hatchPackageRef: HatchPackageRef;
  readonly runtimeContractRef: RuntimeContractRef;
  readonly targetWorldRef?: TargetWorldRef;
  readonly mode: BridgeMode;
  readonly privacyBoundary: PrivacyLevel;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly correlationId?: string;
  readonly causationId?: string;
}

export interface ManualObservationInput {
  readonly summary: string;
  readonly detail?: string;
  readonly evidenceRefs?: readonly ArtifactRef[];
  readonly privacyClass: PrivacyLevel;
  readonly sourceLayer?: BridgeLayer;
  readonly targetLayerHint?: BridgeLayer;
  readonly attributionHint?: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface BuildBridgePacketInput {
  readonly envelopeRefs: readonly RuntimeReportEnvelopeRef[];
  readonly summary: string;
  readonly impact: BridgeImpact;
  readonly originLayer?: BridgeLayer;
  readonly candidateTargetLayer: BridgeLayer;
  readonly confidenceHint?: ConfidenceLevel;
  readonly evidenceRefs?: readonly ArtifactRef[];
  readonly counterEvidenceRefs?: readonly ArtifactRef[];
  readonly intent: "local" | "upstream";
  readonly policyContext?: PolicyContext;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface BridgePrivacyInput {
  readonly inputArtifactRefs: readonly ArtifactRef[];
  readonly privacyClasses: readonly PrivacyLevel[];
  readonly intent: "local" | "upstream";
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface BridgePolicyActionRequest {
  readonly debugCorrelationRef: DebugCorrelationRef;
  readonly capability: "debug_trace.upload" | "feedback.upstream" | "artifact.export";
  readonly resourceSummary: string;
  readonly operation: string;
  readonly reason: string;
  readonly source: SourceDescriptor;
  readonly policyContext?: PolicyContext;
}

export interface RequestUpstreamProposalInput {
  readonly bridgePacketRef: FeedbackBridgePacketRef;
  readonly toGrowUnitRef: GrowUnitRef;
  readonly reason: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly policyContext?: PolicyContext;
}

export interface RecordUpstreamBridgeResultInput {
  readonly result: "accepted_upstream" | "rejected" | "waiting_evidence" | "waiting_human";
  readonly reason: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface BridgeReceipt {
  readonly debugCorrelationRef: DebugCorrelationRef;
  readonly status: CorrelationStatus;
  readonly eventReceipt?: EventAppendReceipt;
  readonly recordWriteReceipt?: WriteReceipt;
}

export interface FeedbackBridgeExplanation {
  readonly bridgePacketRef: FeedbackBridgePacketRef;
  readonly summary: string;
  readonly facts: readonly string[];
  readonly excluded: readonly string[];
}

export interface FeedbackBridgePacketPage {
  readonly records: readonly FeedbackBridgePacket[];
  readonly total: number;
  readonly nextCursor?: string;
  readonly truncated: boolean;
}

export interface BridgePacketQuery {
  readonly status?: CorrelationStatus;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface DebugFeedbackBridgeOptions {
  readonly workspace: WorkspaceHandle;
  readonly store: FileNativeStore;
  readonly ledger: EventLedger;
  readonly artifactRegistry: ArtifactRegistry;
  readonly policyBoundary: PolicyBoundary;
  readonly skillRegistry: SkillRegistry;
  readonly runtimeContractRegistry: RuntimeContractRegistry;
  readonly hatchBuilder: HatchBuilder;
  readonly targetWorldAdapter: TargetWorldAdapter;
  readonly agentRuntimeKernel: AgentRuntimeKernel;
  readonly admissionInbox: AdmissionFeedbackInbox;
  readonly producer: string;
}

export interface DebugFeedbackBridge {
  readonly openDebugCorrelation: (input: OpenDebugCorrelationInput) => Promise<Result<DebugCorrelationRef>>;
  readonly linkRuntimeInvocation: (
    ref: DebugCorrelationRef,
    invocationRef: RuntimeInvocationRef
  ) => Promise<Result<BridgeReceipt>>;
  readonly linkRuntimeTrace: (ref: DebugCorrelationRef, traceRef: RuntimeTraceRef) => Promise<Result<BridgeReceipt>>;
  readonly linkDebugSignal: (
    ref: DebugCorrelationRef,
    signalRef: TargetDebugSignalRef
  ) => Promise<Result<BridgeReceipt>>;
  readonly closeDebugCorrelation: (ref: DebugCorrelationRef, reason: string) => Promise<Result<BridgeReceipt>>;
  readonly getDebugCorrelation: (ref: DebugCorrelationRef) => Promise<Result<DebugCorrelation>>;
  readonly ingestRuntimeTrace: (
    ref: DebugCorrelationRef,
    traceRef: RuntimeTraceRef
  ) => Promise<Result<RuntimeReportEnvelopeRef>>;
  readonly ingestTargetDebugSignal: (
    ref: DebugCorrelationRef,
    signalRef: TargetDebugSignalRef
  ) => Promise<Result<RuntimeReportEnvelopeRef>>;
  readonly ingestRuntimeFeedbackHint: (
    ref: DebugCorrelationRef,
    hintRef: RuntimeFeedbackCandidateHintRef
  ) => Promise<Result<RuntimeReportEnvelopeRef>>;
  readonly ingestManualObservation: (
    ref: DebugCorrelationRef,
    input: ManualObservationInput
  ) => Promise<Result<RuntimeReportEnvelopeRef>>;
  readonly getRuntimeReportEnvelope: (ref: RuntimeReportEnvelopeRef) => Promise<Result<RuntimeReportEnvelope>>;
  readonly buildFeedbackBridgePacket: (
    ref: DebugCorrelationRef,
    input: BuildBridgePacketInput
  ) => Promise<Result<FeedbackBridgePacketRef>>;
  readonly explainFeedbackBridgePacket: (
    ref: FeedbackBridgePacketRef
  ) => Promise<Result<FeedbackBridgeExplanation>>;
  readonly listBridgePackets: (
    ref: DebugCorrelationRef,
    query?: BridgePacketQuery
  ) => Promise<Result<FeedbackBridgePacketPage>>;
  readonly getFeedbackBridgePacket: (ref: FeedbackBridgePacketRef) => Promise<Result<FeedbackBridgePacket>>;
  readonly submitFeedbackCandidate: (ref: FeedbackBridgePacketRef) => Promise<Result<FeedbackBridgePacket>>;
  readonly requestUpstreamProposal: (
    input: RequestUpstreamProposalInput
  ) => Promise<Result<UpstreamProposalRequestRef>>;
  readonly recordUpstreamBridgeResult: (
    ref: UpstreamProposalRequestRef,
    input: RecordUpstreamBridgeResultInput
  ) => Promise<Result<BridgeReceipt>>;
  readonly evaluateBridgePrivacy: (
    ref: DebugCorrelationRef,
    input: BridgePrivacyInput
  ) => Promise<Result<PrivacyFilterResultRef>>;
  readonly evaluateBridgePolicy: (input: BridgePolicyActionRequest) => Promise<Result<PolicyDecision>>;
  readonly buildRedactedBridgeSummary: (
    ref: DebugCorrelationRef,
    inputRefs: readonly ArtifactRef[],
    summary: string,
    source: SourceDescriptor,
    audit: AuditDescriptor
  ) => Promise<Result<ArtifactRef>>;
}

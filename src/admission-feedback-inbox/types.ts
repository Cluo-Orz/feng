import type { BrandedString } from "../domain/brand.js";
import type {
  ArtifactRef,
  AuditDescriptor,
  FeedbackStatus,
  FeedbackUnitId,
  FeedbackUnitRef,
  GrowUnitRef,
  PolicyDecisionId,
  PrivacyLevel,
  SkillRef,
  SourceDescriptor,
  VersionDescriptor
} from "../domain/index.js";
import type { Result } from "../domain/result.js";
import type { ArtifactRegistry } from "../artifact-registry/index.js";
import type { EventAppendReceipt, EventLedger } from "../event-ledger/index.js";
import type { FileNativeStore, WorkspaceHandle, WriteReceipt } from "../file-store/index.js";
import type { PolicyBoundary, PolicyContext, PolicyDecision } from "../policy-boundary/index.js";
import type { SkillRegistry } from "../skill-registry/index.js";
import type { GrowUnitManager } from "../grow-unit-manager/index.js";

export type InboxItemId = BrandedString<"InboxItemId">;
export type UpstreamProposalId = BrandedString<"UpstreamProposalId">;

export interface InboxItemRef {
  readonly kind: "inbox_item";
  readonly id: InboxItemId;
  readonly uri?: string;
  readonly version?: string;
}

export interface UpstreamProposalRef {
  readonly kind: "upstream_proposal";
  readonly id: UpstreamProposalId;
  readonly uri?: string;
  readonly version?: string;
}

export const inboxSourceKinds = [
  "user_input",
  "file_material",
  "file_change",
  "runtime_report",
  "debug_trace",
  "tool_result_reference",
  "external_event",
  "upstream_proposal",
  "manual_review"
] as const;
export type InboxSourceKind = (typeof inboxSourceKinds)[number];

export const inboxItemStatuses = [
  "received",
  "normalized",
  "classified",
  "waiting_policy",
  "waiting_evidence",
  "waiting_human",
  "admitted",
  "rejected",
  "quarantined",
  "redacted",
  "archived"
] as const;
export type InboxItemStatus = (typeof inboxItemStatuses)[number];

export const admissionDecisionKinds = [
  "admit_as_material",
  "admit_as_goal_signal",
  "admit_as_feedback_candidate",
  "reject",
  "quarantine",
  "wait_for_evidence",
  "wait_for_human",
  "redact_then_admit",
  "propose_upstream",
  "local_only"
] as const;
export type AdmissionDecisionKind = (typeof admissionDecisionKinds)[number];

export const feedbackLayers = [
  "current_project",
  "target_agent_project",
  "upstream_feng_project",
  "external_runtime",
  "unknown"
] as const;
export type FeedbackLayer = (typeof feedbackLayers)[number];

export interface InboxItemRecord {
  readonly inboxItemId: InboxItemId;
  readonly inboxItemRef: InboxItemRef;
  readonly growUnitRef: GrowUnitRef;
  readonly sourceKind: InboxSourceKind;
  readonly source: SourceDescriptor;
  readonly receivedAt: string;
  readonly rawArtifactRef: ArtifactRef;
  readonly previewRef?: ArtifactRef;
  readonly normalizedSummary: string;
  readonly initialPrivacyClass: PrivacyLevel;
  readonly status: InboxItemStatus;
  readonly classification?: AdmissionClassification;
  readonly decision?: AdmissionDecisionRecord;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly policyDecisionId?: PolicyDecisionId;
  readonly audit: AuditDescriptor;
  readonly version: VersionDescriptor;
  readonly updatedAt: string;
  readonly recordVersion: number;
}

export interface AdmissionClassification {
  readonly inboxItemRef: InboxItemRef;
  readonly suggestedDecision: AdmissionDecisionKind;
  readonly reason: string;
  readonly evidenceRefs: readonly ArtifactRef[];
  readonly routerSkillRefs: readonly SkillRef[];
  readonly classifiedAt: string;
}

export interface AdmissionDecisionRecord {
  readonly decision: AdmissionDecisionKind;
  readonly reason: string;
  readonly evidenceRefs: readonly ArtifactRef[];
  readonly redactedArtifactRef?: ArtifactRef;
  readonly policyDecisionId?: PolicyDecisionId;
  readonly decidedAt: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface FeedbackUnitRecord {
  readonly feedbackUnitId: FeedbackUnitId;
  readonly feedbackUnitRef: FeedbackUnitRef;
  readonly growUnitRef: GrowUnitRef;
  readonly originLayer: FeedbackLayer;
  readonly targetLayer: FeedbackLayer;
  readonly status: FeedbackStatus;
  readonly summary: string;
  readonly detailRef?: ArtifactRef;
  readonly evidenceRefs: readonly ArtifactRef[];
  readonly runtimeTraceRefs: readonly ArtifactRef[];
  readonly attribution: string;
  readonly impact: string;
  readonly suggestedAction: string;
  readonly privacyClass: PrivacyLevel;
  readonly policyDecisionId?: PolicyDecisionId;
  readonly upstreamProposalRef?: UpstreamProposalRef;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly recordVersion: number;
}

export interface UpstreamProposalRecord {
  readonly proposalId: UpstreamProposalId;
  readonly proposalRef: UpstreamProposalRef;
  readonly fromGrowUnitRef: GrowUnitRef;
  readonly toGrowUnitRef: GrowUnitRef;
  readonly feedbackUnitRefs: readonly FeedbackUnitRef[];
  readonly summary: string;
  readonly redactedSummaryRef: ArtifactRef;
  readonly evidenceRefs: readonly ArtifactRef[];
  readonly policyDecisionId: PolicyDecisionId;
  readonly privacyBoundary: string;
  readonly attribution: string;
  readonly createdAt: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface ReceivePayloadInput {
  readonly content?: string | Uint8Array;
  readonly existingArtifactRef?: ArtifactRef;
  readonly mediaType?: string;
  readonly encoding?: "utf8" | "binary";
  readonly normalizedSummary?: string;
  readonly privacyClass: PrivacyLevel;
  readonly version: VersionDescriptor;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly correlationId?: string;
  readonly causationId?: string;
}

export interface ClassifyInboxContext {
  readonly growStateSummary?: string;
  readonly defaultFeedbackRouterSummary?: string;
}

export interface AdmissionDecisionInput {
  readonly decision: AdmissionDecisionKind;
  readonly reason: string;
  readonly evidenceRefs?: readonly ArtifactRef[];
  readonly redactedArtifactRef?: ArtifactRef;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly policyContext?: PolicyContext;
}

export interface AdmissionReceipt {
  readonly inboxItemRef: InboxItemRef;
  readonly from: InboxItemStatus;
  readonly to: InboxItemStatus;
  readonly decision: AdmissionDecisionKind;
  readonly eventReceipt?: EventAppendReceipt;
  readonly recordWriteReceipt?: WriteReceipt;
}

export interface InboxItemPage {
  readonly items: readonly InboxItemRecord[];
  readonly total: number;
  readonly nextCursor?: string;
  readonly truncated: boolean;
}

export interface InboxQuery {
  readonly status?: InboxItemStatus;
  readonly includeArchived?: boolean;
  readonly text?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface CreateFeedbackInput {
  readonly growUnitRef: GrowUnitRef;
  readonly originLayer: FeedbackLayer;
  readonly targetLayer: FeedbackLayer;
  readonly summary: string;
  readonly detail?: ReceivePayloadInput;
  readonly detailRef?: ArtifactRef;
  readonly evidenceRefs?: readonly ArtifactRef[];
  readonly runtimeTraceRefs?: readonly ArtifactRef[];
  readonly attribution: string;
  readonly impact: string;
  readonly suggestedAction: string;
  readonly privacyClass: PrivacyLevel;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface FeedbackTransitionInput {
  readonly to: FeedbackStatus;
  readonly reason: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly policyDecisionId?: PolicyDecisionId;
  readonly upstreamProposalRef?: UpstreamProposalRef;
}

export interface FeedbackTransitionReceipt {
  readonly feedbackUnitRef: FeedbackUnitRef;
  readonly from: FeedbackStatus;
  readonly to: FeedbackStatus;
  readonly eventReceipt?: EventAppendReceipt;
  readonly recordWriteReceipt?: WriteReceipt;
}

export interface FeedbackUnitPage {
  readonly records: readonly FeedbackUnitRecord[];
  readonly total: number;
  readonly nextCursor?: string;
  readonly truncated: boolean;
}

export interface FeedbackQuery {
  readonly status?: FeedbackStatus;
  readonly targetLayer?: FeedbackLayer;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface CreateUpstreamProposalInput {
  readonly feedbackUnitRefs: readonly FeedbackUnitRef[];
  readonly targetGrowUnitRef: GrowUnitRef;
  readonly summary: string;
  readonly redactedSummaryRef: ArtifactRef;
  readonly evidenceRefs?: readonly ArtifactRef[];
  readonly attribution: string;
  readonly privacyBoundary: string;
  readonly reason: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly policyContext?: PolicyContext;
}

export interface UpstreamResultInput {
  readonly result: "accepted_upstream" | "rejected" | "waiting_evidence" | "waiting_human";
  readonly reason: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface AdmissionSummary {
  readonly growUnitRef: GrowUnitRef;
  readonly pendingInboxCount: number;
  readonly admittedInboxCount: number;
  readonly quarantinedInboxCount: number;
  readonly feedbackCandidateCount: number;
  readonly proposedUpstreamCount: number;
  readonly waitingEvidenceCount: number;
  readonly latestInboxRefs: readonly InboxItemRef[];
  readonly latestFeedbackRefs: readonly FeedbackUnitRef[];
  readonly builtAt: string;
}

export interface AdmissionExplanation {
  readonly ref: InboxItemRef | FeedbackUnitRef | UpstreamProposalRef;
  readonly summary: string;
  readonly facts: readonly string[];
}

export interface AdmissionFeedbackInboxOptions {
  readonly workspace: WorkspaceHandle;
  readonly ledger: EventLedger;
  readonly artifactRegistry: ArtifactRegistry;
  readonly policyBoundary: PolicyBoundary;
  readonly skillRegistry: SkillRegistry;
  readonly growUnitManager: GrowUnitManager;
  readonly producer: string;
}

export interface AdmissionFeedbackInbox {
  readonly receiveUserInput: (growUnitRef: GrowUnitRef, input: ReceivePayloadInput) => Promise<Result<InboxItemRef>>;
  readonly receiveMaterial: (growUnitRef: GrowUnitRef, input: ReceivePayloadInput) => Promise<Result<InboxItemRef>>;
  readonly receiveRuntimeReport: (growUnitRef: GrowUnitRef, input: ReceivePayloadInput) => Promise<Result<InboxItemRef>>;
  readonly receiveExternalEvent: (growUnitRef: GrowUnitRef, input: ReceivePayloadInput) => Promise<Result<InboxItemRef>>;
  readonly normalizeInboxItem: (inboxItemRef: InboxItemRef) => Promise<Result<InboxItemRecord>>;
  readonly classifyInboxItem: (
    inboxItemRef: InboxItemRef,
    context?: ClassifyInboxContext
  ) => Promise<Result<AdmissionClassification>>;
  readonly decideAdmission: (inboxItemRef: InboxItemRef, input: AdmissionDecisionInput) => Promise<Result<AdmissionReceipt>>;
  readonly listPendingInbox: (growUnitRef: GrowUnitRef, query?: InboxQuery) => Promise<Result<InboxItemPage>>;
  readonly createFeedbackUnit: (input: CreateFeedbackInput) => Promise<Result<FeedbackUnitRef>>;
  readonly transitionFeedback: (
    feedbackUnitRef: FeedbackUnitRef,
    input: FeedbackTransitionInput
  ) => Promise<Result<FeedbackTransitionReceipt>>;
  readonly linkFeedbackEvidence: (
    feedbackUnitRef: FeedbackUnitRef,
    evidenceRefs: readonly ArtifactRef[],
    reason: string
  ) => Promise<Result<FeedbackTransitionReceipt>>;
  readonly redactFeedback: (
    feedbackUnitRef: FeedbackUnitRef,
    policyDecisionId: PolicyDecisionId
  ) => Promise<Result<FeedbackTransitionReceipt>>;
  readonly listFeedback: (growUnitRef: GrowUnitRef, query?: FeedbackQuery) => Promise<Result<FeedbackUnitPage>>;
  readonly createUpstreamProposal: (input: CreateUpstreamProposalInput) => Promise<Result<UpstreamProposalRef>>;
  readonly recordUpstreamResult: (
    proposalRef: UpstreamProposalRef,
    input: UpstreamResultInput
  ) => Promise<Result<readonly FeedbackTransitionReceipt[]>>;
  readonly buildAdmissionSummary: (growUnitRef: GrowUnitRef) => Promise<Result<AdmissionSummary>>;
  readonly explainAdmissionDecision: (
    ref: InboxItemRef | FeedbackUnitRef | UpstreamProposalRef
  ) => Promise<Result<AdmissionExplanation>>;
}

export interface InboxIndex {
  readonly inboxItemRefs: readonly InboxItemRef[];
}
export interface FeedbackIndex {
  readonly feedbackUnitRefs: readonly FeedbackUnitRef[];
}
export interface ProposalIndex {
  readonly proposalRefs: readonly UpstreamProposalRef[];
}

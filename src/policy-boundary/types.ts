import type {
  AuditDescriptor,
  PrivacyLevel,
  SourceDescriptor
} from "../domain/descriptors.js";
import type {
  AttemptId,
  GrowUnitId,
  PolicyDecisionId,
  SkillId,
  TargetWorldId,
  WorkspaceId
} from "../domain/ids.js";
import type { PolicyVerdict, RuntimeContractSummary, TargetWorldContractSummary } from "../domain/contracts.js";
import type { ArtifactRef } from "../domain/refs.js";
import type { Result } from "../domain/result.js";
import type { ArtifactRecord, ArtifactRegistry, RetentionClass } from "../artifact-registry/index.js";
import type { EventAppendReceipt, EventLedger } from "../event-ledger/index.js";
import type { BrandedString } from "../domain/brand.js";

export type PolicyRequestId = BrandedString<"PolicyRequestId">;
export type CapabilityGrantId = BrandedString<"CapabilityGrantId">;
export type ApprovalId = BrandedString<"ApprovalId">;

export const capabilityKinds = [
  "file.read",
  "file.write",
  "file.delete",
  "command.run",
  "network.request",
  "external_service.call",
  "artifact.read",
  "artifact.export",
  "feedback.upstream",
  "hatch.publish",
  "runtime.target_action",
  "skill.activate",
  "secret.read",
  "debug_trace.upload"
] as const;

export type CapabilityKind = (typeof capabilityKinds)[number];

export const boundaryLevels = [
  "structural_guard",
  "policy_decision",
  "human_approval",
  "host_sandbox_required",
  "external_enforcement",
  "advisory_only",
  "unsupported"
] as const;

export type BoundaryLevel = (typeof boundaryLevels)[number];

export interface EnvironmentCapabilitySummary {
  readonly hostSandboxAvailable: boolean;
  readonly networkAvailable: boolean;
  readonly externalEnforcementAvailable: boolean;
  readonly secretStoreAvailable: boolean;
}

export interface BoundaryDeclaration {
  readonly capability: CapabilityKind | string;
  readonly level: BoundaryLevel;
  readonly enforcedBy: string;
  readonly limitations: readonly string[];
}

export interface ActionRequest {
  readonly requestId: PolicyRequestId;
  readonly capability: CapabilityKind | string;
  readonly requestedByModule: string;
  readonly workspace?: WorkspaceId;
  readonly growUnit?: GrowUnitId;
  readonly attempt?: AttemptId;
  readonly runtime?: string;
  readonly targetWorld?: TargetWorldId;
  readonly artifactRefs?: readonly ArtifactRef[];
  readonly skillRefs?: readonly SkillId[];
  readonly resourceSummary: string;
  readonly operation: string;
  readonly reason: string;
  readonly source: SourceDescriptor;
  readonly correlationId?: string;
}

export interface PolicyRule {
  readonly capability: CapabilityKind | string;
  readonly resource: string;
  readonly verdict: PolicyVerdict;
  readonly explanation?: string;
  readonly constraints?: readonly string[];
}

export interface ArtifactPolicySummary {
  readonly artifactRef: ArtifactRef;
  readonly privacyClass: PrivacyLevel;
  readonly retentionClass: RetentionClass;
  readonly lifecycle: ArtifactRecord["lifecycle"];
  readonly sourceKind: SourceDescriptor["kind"];
}

export interface CapabilityGrantScope {
  readonly workspace?: WorkspaceId;
  readonly growUnit?: GrowUnitId;
  readonly runtime?: string;
  readonly targetWorld?: TargetWorldId;
  readonly capability?: CapabilityKind | string;
  readonly resourcePattern?: string;
}

export interface CapabilityGrant {
  readonly grantId: CapabilityGrantId;
  readonly capability: CapabilityKind | string;
  readonly scope: CapabilityGrantScope;
  readonly subject: string;
  readonly approvedBy: string;
  readonly reason: string;
  readonly constraints: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface ApprovalReceipt {
  readonly approvalId: ApprovalId;
  readonly request: ActionRequest;
  readonly approvedBy: string;
  readonly reason: string;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly constraints: readonly string[];
  readonly eventReceipt?: EventAppendReceipt;
}

export interface ApprovalInput {
  readonly approvedBy: string;
  readonly reason: string;
  readonly expiresAt?: string;
  readonly constraints?: readonly string[];
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface GrantInput {
  readonly approval: ApprovalReceipt;
  readonly scope: CapabilityGrantScope;
  readonly expiresAt: string;
  readonly subject?: string;
}

export interface RevocationReceipt {
  readonly grantId: CapabilityGrantId;
  readonly reason: string;
  readonly revokedAt: string;
  readonly eventReceipt?: EventAppendReceipt;
}

export interface CapabilityGrantList {
  readonly grants: readonly CapabilityGrant[];
}

export interface PolicyContext {
  readonly growLifecycle?: string;
  readonly attemptSummary?: string;
  readonly runtimeContract?: RuntimeContractSummary;
  readonly targetWorldContract?: TargetWorldContractSummary;
  readonly artifactSummaries?: readonly ArtifactPolicySummary[];
  readonly activeGrants?: readonly CapabilityGrant[];
  readonly caller: string;
  readonly environment: EnvironmentCapabilitySummary;
  readonly rules?: readonly PolicyRule[];
}

export interface PolicyDecision {
  readonly policyDecisionId: PolicyDecisionId;
  readonly requestId: PolicyRequestId;
  readonly capability: CapabilityKind | string;
  readonly verdict: PolicyVerdict;
  readonly constraints: readonly string[];
  readonly requiredApproval?: string;
  readonly requiredRedaction?: string;
  readonly requiredEvidence?: readonly string[];
  readonly boundaryDeclaration: BoundaryDeclaration;
  readonly expiresAt?: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly explanation: string;
  readonly eventReceipt?: EventAppendReceipt;
}

export interface PolicyDecisionExplanation {
  readonly decision: PolicyDecision;
  readonly summary: string;
}

export interface BoundaryCheck {
  readonly capability: CapabilityKind | string;
  readonly requiredLevel: BoundaryLevel;
  readonly actual: BoundaryDeclaration;
  readonly satisfied: boolean;
}

export interface PolicyBoundaryOptions {
  readonly ledger: EventLedger;
  readonly artifactRegistry: ArtifactRegistry;
  readonly producer: string;
  readonly decisionTtlMs?: number;
}

export interface PolicyBoundary {
  readonly evaluateAction: (request: ActionRequest, context: PolicyContext) => Promise<Result<PolicyDecision>>;
  readonly explainDecision: (policyDecisionId: PolicyDecisionId) => Promise<Result<PolicyDecisionExplanation>>;
  readonly recordApproval: (request: ActionRequest, input: ApprovalInput) => Promise<Result<ApprovalReceipt>>;
  readonly createGrant: (input: GrantInput) => Promise<Result<CapabilityGrant>>;
  readonly revokeGrant: (grantId: CapabilityGrantId, reason: string) => Promise<Result<RevocationReceipt>>;
  readonly listActiveGrants: (scope: CapabilityGrantScope) => Promise<Result<CapabilityGrantList>>;
  readonly describeBoundary: (
    capability: CapabilityKind | string,
    environment: EnvironmentCapabilitySummary
  ) => Result<BoundaryDeclaration>;
  readonly requireBoundary: (
    capability: CapabilityKind | string,
    requiredLevel: BoundaryLevel,
    environment: EnvironmentCapabilitySummary
  ) => Result<BoundaryCheck>;
  readonly evaluateArtifactAccess: (
    request: ActionRequest,
    artifactSummary: ArtifactPolicySummary
  ) => Promise<Result<PolicyDecision>>;
  readonly evaluateFeedbackUpstream: (
    request: ActionRequest,
    feedbackSummary: ArtifactPolicySummary
  ) => Promise<Result<PolicyDecision>>;
  readonly evaluateHatchPublish: (
    request: ActionRequest,
    hatchSummary: ArtifactPolicySummary
  ) => Promise<Result<PolicyDecision>>;
}

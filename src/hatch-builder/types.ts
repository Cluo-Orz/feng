import type { BrandedString } from "../domain/brand.js";
import type {
  ArtifactRef,
  AuditDescriptor,
  GrowUnitRef,
  HatchLifecycle,
  HatchPackageRef,
  PolicyDecisionId,
  PrivacyLevel,
  RuntimeContractRef,
  RuntimeKernelType,
  SkillRef,
  SourceDescriptor,
  VersionDescriptor
} from "../domain/index.js";
import type { HatchPackageSummary } from "../domain/contracts.js";
import type { Result } from "../domain/result.js";
import type { ContentHash, FileNativeStore, WorkspaceHandle, WriteReceipt } from "../file-store/index.js";
import type { ArtifactRegistry, RetentionClass } from "../artifact-registry/index.js";
import type { EventAppendReceipt, EventLedger } from "../event-ledger/index.js";
import type { GrowUnitManager } from "../grow-unit-manager/index.js";
import type { EvidenceReadiness, ReadinessVerdictRef } from "../evidence-readiness/index.js";
import type { PolicyBoundary, PolicyContext, PolicyDecision } from "../policy-boundary/index.js";
import type { SkillRegistry } from "../skill-registry/index.js";
import type { RuntimeContractRegistry } from "../runtime-contract-registry/index.js";

export type HatchRequestId = BrandedString<"HatchRequestId">;
export type HatchBuildPlanId = BrandedString<"HatchBuildPlanId">;
export type HatchResourceId = BrandedString<"HatchResourceId">;
export type HatchExclusionId = BrandedString<"HatchExclusionId">;
export type HatchBuildReceiptId = BrandedString<"HatchBuildReceiptId">;
export type HatchVerificationId = BrandedString<"HatchVerificationId">;

export interface ComponentRef<Kind extends string, Id extends string> {
  readonly kind: Kind;
  readonly id: Id;
  readonly uri?: string;
}
export type HatchRequestRef = ComponentRef<"hatch_request", HatchRequestId>;
export type HatchBuildPlanRef = ComponentRef<"hatch_build_plan", HatchBuildPlanId>;
export type HatchResourceRef = ComponentRef<"hatch_resource", HatchResourceId>;
export type HatchExclusionRef = ComponentRef<"hatch_exclusion", HatchExclusionId>;
export type HatchBuildReceiptRef = ComponentRef<"hatch_build_receipt", HatchBuildReceiptId>;
export type HatchVerificationRef = ComponentRef<"hatch_verification", HatchVerificationId>;

export type HatchPublishMode = "local_draft" | "local_release" | "workspace_import" | "external_export";
export type TargetPackageKind = "agent_runtime" | "non_llm_runtime" | "hybrid_runtime" | "asset_bundle";
export type HatchResourceRole =
  | "runtime_contract" | "runtime_entry" | "runtime_kernel_asset" | "skill_body" | "skill_asset"
  | "target_world_asset" | "source_material_snapshot" | "configuration_template" | "validation_summary"
  | "feedback_router_protocol" | "debug_support" | "license_or_notice";
export type HatchExclusionReason =
  | "growth_noise" | "unaccepted_candidate" | "failed_attempt" | "raw_message_list" | "raw_attempt_trace"
  | "contains_secret" | "project_private" | "contains_user_content" | "policy_blocked"
  | "privacy_unknown" | "retracted_artifact" | "unavailable_artifact" | "archived_artifact"
  | "out_of_scope" | "runtime_incompatible" | "debug_only" | "temporary_context" | "local_only"
  | "duplicate_or_derived";

export interface HatchResourceCandidate {
  readonly artifactRef: ArtifactRef;
  readonly role?: HatchResourceRole;
  readonly sourceModule?: string;
  readonly required?: boolean;
  readonly targetPathHint?: string;
  readonly inclusionReason?: string;
}

export interface HatchRequestInput {
  readonly growUnitRef: GrowUnitRef;
  readonly readinessVerdictRef: ReadinessVerdictRef;
  readonly runtimeContractRef: RuntimeContractRef;
  readonly requestedVersion: VersionDescriptor;
  readonly packageName?: string;
  readonly targetPackageKind: TargetPackageKind;
  readonly publishMode: HatchPublishMode;
  readonly reason: string;
  readonly requestedBy: string;
  readonly resourceCandidates?: readonly HatchResourceCandidate[];
  readonly skillRefs?: readonly SkillRef[];
  readonly rollbackTarget?: HatchPackageRef;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly policyContext?: PolicyContext;
}

export interface HatchRequestRecord extends Omit<HatchRequestInput, "policyContext"> {
  readonly hatchRequestId: HatchRequestId;
  readonly hatchRequestRef: HatchRequestRef;
  readonly packageName: string;
  readonly candidateResourceRefs: readonly ArtifactRef[];
  readonly explicitSkillRefs: readonly SkillRef[];
  readonly policyDecisionRefs: readonly PolicyDecisionId[];
  readonly createdAt: string;
  readonly recordVersion: number;
}

export interface HatchResource {
  readonly resourceRef: HatchResourceRef;
  readonly artifactRef: ArtifactRef;
  readonly role: HatchResourceRole;
  readonly sourceModule: string;
  readonly inclusionReason: string;
  readonly contentHash: ContentHash;
  readonly privacyClass: PrivacyLevel;
  readonly retentionClass: RetentionClass;
  readonly targetPathHint: string;
  readonly required: boolean;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface HatchExclusionRecord {
  readonly exclusionRef: HatchExclusionRef;
  readonly artifactRef?: ArtifactRef;
  readonly role?: HatchResourceRole;
  readonly sourceModule?: string;
  readonly required: boolean;
  readonly reason: HatchExclusionReason;
  readonly detail: string;
  readonly policyDecisionRefs: readonly PolicyDecisionId[];
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface PackagedSkillVersion {
  readonly skillRef: SkillRef;
  readonly name: string;
  readonly family: string;
  readonly version: VersionDescriptor;
  readonly bodyRef: ArtifactRef;
  readonly assetRefs: readonly ArtifactRef[];
  readonly declaredCapabilities: readonly string[];
  readonly inclusionReason: string;
  readonly rollbackTarget?: SkillRef;
}

export interface HatchBuildPlan {
  readonly hatchBuildPlanId: HatchBuildPlanId;
  readonly hatchBuildPlanRef: HatchBuildPlanRef;
  readonly hatchRequestRef: HatchRequestRef;
  readonly growUnitRef: GrowUnitRef;
  readonly readinessVerdictRef: ReadinessVerdictRef;
  readonly runtimeContractRef: RuntimeContractRef;
  readonly runtimeKernelType: RuntimeKernelType;
  readonly candidateResourceRefs: readonly ArtifactRef[];
  readonly includedResources: readonly HatchResource[];
  readonly excludedResources: readonly HatchExclusionRecord[];
  readonly skillVersions: readonly PackagedSkillVersion[];
  readonly dependencySummary: string;
  readonly debugFeedbackSummary: string;
  readonly policyBoundarySummary: string;
  readonly versionPlan: VersionDescriptor;
  readonly rollbackTarget?: HatchPackageRef;
  readonly rollbackReason: string;
  readonly policyDecisionRefs: readonly PolicyDecisionId[];
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly createdAt: string;
  readonly recordVersion: number;
}

export interface HatchPackageManifest {
  readonly packageName: string;
  readonly packageVersion: VersionDescriptor;
  readonly hatchPackageRef: HatchPackageRef;
  readonly growUnitRef: GrowUnitRef;
  readonly runtimeContractRef: RuntimeContractRef;
  readonly runtimeKernelType: RuntimeKernelType;
  readonly readinessVerdictRef: ReadinessVerdictRef;
  readonly evidenceSummary: string;
  readonly includedResources: readonly HatchResource[];
  readonly excludedResources: readonly HatchExclusionRecord[];
  readonly skillVersions: readonly PackagedSkillVersion[];
  readonly dependencySummary: string;
  readonly capabilitySummary: string;
  readonly debugContractSummary: string;
  readonly feedbackContractSummary: string;
  readonly failureContractSummary: string;
  readonly buildReceipts: readonly HatchBuildReceiptRef[];
  readonly policyDecisionRefs: readonly PolicyDecisionId[];
  readonly rollbackTarget?: HatchPackageRef;
  readonly rollbackReason: string;
  readonly createdAt: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface PackagedResourceContent {
  readonly resourceRef: HatchResourceRef;
  readonly artifactRef: ArtifactRef;
  readonly role: HatchResourceRole;
  readonly targetPathHint: string;
  readonly mediaType: string;
  readonly encoding: "utf8" | "base64" | "external";
  readonly content?: string;
  readonly contentHandle?: string;
  readonly contentHash: ContentHash;
}

export interface HatchPackageDocument {
  readonly manifest: HatchPackageManifest;
  readonly resources: readonly PackagedResourceContent[];
}

export interface HatchBuildReceipt {
  readonly buildReceiptRef: HatchBuildReceiptRef;
  readonly hatchBuildPlanRef: HatchBuildPlanRef;
  readonly hatchPackageRef: HatchPackageRef;
  readonly artifactRef: ArtifactRef;
  readonly includedCount: number;
  readonly excludedCount: number;
  readonly builtAt: string;
}

export interface HatchPackageRecord {
  readonly hatchPackageId: HatchPackageRef["id"];
  readonly hatchPackageRef: HatchPackageRef;
  readonly packageName: string;
  readonly hatchRequestRef: HatchRequestRef;
  readonly hatchBuildPlanRef: HatchBuildPlanRef;
  readonly growUnitRef: GrowUnitRef;
  readonly runtimeContractRef: RuntimeContractRef;
  readonly readinessVerdictRef: ReadinessVerdictRef;
  readonly version: VersionDescriptor;
  readonly lifecycle: HatchLifecycle;
  readonly artifactRef: ArtifactRef;
  readonly manifestRef: ArtifactRef;
  readonly includedResourceRefs: readonly ArtifactRef[];
  readonly excludedResourceRefs: readonly HatchExclusionRef[];
  readonly policyDecisionRefs: readonly PolicyDecisionId[];
  readonly validationSummaryRefs: readonly ArtifactRef[];
  readonly buildReceiptRef: HatchBuildReceiptRef;
  readonly publishedAt?: string;
  readonly rollbackTarget?: HatchPackageRef;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly recordVersion: number;
}

export interface HatchPackageCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface HatchPackageVerification {
  readonly hatchVerificationRef: HatchVerificationRef;
  readonly hatchPackageRef: HatchPackageRef;
  readonly passed: boolean;
  readonly checks: readonly HatchPackageCheck[];
  readonly blockers: readonly string[];
  readonly createdAt: string;
}

export interface HatchPublishReceipt {
  readonly hatchPackageRef: HatchPackageRef;
  readonly from: HatchLifecycle;
  readonly to: HatchLifecycle;
  readonly reason: string;
  readonly policyDecision?: PolicyDecision;
  readonly recordWriteReceipt?: WriteReceipt;
  readonly eventReceipt?: EventAppendReceipt;
}

export interface HatchLifecycleReceipt {
  readonly hatchPackageRef: HatchPackageRef;
  readonly from: HatchLifecycle;
  readonly to: HatchLifecycle;
  readonly reason: string;
  readonly recordWriteReceipt?: WriteReceipt;
  readonly eventReceipt?: EventAppendReceipt;
}

export interface HatchPackagePage {
  readonly records: readonly HatchPackageRecord[];
  readonly total: number;
  readonly nextCursor?: string;
  readonly truncated: boolean;
}

export interface HatchPackageQuery {
  readonly lifecycle?: HatchLifecycle;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface HatchPackageExplanation {
  readonly hatchPackageRef: HatchPackageRef;
  readonly summary: string;
  readonly facts: readonly string[];
}

export interface ResourceInclusionExplanation {
  readonly resourceRef: HatchResourceRef;
  readonly summary: string;
  readonly facts: readonly string[];
}

export interface ResourceExclusionExplanation {
  readonly exclusionRef: HatchExclusionRef;
  readonly summary: string;
  readonly facts: readonly string[];
}

export interface HatchResourceSelection {
  readonly includedResources: readonly HatchResource[];
  readonly excludedResources: readonly HatchExclusionRecord[];
  readonly skillVersions: readonly PackagedSkillVersion[];
  readonly policyDecisionRefs: readonly PolicyDecisionId[];
}

export interface HatchBuilderOptions {
  readonly workspace: WorkspaceHandle;
  readonly store: FileNativeStore;
  readonly ledger: EventLedger;
  readonly artifactRegistry: ArtifactRegistry;
  readonly policyBoundary: PolicyBoundary;
  readonly growUnitManager: GrowUnitManager;
  readonly evidenceReadiness: EvidenceReadiness;
  readonly runtimeContractRegistry: RuntimeContractRegistry;
  readonly skillRegistry: SkillRegistry;
  readonly producer: string;
}

export interface HatchBuilder {
  readonly requestHatch: (input: HatchRequestInput) => Promise<Result<HatchRequestRef>>;
  readonly buildHatchPlan: (ref: HatchRequestRef, policyContext?: PolicyContext) => Promise<Result<HatchBuildPlan>>;
  readonly buildHatchPackage: (ref: HatchBuildPlanRef) => Promise<Result<HatchPackageRef>>;
  readonly verifyHatchPackage: (ref: HatchPackageRef) => Promise<Result<HatchPackageVerification>>;
  readonly publishLocalHatchPackage: (
    ref: HatchPackageRef,
    input: { readonly reason: string; readonly policyContext?: PolicyContext }
  ) => Promise<Result<HatchPublishReceipt>>;
  readonly getHatchPackage: (ref: HatchPackageRef) => Promise<Result<HatchPackageRecord>>;
  readonly listHatchPackages: (growUnitRef: GrowUnitRef, query?: HatchPackageQuery) => Promise<Result<HatchPackagePage>>;
  readonly retractHatchPackage: (ref: HatchPackageRef, reason: string) => Promise<Result<HatchLifecycleReceipt>>;
  readonly supersedeHatchPackage: (
    oldRef: HatchPackageRef,
    newRef: HatchPackageRef,
    reason: string
  ) => Promise<Result<HatchLifecycleReceipt>>;
  readonly explainHatchPackage: (ref: HatchPackageRef) => Promise<Result<HatchPackageExplanation>>;
  readonly selectHatchResources: (
    input: HatchRequestInput,
    policyContext?: PolicyContext
  ) => Promise<Result<HatchResourceSelection>>;
  readonly explainResourceInclusion: (ref: HatchResourceRef) => Promise<Result<ResourceInclusionExplanation>>;
  readonly explainResourceExclusion: (ref: HatchExclusionRef) => Promise<Result<ResourceExclusionExplanation>>;
}

export interface HatchRequestIndex { readonly refs: readonly HatchRequestRef[]; }
export interface HatchBuildPlanIndex { readonly refs: readonly HatchBuildPlanRef[]; }
export interface HatchPackageIndex { readonly refs: readonly HatchPackageRef[]; }

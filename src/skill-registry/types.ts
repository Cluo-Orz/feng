import type { BrandedString } from "../domain/brand.js";
import type {
  ArtifactRef,
  AttemptId,
  AuditDescriptor,
  GrowUnitId,
  HatchPackageId,
  PrivacyLevel,
  RuntimeContractId,
  SkillId,
  SkillRef,
  SourceDescriptor,
  TargetWorldId,
  ToolId,
  VersionDescriptor,
  WorkspaceId
} from "../domain/index.js";
import type { Result } from "../domain/result.js";
import type { ArtifactMaterialization, ArtifactProducerModule, ArtifactRegistry } from "../artifact-registry/index.js";
import type { EventAppendReceipt, EventLedger } from "../event-ledger/index.js";
import type { FileNativeStore, ReadReceipt, WorkspaceHandle } from "../file-store/index.js";
import type { PolicyBoundary, PolicyContext, PolicyDecision } from "../policy-boundary/index.js";

export type SkillActivationId = BrandedString<"SkillActivationId">;

export const skillSourceKinds = [
  "system_default",
  "workspace_local",
  "grow_generated",
  "hatch_imported",
  "user_imported",
  "upstream_proposed",
  "external_package"
] as const;
export type SkillSourceKind = (typeof skillSourceKinds)[number];

export const skillLifecycles = [
  "discovered",
  "candidate",
  "registered",
  "active",
  "disabled",
  "pinned",
  "archived",
  "retracted",
  "superseded",
  "incompatible"
] as const;
export type SkillLifecycle = (typeof skillLifecycles)[number];

export const skillActivationStatuses = [
  "enabled",
  "disabled",
  "pinned",
  "rolled_back",
  "expired",
  "blocked"
] as const;
export type SkillActivationStatus = (typeof skillActivationStatuses)[number];

export interface SkillScope {
  readonly workspace?: WorkspaceId;
  readonly growUnit?: GrowUnitId;
  readonly attempt?: AttemptId;
  readonly runtimeContract?: RuntimeContractId;
  readonly hatchPackage?: HatchPackageId;
  readonly targetWorld?: TargetWorldId;
  readonly systemDefault?: boolean;
}

export interface SkillCompatibility {
  readonly fengVersionRange?: string;
  readonly runtimeKernelTypes?: readonly string[];
  readonly requiredCapabilities?: readonly string[];
  readonly notes?: string;
}

export interface SkillRecord {
  readonly skillId: SkillId;
  readonly skillRef: SkillRef;
  readonly name: string;
  readonly family: string;
  readonly version: VersionDescriptor;
  readonly lifecycle: SkillLifecycle;
  readonly sourceKind: SkillSourceKind;
  readonly source: SourceDescriptor;
  readonly scope: SkillScope;
  readonly description: string;
  readonly triggerSummary: string;
  readonly bodyRef: ArtifactRef;
  readonly assetRefs: readonly ArtifactRef[];
  readonly referenceRefs: readonly ArtifactRef[];
  readonly declaredCapabilities: readonly string[];
  readonly declaredToolRefs: readonly ToolId[];
  readonly compatibility: SkillCompatibility;
  readonly privacyClass: PrivacyLevel;
  readonly evidenceRefs: readonly ArtifactRef[];
  readonly rollbackTarget?: SkillRef;
  readonly supersedesRef?: SkillRef;
  readonly audit: AuditDescriptor;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RegisterSkillInput {
  readonly name: string;
  readonly family?: string;
  readonly version: VersionDescriptor;
  readonly sourceKind: SkillSourceKind;
  readonly source: SourceDescriptor;
  readonly scope: SkillScope;
  readonly description: string;
  readonly triggerSummary: string;
  readonly body: string | Uint8Array;
  readonly mediaType?: string;
  readonly encoding?: "utf8" | "binary";
  readonly producerModule?: ArtifactProducerModule;
  readonly assetRefs?: readonly ArtifactRef[];
  readonly referenceRefs?: readonly ArtifactRef[];
  readonly declaredCapabilities?: readonly string[];
  readonly declaredToolRefs?: readonly ToolId[];
  readonly compatibility?: SkillCompatibility;
  readonly privacyClass: PrivacyLevel;
  readonly evidenceRefs?: readonly ArtifactRef[];
  readonly audit: AuditDescriptor;
}

export type AddSkillVersionInput = Omit<RegisterSkillInput, "name" | "family" | "scope">;

export interface SkillLifecycleReceipt {
  readonly skillRef: SkillRef;
  readonly from: SkillLifecycle;
  readonly to: SkillLifecycle;
  readonly reason: string;
  readonly eventReceipt?: EventAppendReceipt;
}

export interface SkillCatalogQuery {
  readonly text?: string;
  readonly family?: string;
  readonly lifecycle?: SkillLifecycle;
  readonly sourceKind?: SkillSourceKind;
  readonly scope?: SkillScope;
  readonly includeRetracted?: boolean;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface SkillCatalogPage {
  readonly records: readonly SkillRecord[];
  readonly total: number;
  readonly nextCursor?: string;
  readonly truncated: boolean;
}

export interface SkillDiscoveryScope extends SkillScope {
  readonly searchPaths: readonly string[];
  readonly sourceKind?: SkillSourceKind;
  readonly maxDepth?: number;
}

export interface DiscoveredSkillSummary {
  readonly logicalPath: string;
  readonly name: string;
  readonly description: string;
  readonly version: VersionDescriptor;
  readonly sourceKind: SkillSourceKind;
}

export interface SkillDiscoveryReport {
  readonly discovered: readonly DiscoveredSkillSummary[];
  readonly ignored: readonly string[];
}

export interface SkillActivationInput {
  readonly scope: SkillScope;
  readonly reason: string;
  readonly activatedBy: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly expiresAt?: string;
  readonly policyContext?: PolicyContext;
}

export interface SkillActivation {
  readonly activationId: SkillActivationId;
  readonly skillRef: SkillRef;
  readonly version: VersionDescriptor;
  readonly scope: SkillScope;
  readonly status: SkillActivationStatus;
  readonly policyDecisionId?: PolicyDecision["policyDecisionId"];
  readonly reason: string;
  readonly activatedBy: string;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly evidenceRefs: readonly ArtifactRef[];
  readonly rollbackTarget?: SkillRef;
  readonly audit: AuditDescriptor;
  readonly eventReceipt?: EventAppendReceipt;
}

export interface ActiveSkillList {
  readonly skills: readonly SkillCandidateSummary[];
}

export interface SkillCandidateSummary {
  readonly record: SkillRecord;
  readonly activation: SkillActivation;
}

export interface LoadSkillOptions {
  readonly reason: string;
  readonly maxBytes?: number;
}

export interface SkillBodyMaterialization {
  readonly skillRef: SkillRef;
  readonly bodyRef: ArtifactRef;
  readonly content: string | Uint8Array;
  readonly version: VersionDescriptor;
  readonly privacyClass: PrivacyLevel;
  readonly readReceipt?: ReadReceipt;
  readonly artifactMaterialization: ArtifactMaterialization;
}

export interface SkillSummaryMaterialization {
  readonly skillRef: SkillRef;
  readonly name: string;
  readonly family: string;
  readonly version: VersionDescriptor;
  readonly description: string;
  readonly triggerSummary: string;
  readonly declaredCapabilities: readonly string[];
  readonly declaredToolRefs: readonly ToolId[];
  readonly sourceKind: SkillSourceKind;
  readonly lifecycle: SkillLifecycle;
}

export interface SkillCandidateContext {
  readonly text: string;
  readonly scope: SkillScope;
  readonly requiredCapabilities?: readonly string[];
}

export interface SkillCandidate {
  readonly record: SkillRecord;
  readonly activation: SkillActivation;
  readonly reason: string;
  readonly score: number;
  readonly limitations: readonly string[];
}

export interface SkillCandidateList {
  readonly candidates: readonly SkillCandidate[];
}

export interface SkillCandidateExplanation {
  readonly skillRef: SkillRef;
  readonly contextSummary: string;
  readonly matched: boolean;
  readonly reasons: readonly string[];
  readonly limitations: readonly string[];
}

export interface SkillVersionDiffSummary {
  readonly family: string;
  readonly from: SkillRecord;
  readonly to: SkillRecord;
  readonly changedFields: readonly string[];
}

export interface DefaultFeedbackRouterInput extends Omit<RegisterSkillInput, "name" | "family" | "sourceKind"> {
  readonly activate?: SkillActivationInput;
}

export interface SkillRegistryOptions {
  readonly workspace: WorkspaceHandle;
  readonly ledger: EventLedger;
  readonly artifactRegistry: ArtifactRegistry;
  readonly policyBoundary: PolicyBoundary;
  readonly producer: string;
}

export interface SkillRegistry {
  readonly discoverSkills: (scope: SkillDiscoveryScope) => Promise<Result<SkillDiscoveryReport>>;
  readonly registerSkill: (input: RegisterSkillInput) => Promise<Result<SkillRef>>;
  readonly getSkill: (skillRef: SkillRef) => Promise<Result<SkillRecord>>;
  readonly listSkills: (query?: SkillCatalogQuery) => Promise<Result<SkillCatalogPage>>;
  readonly addSkillVersion: (skillRef: SkillRef, input: AddSkillVersionInput) => Promise<Result<SkillRef>>;
  readonly compareSkillVersions: (
    skillRef: SkillRef,
    versionA: string,
    versionB: string
  ) => Promise<Result<SkillVersionDiffSummary>>;
  readonly retractSkillVersion: (
    skillRef: SkillRef,
    version: string,
    reason: string
  ) => Promise<Result<SkillLifecycleReceipt>>;
  readonly activateSkill: (skillRef: SkillRef, input: SkillActivationInput) => Promise<Result<SkillActivation>>;
  readonly disableSkill: (skillRef: SkillRef, input: SkillActivationInput) => Promise<Result<SkillActivation>>;
  readonly pinSkillVersion: (
    skillRef: SkillRef,
    version: string,
    input: SkillActivationInput
  ) => Promise<Result<SkillActivation>>;
  readonly rollbackSkill: (
    skillRef: SkillRef,
    input: SkillActivationInput,
    rollbackTarget: SkillRef
  ) => Promise<Result<SkillActivation>>;
  readonly listActiveSkills: (scope: SkillScope) => Promise<Result<ActiveSkillList>>;
  readonly loadSkillBody: (skillRef: SkillRef, options: LoadSkillOptions) => Promise<Result<SkillBodyMaterialization>>;
  readonly loadSkillSummary: (
    skillRef: SkillRef,
    options: LoadSkillOptions
  ) => Promise<Result<SkillSummaryMaterialization>>;
  readonly findSkillCandidates: (context: SkillCandidateContext) => Promise<Result<SkillCandidateList>>;
  readonly explainSkillCandidate: (
    skillRef: SkillRef,
    context: SkillCandidateContext
  ) => Promise<Result<SkillCandidateExplanation>>;
  readonly ensureDefaultFeedbackRouter: (input: DefaultFeedbackRouterInput) => Promise<Result<SkillRef>>;
}

export interface SkillCatalogIndex {
  readonly skillRefs: readonly SkillRef[];
}

export interface SkillActivationIndex {
  readonly activationIds: readonly SkillActivationId[];
}

export type SkillRegistryDependencies = {
  readonly store: FileNativeStore;
  readonly options: SkillRegistryOptions;
};

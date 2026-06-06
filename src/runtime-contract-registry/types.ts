import type { BrandedString } from "../domain/brand.js";
import type {
  ArtifactRef,
  AuditDescriptor,
  GrowUnitRef,
  HatchPackageRef,
  PolicyDecisionId,
  RuntimeContractRef,
  RuntimeKernelType,
  SourceDescriptor,
  VersionDescriptor
} from "../domain/index.js";
import type { RuntimeContractSummary } from "../domain/contracts.js";
import type { Result } from "../domain/result.js";
import type { ArtifactRegistry } from "../artifact-registry/index.js";
import type { EventAppendReceipt, EventLedger } from "../event-ledger/index.js";
import type { FileNativeStore, WorkspaceHandle, WriteReceipt } from "../file-store/index.js";
import type { GrowUnitManager } from "../grow-unit-manager/index.js";
import type { EvidenceReadiness, ReadinessVerdictRef } from "../evidence-readiness/index.js";
import type { PolicyBoundary, PolicyContext, PolicyDecision } from "../policy-boundary/index.js";
import type { SkillRegistry } from "../skill-registry/index.js";

export type InputContractId = BrandedString<"InputContractId">;
export type OutputContractId = BrandedString<"OutputContractId">;
export type ActionBoundaryId = BrandedString<"ActionBoundaryId">;
export type DebugContractId = BrandedString<"DebugContractId">;
export type FeedbackContractId = BrandedString<"FeedbackContractId">;
export type FailureContractId = BrandedString<"FailureContractId">;
export type ObservabilityContractId = BrandedString<"ObservabilityContractId">;
export type CompatibilityId = BrandedString<"CompatibilityId">;
export type ContractReportId = BrandedString<"ContractReportId">;

export interface ComponentRef<Kind extends string, Id extends string> {
  readonly kind: Kind;
  readonly id: Id;
  readonly uri?: string;
}
export type InputContractRef = ComponentRef<"input_contract", InputContractId>;
export type OutputContractRef = ComponentRef<"output_contract", OutputContractId>;
export type ActionBoundaryRef = ComponentRef<"action_boundary", ActionBoundaryId>;
export type DebugContractRef = ComponentRef<"debug_contract", DebugContractId>;
export type FeedbackContractRef = ComponentRef<"feedback_contract", FeedbackContractId>;
export type FailureContractRef = ComponentRef<"failure_contract", FailureContractId>;
export type ObservabilityContractRef = ComponentRef<"observability_contract", ObservabilityContractId>;
export type CompatibilityRef = ComponentRef<"version_compatibility", CompatibilityId>;
export type ContractReportRef = ComponentRef<"contract_report", ContractReportId>;

export type RuntimeContractLifecycle =
  | "candidate" | "registered" | "validated" | "verification_failed" | "locked_for_hatch"
  | "packaged" | "active" | "deprecated" | "retracted" | "superseded" | "incompatible";

export type InputMode =
  | "command_args" | "file_material" | "event" | "state_snapshot" | "tick_state" | "dialogue_turn"
  | "sensor_frame" | "batch_job" | "external_service_request";
export type OutputMode =
  | "text_result" | "structured_result" | "file_artifact" | "action_event" | "decision_event"
  | "control_command" | "patch_candidate" | "chapter_output" | "music_fragment" | "debug_event"
  | "feedback_candidate";
export type DebugMode = "off" | "local_trace" | "developer_debug" | "feedback_reporting" | "upstream_proposal";

export interface InputContract {
  readonly inputContractRef: InputContractRef;
  readonly inputModes: readonly InputMode[];
  readonly inputSchemas: readonly string[];
  readonly stateSnapshotRequirements: readonly string[];
  readonly artifactInputRules: readonly string[];
  readonly dialogueInputSupport: boolean;
  readonly streamingInputSupport: boolean;
  readonly batchInputSupport: boolean;
  readonly timingSemantics: string;
  readonly privacyRules: readonly string[];
}

export interface OutputContract {
  readonly outputContractRef: OutputContractRef;
  readonly outputModes: readonly OutputMode[];
  readonly outputSchemas: readonly string[];
  readonly eventSchemas: readonly string[];
  readonly artifactOutputRules: readonly string[];
  readonly actionOutputRules: readonly string[];
  readonly streamingOutputSupport: boolean;
  readonly partialOutputSemantics: string;
  readonly privacyRules: readonly string[];
}

export interface ActionBoundaryContract {
  readonly actionBoundaryRef: ActionBoundaryRef;
  readonly allowedActionKinds: readonly string[];
  readonly forbiddenActionKinds: readonly string[];
  readonly requiredCapabilities: readonly string[];
  readonly targetWorldActionSummary: string;
  readonly externalServiceSummary: string;
  readonly fileAccessSummary: string;
  readonly networkAccessSummary: string;
  readonly humanApprovalRequirements: readonly string[];
  readonly boundaryDeclaration: string;
  readonly policyDecisionRefs: readonly PolicyDecisionId[];
}

export interface DebugContract {
  readonly debugContractRef: DebugContractRef;
  readonly debugModes: readonly DebugMode[];
  readonly traceLevel: "off" | "summary" | "detailed" | "diagnostic";
  readonly traceEventKinds: readonly string[];
  readonly correlationRules: readonly string[];
  readonly messageListExposureRules: readonly string[];
  readonly toolResultExposureRules: readonly string[];
  readonly targetWorldStateExposureRules: readonly string[];
  readonly privacyRules: readonly string[];
  readonly uploadPolicyRequirement: string;
}

export interface FeedbackContract {
  readonly feedbackContractRef: FeedbackContractRef;
  readonly feedbackEntryKinds: readonly string[];
  readonly feedbackUnitShape: string;
  readonly attributionRules: readonly string[];
  readonly originLayerRules: readonly string[];
  readonly targetLayerRules: readonly string[];
  readonly evidenceRequirements: readonly string[];
  readonly redactionRules: readonly string[];
  readonly upstreamProposalRules: readonly string[];
  readonly defaultFeedbackRouterCompatibility: string;
  readonly policyDecisionRefs: readonly PolicyDecisionId[];
}

export interface FailureContract {
  readonly failureContractRef: FailureContractRef;
  readonly errorCodes: readonly string[];
  readonly retryability: string;
  readonly timeoutSemantics: string;
  readonly cancellationSemantics: string;
  readonly partialResultSemantics: string;
  readonly fallbackSemantics: string;
  readonly recoveryRequirements: readonly string[];
  readonly traceRequirements: readonly string[];
}

export interface ObservabilityContract {
  readonly observabilityContractRef: ObservabilityContractRef;
  readonly requiredTraceRefs: readonly ArtifactRef[];
  readonly runtimeTraceKinds: readonly string[];
  readonly metricSummaries: readonly string[];
  readonly eventCorrelationRules: readonly string[];
  readonly artifactRetentionRules: readonly string[];
  readonly privacyRules: readonly string[];
}

export interface VersionCompatibility {
  readonly compatibilityRef: CompatibilityRef;
  readonly version: VersionDescriptor;
  readonly compatibleWith: readonly string[];
  readonly breakingChanges: readonly string[];
  readonly migrationNotes: string;
  readonly rollbackTarget?: RuntimeContractRef;
  readonly deprecationPolicy: string;
}

export interface RuntimeContractShape {
  readonly input?: InputContract;
  readonly output?: OutputContract;
  readonly event?: OutputContract;
  readonly actionBoundary?: ActionBoundaryContract;
  readonly debug?: DebugContract;
  readonly feedback?: FeedbackContract;
  readonly failure?: FailureContract;
  readonly observability?: ObservabilityContract;
  readonly compatibility?: VersionCompatibility;
}

export interface RuntimeContractRecord {
  readonly runtimeContractRef: RuntimeContractRef;
  readonly growUnitRef: GrowUnitRef;
  readonly hatchPackageRef?: HatchPackageRef;
  readonly name: string;
  readonly version: VersionDescriptor;
  readonly lifecycle: RuntimeContractLifecycle;
  readonly runtimeKernelType: RuntimeKernelType;
  readonly targetWorldSummaryRef?: ArtifactRef;
  readonly shape: RuntimeContractShape;
  readonly capabilityRequirements: readonly string[];
  readonly policyDecisionRefs: readonly PolicyDecisionId[];
  readonly evidenceRefs: readonly ArtifactRef[];
  readonly readinessVerdictRef?: ReadinessVerdictRef;
  readonly artifactRef: ArtifactRef;
  readonly latestCompletenessReportRef?: ContractReportRef;
  readonly latestVerificationReportRef?: ContractReportRef;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly recordVersion: number;
}

export interface RuntimeContractInput {
  readonly growUnitRef: GrowUnitRef;
  readonly name: string;
  readonly version: VersionDescriptor;
  readonly runtimeKernelType: RuntimeKernelType;
  readonly targetWorldSummaryRef?: ArtifactRef;
  readonly shape?: RuntimeContractShape;
  readonly capabilityRequirements?: readonly string[];
  readonly evidenceRefs?: readonly ArtifactRef[];
  readonly readinessVerdictRef?: ReadinessVerdictRef;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface RuntimeContractReceipt {
  readonly runtimeContractRef: RuntimeContractRef;
  readonly from: RuntimeContractLifecycle;
  readonly to: RuntimeContractLifecycle;
  readonly artifactRef: ArtifactRef;
  readonly eventReceipt?: EventAppendReceipt;
  readonly recordWriteReceipt?: WriteReceipt;
  readonly policyDecision?: PolicyDecision;
}

export interface ContractCompletenessReport {
  readonly reportRef: ContractReportRef;
  readonly runtimeContractRef: RuntimeContractRef;
  readonly complete: boolean;
  readonly missing: readonly string[];
  readonly blockers: readonly string[];
  readonly artifactRef: ArtifactRef;
  readonly createdAt: string;
}

export interface ContractVerificationReport extends ContractCompletenessReport {
  readonly readinessVerdictRef: ReadinessVerdictRef;
  readonly verifiedForHatch: boolean;
}

export interface RuntimeContractMaterialization {
  readonly runtimeContractRef: RuntimeContractRef;
  readonly artifactRef: ArtifactRef;
  readonly content: string;
  readonly record: RuntimeContractRecord;
}

export interface RuntimeContractPage {
  readonly records: readonly RuntimeContractRecord[];
  readonly total: number;
  readonly nextCursor?: string;
  readonly truncated: boolean;
}

export interface RuntimeContractQuery {
  readonly growUnitRef?: GrowUnitRef;
  readonly lifecycle?: RuntimeContractLifecycle;
  readonly kernelType?: RuntimeKernelType;
  readonly text?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface RuntimeContractDiffSummary {
  readonly from: RuntimeContractRef;
  readonly to: RuntimeContractRef;
  readonly changedFields: readonly string[];
  readonly breakingChanges: readonly string[];
  readonly compatible: boolean;
}

export interface RuntimeContractExplanation {
  readonly runtimeContractRef: RuntimeContractRef;
  readonly summary: string;
  readonly facts: readonly string[];
}

export interface RuntimeContractRegistryOptions {
  readonly workspace: WorkspaceHandle;
  readonly store: FileNativeStore;
  readonly ledger: EventLedger;
  readonly artifactRegistry: ArtifactRegistry;
  readonly policyBoundary: PolicyBoundary;
  readonly growUnitManager: GrowUnitManager;
  readonly evidenceReadiness: EvidenceReadiness;
  readonly skillRegistry: SkillRegistry;
  readonly producer: string;
}

export interface RuntimeContractRegistry {
  readonly recordContractCandidate: (input: RuntimeContractInput) => Promise<Result<RuntimeContractRef>>;
  readonly registerRuntimeContract: (input: RuntimeContractInput) => Promise<Result<RuntimeContractRef>>;
  readonly getRuntimeContract: (ref: RuntimeContractRef) => Promise<Result<RuntimeContractRecord>>;
  readonly listRuntimeContracts: (query?: RuntimeContractQuery) => Promise<Result<RuntimeContractPage>>;
  readonly materializeRuntimeContract: (ref: RuntimeContractRef) => Promise<Result<RuntimeContractMaterialization>>;
  readonly addRuntimeContractVersion: (ref: RuntimeContractRef, input: RuntimeContractInput) => Promise<Result<RuntimeContractRef>>;
  readonly compareRuntimeContractVersions: (a: RuntimeContractRef, b: RuntimeContractRef) => Promise<Result<RuntimeContractDiffSummary>>;
  readonly deprecateRuntimeContract: (ref: RuntimeContractRef, reason: string) => Promise<Result<RuntimeContractReceipt>>;
  readonly retractRuntimeContract: (ref: RuntimeContractRef, reason: string) => Promise<Result<RuntimeContractReceipt>>;
  readonly validateRuntimeContract: (ref: RuntimeContractRef) => Promise<Result<ContractCompletenessReport>>;
  readonly verifyRuntimeContractForHatch: (ref: RuntimeContractRef, readiness: ReadinessVerdictRef) => Promise<Result<ContractVerificationReport>>;
  readonly lockRuntimeContractForHatch: (ref: RuntimeContractRef, input: { readonly reason: string; readonly policyContext?: PolicyContext }) => Promise<Result<RuntimeContractReceipt>>;
  readonly buildRuntimeContractSummary: (ref: RuntimeContractRef) => Promise<Result<RuntimeContractSummary>>;
  readonly explainRuntimeContract: (ref: RuntimeContractRef) => Promise<Result<RuntimeContractExplanation>>;
  readonly explainCompatibility: (ref: RuntimeContractRef, targetVersion: string) => Promise<Result<RuntimeContractExplanation>>;
}

export interface RuntimeContractIndex { readonly refs: readonly RuntimeContractRef[]; }

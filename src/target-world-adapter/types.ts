import type { BrandedString } from "../domain/brand.js";
import type {
  ArtifactRef,
  AuditDescriptor,
  HatchPackageRef,
  PolicyDecisionId,
  PrivacyLevel,
  RuntimeContractRef,
  RuntimeKernelType,
  SourceDescriptor,
  TargetWorldId,
  TargetWorldRef,
  VersionDescriptor
} from "../domain/index.js";
import type { Result } from "../domain/result.js";
import type { FileNativeStore, WorkspaceHandle, WriteReceipt } from "../file-store/index.js";
import type { ArtifactRegistry } from "../artifact-registry/index.js";
import type { EventAppendReceipt, EventLedger } from "../event-ledger/index.js";
import type { PolicyBoundary, PolicyContext, PolicyDecision, BoundaryDeclaration } from "../policy-boundary/index.js";
import type { RuntimeContractRegistry } from "../runtime-contract-registry/index.js";
import type { HatchBuilder } from "../hatch-builder/index.js";
import type { EvidenceReadiness } from "../evidence-readiness/index.js";
import type {
  TargetActionReceiptId,
  TargetActionRequestId,
  TargetDebugSignalId,
  TargetFailureMappingId,
  TargetValidationReportId,
  TargetWorldAdapterId,
  TargetWorldCompatibilityReportId,
  WorldInputId,
  WorldOutputId
} from "./brand.js";

export interface ComponentRef<Kind extends string, Id extends string> {
  readonly kind: Kind;
  readonly id: Id;
  readonly uri?: string;
}

export type TargetWorldAdapterRef = ComponentRef<"target_world_adapter", TargetWorldAdapterId>;
export type TargetWorldCompatibilityReportRef = ComponentRef<"target_world_compatibility_report", TargetWorldCompatibilityReportId>;
export type WorldInputEnvelopeRef = ComponentRef<"world_input", WorldInputId>;
export type WorldOutputEnvelopeRef = ComponentRef<"world_output", WorldOutputId>;
export type TargetActionRequestRef = ComponentRef<"target_action_request", TargetActionRequestId>;
export type TargetActionReceiptRef = ComponentRef<"target_action_receipt", TargetActionReceiptId>;
export type TargetValidationReportRef = ComponentRef<"target_validation_report", TargetValidationReportId>;
export type TargetFailureMappingRef = ComponentRef<"target_failure_mapping", TargetFailureMappingId>;
export type TargetDebugSignalRef = ComponentRef<"target_debug_signal", TargetDebugSignalId>;

export type TargetWorldKind =
  | "novel_project" | "game_engine" | "simulation" | "music_workflow" | "robotics_or_vehicle"
  | "cli_tool" | "service" | "file_workflow" | "custom";
export type WorldInputKind = "state_snapshot" | "tick_state" | "dialogue_turn" | "file_material" | "event" | "sensor_frame" | "batch_job" | "manual_trigger";
export type WorldOutputKind =
  | "structured_result" | "text_result" | "action_event" | "decision_event" | "control_command"
  | "file_artifact" | "patch_candidate" | "chapter_output" | "music_fragment" | "debug_event" | "feedback_candidate";
export type TargetValidationKind = "contract_shape" | "scenario_check" | "simulation_check" | "lint" | "playtest" | "human_review" | "custom";
export type DebugSignalKind = "state_snapshot" | "input_output_pair" | "action_trace" | "validation_trace" | "performance_sample" | "failure_trace" | "user_observation" | "environment_log";
export type AdapterLifecycle = "candidate" | "registered" | "active" | "disabled" | "deprecated" | "retracted" | "incompatible" | "unavailable";
export type TargetActionDispatchStatus = "proposed" | "validated" | "waiting_policy" | "policy_blocked" | "dispatched" | "rejected_by_target" | "failed" | "cancelled";
export type TargetValidationResult = "passed" | "failed" | "partial" | "inconclusive" | "blocked" | "not_available";
export type NormalizedFailureKind =
  | "invalid_input" | "invalid_output" | "action_rejected" | "target_unavailable" | "timeout"
  | "permission_denied" | "policy_blocked" | "contract_violation" | "adapter_incompatible"
  | "external_enforcement_failed" | "unknown_target_failure";

export interface TargetWorldDescriptorInput {
  readonly name: string;
  readonly kind: TargetWorldKind;
  readonly description: string;
  readonly inputKinds: readonly WorldInputKind[];
  readonly outputKinds: readonly WorldOutputKind[];
  readonly actionKinds: readonly string[];
  readonly validationKinds: readonly TargetValidationKind[];
  readonly debugSignalKinds: readonly DebugSignalKind[];
  readonly privacyBoundary: PrivacyLevel;
  readonly environmentBoundary: string;
  readonly capabilityRequirements: readonly string[];
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
}

export interface TargetWorldDescriptor extends TargetWorldDescriptorInput {
  readonly targetWorldId: TargetWorldId;
  readonly targetWorldRef: TargetWorldRef;
  readonly summaryArtifactRef: ArtifactRef;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly recordVersion: number;
}

export interface TargetWorldAdapterInput {
  readonly targetWorldRef: TargetWorldRef;
  readonly name: string;
  readonly supportedRuntimeKernelTypes: readonly RuntimeKernelType[];
  readonly supportedInputKinds: readonly WorldInputKind[];
  readonly supportedOutputKinds: readonly WorldOutputKind[];
  readonly supportedActionKinds: readonly string[];
  readonly supportedValidationKinds: readonly TargetValidationKind[];
  readonly hostIntegrationSummary: string;
  readonly compatibility: string;
  readonly policyBoundarySummary: string;
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
}

export interface TargetWorldAdapterDefinition extends TargetWorldAdapterInput {
  readonly adapterId: TargetWorldAdapterId;
  readonly adapterRef: TargetWorldAdapterRef;
  readonly lifecycle: AdapterLifecycle;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly recordVersion: number;
}

export interface TargetWorldCompatibilityReport {
  readonly reportId: TargetWorldCompatibilityReportId;
  readonly reportRef: TargetWorldCompatibilityReportRef;
  readonly runtimeContractRef: RuntimeContractRef;
  readonly targetWorldRef: TargetWorldRef;
  readonly compatible: boolean;
  readonly matchedInputKinds: readonly string[];
  readonly matchedOutputKinds: readonly string[];
  readonly matchedActionKinds: readonly string[];
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly artifactRef: ArtifactRef;
  readonly createdAt: string;
}

export interface WorldInputEnvelopeInput {
  readonly targetWorldRef: TargetWorldRef;
  readonly runtimeContractRef: RuntimeContractRef;
  readonly hatchPackageRef: HatchPackageRef;
  readonly inputKind: WorldInputKind;
  readonly rawInputArtifactRef?: ArtifactRef;
  readonly normalizedInput: unknown;
  readonly stateSnapshotRef?: ArtifactRef;
  readonly privacyClass: PrivacyLevel;
  readonly correlationId?: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface WorldInputEnvelope extends Omit<WorldInputEnvelopeInput, "normalizedInput"> {
  readonly worldInputId: WorldInputId;
  readonly worldInputRef: WorldInputEnvelopeRef;
  readonly normalizedInputRef: ArtifactRef;
  readonly createdAt: string;
  readonly recordVersion: number;
}

export interface WorldOutputEnvelopeInput {
  readonly targetWorldRef: TargetWorldRef;
  readonly runtimeContractRef: RuntimeContractRef;
  readonly hatchPackageRef: HatchPackageRef;
  readonly outputKind: WorldOutputKind;
  readonly runtimeOutputRef?: ArtifactRef;
  readonly normalizedOutput: unknown;
  readonly privacyClass: PrivacyLevel;
  readonly correlationId?: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface WorldOutputEnvelope extends Omit<WorldOutputEnvelopeInput, "normalizedOutput"> {
  readonly worldOutputId: WorldOutputId;
  readonly worldOutputRef: WorldOutputEnvelopeRef;
  readonly normalizedOutputRef: ArtifactRef;
  readonly actionRequestRefs: readonly TargetActionRequestRef[];
  readonly eventRefs: readonly ArtifactRef[];
  readonly createdAt: string;
  readonly recordVersion: number;
}

export interface ExternalEnforcementDeclaration {
  readonly enforcedBy: string;
  readonly evidenceRef?: ArtifactRef;
  readonly summary: string;
}

export interface TargetActionInput {
  readonly actionKind: string;
  readonly actionPayload: unknown;
  readonly resourceSummary: string;
  readonly requiredCapabilities?: readonly string[];
  readonly externalEnforcement?: ExternalEnforcementDeclaration;
  readonly policyContext?: PolicyContext;
  readonly reason: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface TargetActionRequest {
  readonly targetActionRequestId: TargetActionRequestId;
  readonly targetActionRequestRef: TargetActionRequestRef;
  readonly worldOutputRef: WorldOutputEnvelopeRef;
  readonly targetWorldRef: TargetWorldRef;
  readonly runtimeContractRef: RuntimeContractRef;
  readonly hatchPackageRef: HatchPackageRef;
  readonly actionKind: string;
  readonly actionPayloadRef: ArtifactRef;
  readonly resourceSummary: string;
  readonly requiredCapabilities: readonly string[];
  readonly policyDecisionId?: PolicyDecisionId;
  readonly policyDecision?: PolicyDecision;
  readonly externalEnforcement?: ExternalEnforcementDeclaration;
  readonly boundaryDeclaration: BoundaryDeclaration;
  readonly dispatchStatus: TargetActionDispatchStatus;
  readonly blockers: readonly string[];
  readonly correlationId?: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly recordVersion: number;
}

export interface TargetActionReceipt {
  readonly receiptRef: TargetActionReceiptRef;
  readonly targetActionRequestRef: TargetActionRequestRef;
  readonly from: TargetActionDispatchStatus;
  readonly to: TargetActionDispatchStatus;
  readonly reason: string;
  readonly recordWriteReceipt?: WriteReceipt;
  readonly eventReceipt?: EventAppendReceipt;
}

export interface TargetValidationInput {
  readonly targetWorldRef: TargetWorldRef;
  readonly runtimeContractRef: RuntimeContractRef;
  readonly hatchPackageRef: HatchPackageRef;
  readonly validationKind: TargetValidationKind;
  readonly inputRefs: readonly WorldInputEnvelopeRef[];
  readonly outputRefs: readonly WorldOutputEnvelopeRef[];
  readonly result: TargetValidationResult;
  readonly summary: string;
  readonly failureMappingRefs?: readonly TargetFailureMappingRef[];
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface TargetValidationReport extends TargetValidationInput {
  readonly validationReportId: TargetValidationReportId;
  readonly validationReportRef: TargetValidationReportRef;
  readonly artifactRef: ArtifactRef;
  readonly evidenceCandidateRef: ArtifactRef;
  readonly createdAt: string;
  readonly recordVersion: number;
}

export interface TargetOutputValidation {
  readonly worldOutputRef: WorldOutputEnvelopeRef;
  readonly result: TargetValidationResult;
  readonly blockers: readonly string[];
  readonly checkedAt: string;
}

export interface TargetFailureMappingInput {
  readonly targetWorldRef: TargetWorldRef;
  readonly runtimeContractRef: RuntimeContractRef;
  readonly targetFailureKind: string;
  readonly normalizedFailureKind: NormalizedFailureKind;
  readonly retryable: boolean;
  readonly severity: "low" | "medium" | "high" | "fatal";
  readonly attributionHint: string;
  readonly evidenceRefs: readonly ArtifactRef[];
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface TargetFailureMapping extends TargetFailureMappingInput {
  readonly failureMappingId: TargetFailureMappingId;
  readonly failureMappingRef: TargetFailureMappingRef;
  readonly createdAt: string;
  readonly recordVersion: number;
}

export interface TargetDebugSignalInput {
  readonly targetWorldRef: TargetWorldRef;
  readonly runtimeContractRef: RuntimeContractRef;
  readonly hatchPackageRef: HatchPackageRef;
  readonly signalKind: DebugSignalKind;
  readonly summary: string;
  readonly detail?: unknown;
  readonly privacyClass: PrivacyLevel;
  readonly feedbackCandidateHint?: string;
  readonly uploadRequested?: boolean;
  readonly policyContext?: PolicyContext;
  readonly correlationId?: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface TargetDebugSignal extends Omit<TargetDebugSignalInput, "detail" | "policyContext" | "uploadRequested"> {
  readonly debugSignalId: TargetDebugSignalId;
  readonly debugSignalRef: TargetDebugSignalRef;
  readonly artifactRef: ArtifactRef;
  readonly policyDecisionId?: PolicyDecisionId;
  readonly uploadRequested: boolean;
  readonly createdAt: string;
  readonly recordVersion: number;
}

export interface TargetWorldPage<T> {
  readonly records: readonly T[];
  readonly total: number;
  readonly nextCursor?: string;
  readonly truncated: boolean;
}

export interface AdapterQuery {
  readonly targetWorldRef?: TargetWorldRef;
  readonly lifecycle?: AdapterLifecycle;
  readonly kernelType?: RuntimeKernelType;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface TargetWorldAdapterOptions {
  readonly workspace: WorkspaceHandle;
  readonly store: FileNativeStore;
  readonly ledger: EventLedger;
  readonly artifactRegistry: ArtifactRegistry;
  readonly policyBoundary: PolicyBoundary;
  readonly runtimeContractRegistry: RuntimeContractRegistry;
  readonly hatchBuilder: HatchBuilder;
  readonly evidenceReadiness: EvidenceReadiness;
  readonly producer: string;
}

export interface TargetWorldAdapter {
  readonly registerTargetWorld: (input: TargetWorldDescriptorInput) => Promise<Result<TargetWorldRef>>;
  readonly getTargetWorld: (ref: TargetWorldRef) => Promise<Result<TargetWorldDescriptor>>;
  readonly registerAdapter: (input: TargetWorldAdapterInput) => Promise<Result<TargetWorldAdapterRef>>;
  readonly listAdapters: (query?: AdapterQuery) => Promise<Result<TargetWorldPage<TargetWorldAdapterDefinition>>>;
  readonly changeAdapterLifecycle: (ref: TargetWorldAdapterRef, lifecycle: AdapterLifecycle, reason: string) => Promise<Result<TargetWorldAdapterDefinition>>;
  readonly checkRuntimeContractCompatibility: (runtimeContractRef: RuntimeContractRef, targetWorldRef: TargetWorldRef) => Promise<Result<TargetWorldCompatibilityReport>>;
  readonly explainCompatibility: (ref: TargetWorldCompatibilityReportRef) => Promise<Result<readonly string[]>>;
  readonly normalizeWorldInput: (input: WorldInputEnvelopeInput) => Promise<Result<WorldInputEnvelope>>;
  readonly getWorldInput: (ref: WorldInputEnvelopeRef) => Promise<Result<WorldInputEnvelope>>;
  readonly normalizeRuntimeOutput: (input: WorldOutputEnvelopeInput) => Promise<Result<WorldOutputEnvelope>>;
  readonly getWorldOutput: (ref: WorldOutputEnvelopeRef) => Promise<Result<WorldOutputEnvelope>>;
  readonly validateWorldOutput: (ref: WorldOutputEnvelopeRef) => Promise<Result<TargetOutputValidation>>;
  readonly prepareTargetAction: (outputEnvelopeRef: WorldOutputEnvelopeRef, input: TargetActionInput) => Promise<Result<TargetActionRequest>>;
  readonly getTargetAction: (ref: TargetActionRequestRef) => Promise<Result<TargetActionRequest>>;
  readonly dispatchTargetAction: (ref: TargetActionRequestRef, reason: string) => Promise<Result<TargetActionReceipt>>;
  readonly cancelTargetAction: (ref: TargetActionRequestRef, reason: string) => Promise<Result<TargetActionReceipt>>;
  readonly runTargetValidation: (input: TargetValidationInput) => Promise<Result<TargetValidationReport>>;
  readonly recordTargetDebugSignal: (input: TargetDebugSignalInput) => Promise<Result<TargetDebugSignal>>;
  readonly getTargetDebugSignal: (ref: TargetDebugSignalRef) => Promise<Result<TargetDebugSignal>>;
  readonly mapTargetFailure: (input: TargetFailureMappingInput) => Promise<Result<TargetFailureMapping>>;
}

export interface RefIndex<T> { readonly refs: readonly T[]; }

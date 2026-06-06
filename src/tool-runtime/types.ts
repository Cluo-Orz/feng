import type { BrandedString } from "../domain/brand.js";
import type {
  ArtifactRef,
  AttemptRef,
  AuditDescriptor,
  GrowUnitRef,
  MessageListRef,
  PolicyDecisionId,
  PrivacyLevel,
  SourceDescriptor,
  ToolId,
  ToolRef,
  VersionDescriptor
} from "../domain/index.js";
import type { EventAppendReceipt, EventLedger } from "../event-ledger/index.js";
import type { ReadReceipt } from "../file-store/index.js";
import type { PolicyDecision } from "../policy-boundary/index.js";

export type {
  ToolExecutionOptions,
  ToolImplementation,
  ToolImplementationContext,
  ToolRegistryIndex,
  ToolRuntime,
  ToolRuntimeOptions
} from "./runtime-types.js";

export type ToolCallId = BrandedString<"ToolCallId">;
export type ToolSurfaceId = BrandedString<"ToolSurfaceId">;
export type ToolInputValidationId = BrandedString<"ToolInputValidationId">;
export type ToolExecutionId = BrandedString<"ToolExecutionId">;
export type ToolSettlementId = BrandedString<"ToolSettlementId">;

export const toolSourceKinds = [
  "system_default",
  "workspace_local",
  "grow_generated",
  "hatch_imported",
  "runtime_imported",
  "external_package",
  "host_provided"
] as const;
export type ToolSourceKind = (typeof toolSourceKinds)[number];

export const toolLifecycles = [
  "discovered",
  "registered",
  "active",
  "disabled",
  "deprecated",
  "retracted",
  "unavailable",
  "incompatible"
] as const;
export type ToolLifecycle = (typeof toolLifecycles)[number];

export const toolRiskLevels = ["low", "medium", "high", "critical"] as const;
export type ToolRiskLevel = (typeof toolRiskLevels)[number];

export const toolRequestedByKinds = [
  "grow_attempt_runner",
  "agent_runtime_kernel",
  "cli",
  "debug_bridge",
  "target_world_adapter"
] as const;
export type ToolRequestedBy = (typeof toolRequestedByKinds)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface ToolJsonSchema {
  readonly type?: string | readonly string[];
  readonly properties?: Record<string, ToolJsonSchema>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly enum?: readonly JsonValue[];
  readonly items?: ToolJsonSchema;
  readonly format?: string;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly description?: string;
}

export interface SideEffectProfile {
  readonly mutatesWorkspace: boolean;
  readonly mutatesExternalWorld: boolean;
  readonly readsSecrets: boolean;
  readonly networkAccess: boolean;
  readonly summary: string;
}

export interface CredentialRequirement {
  readonly name: string;
  readonly optional?: boolean;
  readonly purpose: string;
}

export interface ToolTimeoutPolicy {
  readonly defaultMs: number;
  readonly maxMs: number;
  readonly cancellable: boolean;
}

export interface ToolConcurrencyPolicy {
  readonly maxConcurrentPerTool: number;
  readonly queueWhenBusy: boolean;
}

export interface ToolImplementationRef {
  readonly kind: "host_function" | "command" | "external_adapter" | "none";
  readonly implementationId: string;
  readonly entrypoint?: string;
  readonly runtime?: string;
}

export interface ToolCompatibility {
  readonly fengVersionRange?: string;
  readonly runtimeKernelTypes?: readonly string[];
  readonly requiredCapabilities?: readonly string[];
  readonly notes?: string;
}

export interface ToolDefinition {
  readonly toolId: ToolId;
  readonly toolRef: ToolRef;
  readonly name: string;
  readonly namespace: string;
  readonly version: VersionDescriptor;
  readonly lifecycle: ToolLifecycle;
  readonly sourceKind: ToolSourceKind;
  readonly source: SourceDescriptor;
  readonly description: string;
  readonly inputSchema: ToolJsonSchema;
  readonly inputSchemaRef?: ArtifactRef;
  readonly outputSchema?: ToolJsonSchema;
  readonly outputSchemaSummary: string;
  readonly declaredCapabilities: readonly string[];
  readonly risk: ToolRiskLevel;
  readonly sideEffects: SideEffectProfile;
  readonly credentialRequirements: readonly CredentialRequirement[];
  readonly timeout: ToolTimeoutPolicy;
  readonly concurrency: ToolConcurrencyPolicy;
  readonly implementation: ToolImplementationRef;
  readonly compatibility: ToolCompatibility;
  readonly privacyClass: PrivacyLevel;
  readonly audit: AuditDescriptor;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RegisterToolInput {
  readonly name: string;
  readonly namespace?: string;
  readonly version: VersionDescriptor;
  readonly lifecycle?: ToolLifecycle;
  readonly sourceKind: ToolSourceKind;
  readonly source: SourceDescriptor;
  readonly description: string;
  readonly inputSchema: ToolJsonSchema;
  readonly inputSchemaRef?: ArtifactRef;
  readonly outputSchema?: ToolJsonSchema;
  readonly outputSchemaSummary?: string;
  readonly declaredCapabilities?: readonly string[];
  readonly risk?: ToolRiskLevel;
  readonly sideEffects?: SideEffectProfile;
  readonly credentialRequirements?: readonly CredentialRequirement[];
  readonly timeout?: Partial<ToolTimeoutPolicy>;
  readonly concurrency?: Partial<ToolConcurrencyPolicy>;
  readonly implementation: ToolImplementationRef;
  readonly compatibility?: ToolCompatibility;
  readonly privacyClass?: PrivacyLevel;
  readonly audit: AuditDescriptor;
}

export interface ToolCatalogQuery {
  readonly text?: string;
  readonly namespace?: string;
  readonly lifecycle?: ToolLifecycle;
  readonly sourceKind?: ToolSourceKind;
  readonly includeUnavailable?: boolean;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface ToolCatalogPage {
  readonly records: readonly ToolDefinition[];
  readonly total: number;
  readonly nextCursor?: string;
  readonly truncated: boolean;
}

export interface ToolDiscoveryScope {
  readonly searchPaths: readonly string[];
  readonly sourceKind?: ToolSourceKind;
  readonly maxDepth?: number;
}

export interface ToolDiscoveryReport {
  readonly discovered: readonly Pick<ToolDefinition, "toolRef" | "name" | "namespace" | "version">[];
  readonly ignored: readonly string[];
}

export interface ToolLifecycleReceipt {
  readonly toolRef: ToolRef;
  readonly from: ToolLifecycle;
  readonly to: ToolLifecycle;
  readonly reason: string;
  readonly eventReceipt?: EventAppendReceipt;
}

export interface ToolSurfaceEntry {
  readonly toolRef: ToolRef;
  readonly name: string;
  readonly namespace: string;
  readonly version: VersionDescriptor;
  readonly description: string;
  readonly inputSchemaSummary: string;
  readonly outputSchemaSummary: string;
  readonly declaredCapabilities: readonly string[];
  readonly risk: ToolRiskLevel;
  readonly sideEffects: SideEffectProfile;
  readonly lifecycle: ToolLifecycle;
  readonly compatibilityWarnings: readonly string[];
}

export interface ToolSurfaceSummary {
  readonly surfaceId: ToolSurfaceId;
  readonly entries: readonly ToolSurfaceEntry[];
  readonly filters: ToolCatalogQuery;
  readonly generatedAt: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface ToolSurfaceDescription {
  readonly surface: ToolSurfaceSummary;
  readonly surfaceRef: ArtifactRef;
  readonly eventReceipt?: EventAppendReceipt;
}

export interface ToolCallRequest {
  readonly toolCallId: ToolCallId;
  readonly toolRef: ToolRef;
  readonly toolVersion?: string;
  readonly attemptRef?: AttemptRef;
  readonly growUnitRef?: GrowUnitRef;
  readonly messageListRef?: MessageListRef;
  readonly requestedBy: ToolRequestedBy;
  readonly input?: JsonValue;
  readonly inputArtifactRef?: ArtifactRef;
  readonly requestedCapabilities?: readonly string[];
  readonly availableCredentialNames?: readonly string[];
  readonly reason: string;
  readonly correlationId?: string;
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
}

export type ToolValidationIssueCode =
  | "missing_required"
  | "unknown_field"
  | "type_mismatch"
  | "schema_version_mismatch"
  | "unsupported"
  | "artifact_unavailable"
  | "privacy_blocked"
  | "input_too_large"
  | "unsafe_path"
  | "unsafe_command"
  | "credential_missing"
  | "invalid_json";

export interface ToolValidationIssue {
  readonly code: ToolValidationIssueCode;
  readonly path: string;
  readonly message: string;
}

export interface ToolInputValidation {
  readonly validationId: ToolInputValidationId;
  readonly toolCallId: ToolCallId;
  readonly toolRef: ToolRef;
  readonly status: "valid" | "invalid";
  readonly issues: readonly ToolValidationIssue[];
  readonly normalizedInput?: JsonValue;
  readonly inputHash?: string;
  readonly inputArtifactRef?: ArtifactRef;
  readonly validationRef?: ArtifactRef;
  readonly readReceipt?: ReadReceipt;
  readonly validatedAt: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface ToolPolicyCheck {
  readonly decisions: readonly PolicyDecision[];
  readonly executable: boolean;
  readonly blockedBy?: PolicyDecision;
  readonly constraints: readonly string[];
  readonly redactionRequired: boolean;
}

export interface ToolExecutionResourceUsage {
  readonly durationMs: number;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly outputBytes: number;
}

export interface ToolSideEffectRecord {
  readonly kind: string;
  readonly summary: string;
  readonly artifactRef?: ArtifactRef;
}

export interface ToolExecutionOutput {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly structuredOutput?: JsonValue;
  readonly sideEffects?: readonly ToolSideEffectRecord[];
  readonly mediaType?: string;
  readonly privacyClass?: PrivacyLevel;
}

export type ToolExecutionStatus = "succeeded" | "failed" | "cancelled" | "timed_out" | "rejected";

export interface ToolExecutionError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface ToolExecutionReceipt {
  readonly executionId: ToolExecutionId;
  readonly toolCallId: ToolCallId;
  readonly toolRef: ToolRef;
  readonly toolVersion: VersionDescriptor;
  readonly status: ToolExecutionStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly attemptRef?: AttemptRef;
  readonly growUnitRef?: GrowUnitRef;
  readonly messageListRef?: MessageListRef;
  readonly policyDecisionIds: readonly PolicyDecisionId[];
  readonly validationRef?: ArtifactRef;
  readonly inputHash?: string;
  readonly outputArtifactRef?: ArtifactRef;
  readonly outputPreview: string;
  readonly stdoutPreview?: string;
  readonly stderrPreview?: string;
  readonly structuredOutputPreview?: JsonValue;
  readonly sideEffects: readonly ToolSideEffectRecord[];
  readonly resourceUsage: ToolExecutionResourceUsage;
  readonly error?: ToolExecutionError;
  readonly retryable: boolean;
  readonly redacted: boolean;
  readonly constraints: readonly string[];
  readonly receiptRef?: ArtifactRef;
  readonly correlationId?: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface ToolCancellationReceipt {
  readonly executionId: ToolExecutionId;
  readonly toolRef: ToolRef;
  readonly reason: string;
  readonly cancelledAt: string;
  readonly eventReceipt?: EventAppendReceipt;
}

export type ToolSettlementStatus =
  | "settled_success"
  | "settled_failure"
  | "validation_failed"
  | "policy_blocked"
  | "unavailable"
  | "cancelled"
  | "timed_out";

export interface ToolSettlement {
  readonly settlementId: ToolSettlementId;
  readonly toolCallId: ToolCallId;
  readonly toolRef: ToolRef;
  readonly attemptRef?: AttemptRef;
  readonly status: ToolSettlementStatus;
  readonly executionReceiptRef?: ArtifactRef;
  readonly resultArtifactRef?: ArtifactRef;
  readonly resultPreview: string;
  readonly error?: ToolExecutionError;
  readonly retryRecommendation: "retry_same" | "retry_after_change" | "do_not_retry";
  readonly nextActionHint: string;
  readonly visibleToModelSummary: string;
  readonly settlementRef?: ArtifactRef;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

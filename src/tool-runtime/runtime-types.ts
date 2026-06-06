import type { Result } from "../domain/result.js";
import type { ArtifactRef, AuditDescriptor, SourceDescriptor, ToolRef } from "../domain/index.js";
import type { ArtifactRegistry } from "../artifact-registry/index.js";
import type { FileNativeStore, WorkspaceHandle } from "../file-store/index.js";
import type { EventLedger } from "../event-ledger/index.js";
import type { PolicyBoundary, PolicyContext } from "../policy-boundary/index.js";
import type { SkillRegistry } from "../skill-registry/index.js";
import type {
  JsonValue,
  RegisterToolInput,
  ToolCallRequest,
  ToolCancellationReceipt,
  ToolCatalogPage,
  ToolCatalogQuery,
  ToolDefinition,
  ToolDiscoveryReport,
  ToolDiscoveryScope,
  ToolExecutionId,
  ToolExecutionOutput,
  ToolInputValidation,
  ToolLifecycle,
  ToolLifecycleReceipt,
  ToolSettlement,
  ToolSurfaceDescription,
  ToolSurfaceSummary
} from "./types.js";

export interface ToolImplementationContext {
  readonly request: ToolCallRequest;
  readonly definition: ToolDefinition;
  readonly input: JsonValue;
  readonly policy: import("./types.js").ToolPolicyCheck;
  readonly signal: AbortSignal;
}

export interface ToolImplementation {
  readonly implementationId: string;
  readonly execute: (context: ToolImplementationContext) => Promise<ToolExecutionOutput> | ToolExecutionOutput;
  readonly cancel?: (executionId: ToolExecutionId, reason: string) => Promise<void> | void;
}

export interface ToolExecutionOptions {
  readonly policyContext: PolicyContext;
  readonly timeoutMs?: number;
  readonly executionId?: ToolExecutionId;
}

export interface ToolRuntimeOptions {
  readonly workspace: WorkspaceHandle;
  readonly store: FileNativeStore;
  readonly ledger: EventLedger;
  readonly artifactRegistry: ArtifactRegistry;
  readonly policyBoundary: PolicyBoundary;
  readonly skillRegistry: SkillRegistry;
  readonly producer: string;
  readonly implementations?: readonly ToolImplementation[];
  readonly maxInlineInputBytes?: number;
  readonly maxOutputPreviewChars?: number;
  readonly defaultTimeoutMs?: number;
}

export interface ToolRuntime {
  readonly discoverTools: (scope: ToolDiscoveryScope) => Promise<Result<ToolDiscoveryReport>>;
  readonly registerTool: (input: RegisterToolInput) => Promise<Result<ToolRef>>;
  readonly getTool: (toolRef: ToolRef) => Promise<Result<ToolDefinition>>;
  readonly listTools: (query?: ToolCatalogQuery) => Promise<Result<ToolCatalogPage>>;
  readonly updateToolLifecycle: (
    toolRef: ToolRef,
    lifecycle: ToolLifecycle,
    reason: string
  ) => Promise<Result<ToolLifecycleReceipt>>;
  readonly describeToolSurface: (
    filters: ToolCatalogQuery,
    source: SourceDescriptor,
    audit: AuditDescriptor
  ) => Promise<Result<ToolSurfaceDescription>>;
  readonly explainToolSurface: (surfaceRef: ArtifactRef) => Promise<Result<ToolSurfaceSummary>>;
  readonly validateToolCall: (request: ToolCallRequest) => Promise<Result<ToolInputValidation>>;
  readonly explainToolInputValidation: (validationRef: ArtifactRef) => Promise<Result<ToolInputValidation>>;
  readonly executeTool: (
    request: ToolCallRequest,
    options: ToolExecutionOptions
  ) => Promise<Result<ToolSettlement>>;
  readonly cancelToolExecution: (executionId: ToolExecutionId, reason: string) => Promise<Result<ToolCancellationReceipt>>;
  readonly readToolExecutionReceipt: (
    receiptRef: ArtifactRef
  ) => Promise<Result<import("./types.js").ToolExecutionReceipt>>;
  readonly readToolSettlement: (settlementRef: ArtifactRef) => Promise<Result<ToolSettlement>>;
}

export interface ToolRegistryIndex {
  readonly toolRefs: readonly ToolRef[];
}

import type { ArtifactRef, AuditDescriptor, SourceDescriptor, ToolRef } from "../domain/index.js";
import {
  describeToolSurface,
  discoverTools,
  getTool,
  listTools,
  readToolSurface,
  registerTool,
  updateToolLifecycle
} from "./catalog.js";
import {
  cancelToolExecution,
  executeTool,
  readToolExecutionReceipt,
  readToolSettlement,
  validateToolCall
} from "./flow.js";
import { materializeJsonArtifact } from "./artifacts.js";
import { createToolRuntimeRuntime } from "./runtime.js";
import type {
  RegisterToolInput,
  ToolCatalogQuery,
  ToolDiscoveryScope,
  ToolExecutionId,
  ToolExecutionOptions,
  ToolInputValidation,
  ToolLifecycle,
  ToolRuntime,
  ToolRuntimeOptions
} from "./types.js";

export function createToolRuntime(options: ToolRuntimeOptions): ToolRuntime {
  const runtime = createToolRuntimeRuntime(options);
  return {
    discoverTools: (scope: ToolDiscoveryScope) => discoverTools(runtime, scope),
    registerTool: (input: RegisterToolInput) => registerTool(runtime, input),
    getTool: (toolRef: ToolRef) => getTool(runtime, toolRef),
    listTools: (query?: ToolCatalogQuery) => listTools(runtime, query),
    updateToolLifecycle: (toolRef: ToolRef, lifecycle: ToolLifecycle, reason: string) =>
      updateToolLifecycle(runtime, toolRef, lifecycle, reason),
    describeToolSurface: (filters: ToolCatalogQuery, source: SourceDescriptor, audit: AuditDescriptor) =>
      describeToolSurface({ runtime, filters, source, audit }),
    explainToolSurface: (surfaceRef: ArtifactRef) => readToolSurface(runtime, surfaceRef),
    validateToolCall: (request) => validateToolCall(runtime, request),
    explainToolInputValidation: (validationRef: ArtifactRef) =>
      materializeJsonArtifact<ToolInputValidation>({
        artifactRegistry: runtime.options.artifactRegistry,
        artifactRef: validationRef,
        reason: "explain tool input validation"
      }),
    executeTool: (request, options: ToolExecutionOptions) => executeTool(runtime, request, options),
    cancelToolExecution: (executionId: ToolExecutionId, reason: string) =>
      cancelToolExecution(runtime, executionId, reason),
    readToolExecutionReceipt: (receiptRef: ArtifactRef) => readToolExecutionReceipt(runtime, receiptRef),
    readToolSettlement: (settlementRef: ArtifactRef) => readToolSettlement(runtime, settlementRef)
  };
}

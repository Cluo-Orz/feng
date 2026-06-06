import { randomUUID } from "node:crypto";
import type { ArtifactRef } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import { registerToolJsonArtifact } from "./artifacts.js";
import { makeToolSettlementId } from "./brand.js";
import { toolRuntimeEventTypes } from "./events.js";
import { executionError } from "./output.js";
import { appendToolEvent, type ToolRuntimeRuntime } from "./runtime.js";
import type {
  JsonValue,
  ToolCallRequest,
  ToolDefinition,
  ToolExecutionError,
  ToolExecutionReceipt,
  ToolInputValidation,
  ToolPolicyCheck,
  ToolSettlement,
  ToolSettlementStatus
} from "./types.js";

export async function finalizeExecution(
  runtime: ToolRuntimeRuntime,
  request: ToolCallRequest,
  definition: ToolDefinition,
  validation: ToolInputValidation,
  policy: ToolPolicyCheck,
  input: {
    readonly executionId: ToolExecutionReceipt["executionId"];
    readonly status: ToolExecutionReceipt["status"];
    readonly startedAt: string;
    readonly resultArtifactRef?: ArtifactRef;
    readonly outputPreview?: string;
    readonly stdoutPreview?: string;
    readonly stderrPreview?: string;
    readonly structuredOutputPreview?: JsonValue;
    readonly sideEffects?: ToolExecutionReceipt["sideEffects"];
    readonly resource?: Omit<ToolExecutionReceipt["resourceUsage"], "durationMs">;
    readonly error?: ToolExecutionError;
  }
): Promise<Result<ToolSettlement>> {
  const completedAt = new Date().toISOString();
  const receiptBase = buildReceipt(request, definition, validation, policy, input, completedAt);
  const receiptRef = await registerToolJsonArtifact({
    artifactRegistry: runtime.options.artifactRegistry,
    kind: "summary",
    content: receiptBase,
    source: request.source,
    version: request.version,
    audit: request.audit,
    privacyClass: receiptBase.redacted ? "redacted" : "workspace_private",
    retentionClass: "attempt_scoped",
    ...(receiptBase.outputArtifactRef === undefined ? {} : { parentRefs: [receiptBase.outputArtifactRef] }),
    ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId })
  });
  if (!receiptRef.ok) return receiptRef;
  const receipt = { ...receiptBase, receiptRef: receiptRef.value };
  const write = await runtime.storage.writeExecutionReceipt(receipt);
  if (!write.ok) return write;
  const event = await appendToolEvent({
    runtime,
    eventType: executionEventType(receipt.status),
    request,
    body: { executionId: receipt.executionId, status: receipt.status, receiptRef: receipt.receiptRef }
  });
  return event.ok ? settleFromReceipt(runtime, request, receipt) : event;
}

export async function settleWithoutExecution(
  runtime: ToolRuntimeRuntime,
  request: ToolCallRequest,
  status: ToolSettlementStatus,
  error: ToolExecutionError
): Promise<Result<ToolSettlement>> {
  return writeSettlement(runtime, request, {
    status,
    resultPreview: "",
    error,
    retryRecommendation: status === "policy_blocked" || status === "validation_failed" ? "do_not_retry" : "retry_after_change",
    nextActionHint: status === "validation_failed" ? "fix tool input before retrying" : "resolve blocker before retrying",
    visibleToModelSummary: error.message
  });
}

export function validationError(validation: ToolInputValidation): ToolExecutionError {
  return executionError(
    "invalid_input",
    validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
    false
  );
}

export function toExecutionError(error: {
  readonly code: string;
  readonly message: string;
  readonly retryable?: boolean;
}): ToolExecutionError {
  return executionError(error.code, error.message, error.retryable ?? false);
}

function buildReceipt(
  request: ToolCallRequest,
  definition: ToolDefinition,
  validation: ToolInputValidation,
  policy: ToolPolicyCheck,
  input: Parameters<typeof finalizeExecution>[5],
  completedAt: string
): ToolExecutionReceipt {
  return {
    executionId: input.executionId,
    toolCallId: request.toolCallId,
    toolRef: definition.toolRef,
    toolVersion: definition.version,
    status: input.status,
    startedAt: input.startedAt,
    completedAt,
    ...(request.attemptRef === undefined ? {} : { attemptRef: request.attemptRef }),
    ...(request.growUnitRef === undefined ? {} : { growUnitRef: request.growUnitRef }),
    ...(request.messageListRef === undefined ? {} : { messageListRef: request.messageListRef }),
    policyDecisionIds: policy.decisions.map((decision) => decision.policyDecisionId),
    ...(validation.validationRef === undefined ? {} : { validationRef: validation.validationRef }),
    ...(validation.inputHash === undefined ? {} : { inputHash: validation.inputHash }),
    ...(input.resultArtifactRef === undefined ? {} : { outputArtifactRef: input.resultArtifactRef }),
    outputPreview: input.outputPreview ?? "",
    ...(input.stdoutPreview === undefined ? {} : { stdoutPreview: input.stdoutPreview }),
    ...(input.stderrPreview === undefined ? {} : { stderrPreview: input.stderrPreview }),
    ...(input.structuredOutputPreview === undefined ? {} : {
      structuredOutputPreview: input.structuredOutputPreview
    }),
    sideEffects: input.sideEffects ?? [],
    resourceUsage: {
      durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(input.startedAt)),
      stdoutBytes: input.resource?.stdoutBytes ?? 0,
      stderrBytes: input.resource?.stderrBytes ?? 0,
      outputBytes: input.resource?.outputBytes ?? 0
    },
    ...(input.error === undefined ? {} : { error: input.error }),
    retryable: input.error?.retryable ?? false,
    redacted: policy.redactionRequired,
    constraints: policy.constraints,
    ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId }),
    source: request.source,
    audit: request.audit
  };
}

function executionEventType(status: ToolExecutionReceipt["status"]) {
  if (status === "succeeded") return toolRuntimeEventTypes.executionCompleted;
  if (status === "cancelled") return toolRuntimeEventTypes.executionCancelled;
  return toolRuntimeEventTypes.executionFailed;
}

async function settleFromReceipt(
  runtime: ToolRuntimeRuntime,
  request: ToolCallRequest,
  receipt: ToolExecutionReceipt
): Promise<Result<ToolSettlement>> {
  return writeSettlement(runtime, request, {
    status: statusFromReceipt(receipt),
    ...(receipt.receiptRef === undefined ? {} : { executionReceiptRef: receipt.receiptRef }),
    ...(receipt.outputArtifactRef === undefined ? {} : { resultArtifactRef: receipt.outputArtifactRef }),
    resultPreview: receipt.outputPreview,
    ...(receipt.error === undefined ? {} : { error: receipt.error }),
    retryRecommendation: receipt.retryable ? "retry_after_change" : "do_not_retry",
    nextActionHint: receipt.status === "succeeded" ? "continue with tool result" : "inspect receipt before retrying",
    visibleToModelSummary: receipt.error === undefined ? receipt.outputPreview : receipt.error.message
  });
}

async function writeSettlement(
  runtime: ToolRuntimeRuntime,
  request: ToolCallRequest,
  input: Omit<ToolSettlement, "settlementId" | "toolCallId" | "toolRef" | "attemptRef" | "source" | "audit" | "settlementRef">
): Promise<Result<ToolSettlement>> {
  const base: ToolSettlement = {
    settlementId: makeToolSettlementId(`tool-settlement-${randomUUID()}`),
    toolCallId: request.toolCallId,
    toolRef: request.toolRef,
    ...(request.attemptRef === undefined ? {} : { attemptRef: request.attemptRef }),
    source: request.source,
    audit: request.audit,
    ...input
  };
  const parents = [base.executionReceiptRef, base.resultArtifactRef].filter((item): item is ArtifactRef => item !== undefined);
  const artifact = await registerToolJsonArtifact({
    artifactRegistry: runtime.options.artifactRegistry,
    kind: "summary",
    content: base,
    source: request.source,
    version: request.version,
    audit: request.audit,
    privacyClass: "workspace_private",
    retentionClass: "attempt_scoped",
    ...(parents.length === 0 ? {} : { parentRefs: parents }),
    ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId })
  });
  if (!artifact.ok) return artifact;
  const settlement = { ...base, settlementRef: artifact.value };
  const write = await runtime.storage.writeSettlement(settlement);
  if (!write.ok) return write;
  const event = await appendToolEvent({
    runtime,
    eventType: toolRuntimeEventTypes.callSettled,
    request,
    body: { settlementId: settlement.settlementId, status: settlement.status, settlementRef: settlement.settlementRef }
  });
  return event.ok ? ok(settlement) : event;
}

function statusFromReceipt(receipt: ToolExecutionReceipt): ToolSettlementStatus {
  if (receipt.status === "succeeded") return "settled_success";
  if (receipt.status === "cancelled") return "cancelled";
  if (receipt.status === "timed_out") return "timed_out";
  return "settled_failure";
}

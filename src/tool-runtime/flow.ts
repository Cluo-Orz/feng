import { randomUUID } from "node:crypto";
import type { ArtifactRef } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import { registerToolJsonArtifact, materializeJsonArtifact } from "./artifacts.js";
import {
  makeToolExecutionId,
  makeToolInputValidationId
} from "./brand.js";
import { toolRuntimeEventTypes } from "./events.js";
import { toolRuntimeErr } from "./errors.js";
import { executable } from "./logic.js";
import { errorFromUnknown, executionError, normalizeToolOutput } from "./output.js";
import { assertPolicyExecutable, evaluateToolPolicy } from "./policy.js";
import { activeCountForTool, appendToolEvent, type ToolRuntimeRuntime } from "./runtime.js";
import {
  finalizeExecution,
  settleWithoutExecution,
  toExecutionError,
  validationError
} from "./settlement.js";
import { validateToolCallInput } from "./validation.js";
import type {
  ToolCallRequest,
  ToolCancellationReceipt,
  ToolDefinition,
  ToolExecutionError,
  ToolExecutionOptions,
  ToolExecutionReceipt,
  ToolImplementation,
  ToolInputValidation,
  ToolPolicyCheck,
  ToolSettlement
} from "./types.js";

export async function validateToolCall(
  runtime: ToolRuntimeRuntime,
  request: ToolCallRequest
): Promise<Result<ToolInputValidation>> {
  const definition = await runtime.storage.readTool(request.toolRef);
  if (!definition.ok) return definition;
  const validation = await validateToolCallInput({
    store: runtime.options.store,
    workspace: runtime.options.workspace,
    artifactRegistry: runtime.options.artifactRegistry,
    request,
    definition: definition.value,
    validationId: makeToolInputValidationId(`tool-validation-${randomUUID()}`),
    maxInlineInputBytes: runtime.options.maxInlineInputBytes ?? 256 * 1024
  });
  if (!validation.ok) return validation;
  const artifact = await registerToolJsonArtifact({
    artifactRegistry: runtime.options.artifactRegistry,
    kind: "summary",
    content: validation.value,
    source: request.source,
    version: request.version,
    audit: request.audit,
    privacyClass: "workspace_private",
    retentionClass: "attempt_scoped",
    ...(request.inputArtifactRef === undefined ? {} : { parentRefs: [request.inputArtifactRef] }),
    ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId })
  });
  if (!artifact.ok) return artifact;
  const recorded = { ...validation.value, validationRef: artifact.value };
  const write = await runtime.storage.writeValidation(recorded);
  if (!write.ok) return write;
  const event = await appendToolEvent({
    runtime,
    eventType: toolRuntimeEventTypes.inputValidated,
    request,
    body: {
      validationId: recorded.validationId,
      validationRef: recorded.validationRef,
      status: recorded.status,
      issueCount: recorded.issues.length
    }
  });
  return event.ok ? ok(recorded) : event;
}

export async function executeTool(
  runtime: ToolRuntimeRuntime,
  request: ToolCallRequest,
  options: ToolExecutionOptions
): Promise<Result<ToolSettlement>> {
  const received = await appendToolEvent({
    runtime,
    eventType: toolRuntimeEventTypes.callReceived,
    request,
    body: { toolCallId: request.toolCallId, toolRef: request.toolRef, requestedBy: request.requestedBy }
  });
  if (!received.ok) return received;
  const definition = await runtime.storage.readTool(request.toolRef);
  if (!definition.ok) return settleWithoutExecution(runtime, request, "unavailable", toExecutionError(definition.error));
  const lifecycle = executable(definition.value);
  if (!lifecycle.ok) return settleWithoutExecution(runtime, request, "unavailable", toExecutionError(lifecycle.error));
  const validation = await validateToolCall(runtime, request);
  if (!validation.ok) return validation;
  if (validation.value.status === "invalid") {
    return settleWithoutExecution(runtime, request, "validation_failed", validationError(validation.value));
  }
  const policy = await evaluateToolPolicy({
    policyBoundary: runtime.options.policyBoundary,
    definition: definition.value,
    request,
    context: options.policyContext
  });
  if (!policy.ok) return policy;
  const policyEvent = await appendToolEvent({
    runtime,
    eventType: toolRuntimeEventTypes.policyChecked,
    request,
    body: {
      toolCallId: request.toolCallId,
      executable: policy.value.executable,
      decisions: policy.value.decisions.map((decision) => ({
        policyDecisionId: decision.policyDecisionId,
        capability: decision.capability,
        verdict: decision.verdict
      }))
    }
  });
  if (!policyEvent.ok) return policyEvent;
  const policyAllowed = assertPolicyExecutable(policy.value);
  if (!policyAllowed.ok) return settleWithoutExecution(runtime, request, "policy_blocked", toExecutionError(policyAllowed.error));
  const implementation = runtime.implementations.get(definition.value.implementation.implementationId);
  if (implementation === undefined || definition.value.implementation.kind === "none") {
    return settleWithoutExecution(runtime, request, "unavailable", executionError("tool_unavailable", "tool implementation is not registered", false));
  }
  const slot = await waitForConcurrencySlot(runtime, definition.value, options.timeoutMs);
  if (!slot.ok) return slot;
  if (slot.value !== undefined) return settleWithoutExecution(runtime, request, "unavailable", slot.value);
  return runImplementation(runtime, request, definition.value, validation.value, policy.value, implementation, options);
}

export async function cancelToolExecution(
  runtime: ToolRuntimeRuntime,
  executionId: ToolExecutionReceipt["executionId"],
  reason: string
): Promise<Result<ToolCancellationReceipt>> {
  const active = runtime.active.get(executionId);
  if (active === undefined) return toolRuntimeErr({ code: "not_found", message: "tool execution is not active" });
  active.controller.abort(new Error(reason));
  await active.implementation?.cancel?.(executionId, reason);
  const event = await appendToolEvent({
    runtime,
    eventType: toolRuntimeEventTypes.executionCancelled,
    request: active.request,
    body: { executionId, toolRef: active.toolRef, reason }
  });
  return event.ok
    ? ok({ executionId, toolRef: active.toolRef, reason, cancelledAt: new Date().toISOString(), eventReceipt: event.value })
    : event;
}

export async function readToolExecutionReceipt(
  runtime: ToolRuntimeRuntime,
  receiptRef: ArtifactRef
): Promise<Result<ToolExecutionReceipt>> {
  return materializeJsonArtifact<ToolExecutionReceipt>({
    artifactRegistry: runtime.options.artifactRegistry,
    artifactRef: receiptRef,
    reason: "read tool execution receipt"
  });
}

export async function readToolSettlement(
  runtime: ToolRuntimeRuntime,
  settlementRef: ArtifactRef
): Promise<Result<ToolSettlement>> {
  return materializeJsonArtifact<ToolSettlement>({
    artifactRegistry: runtime.options.artifactRegistry,
    artifactRef: settlementRef,
    reason: "read tool settlement"
  });
}

async function runImplementation(
  runtime: ToolRuntimeRuntime,
  request: ToolCallRequest,
  definition: ToolDefinition,
  validation: ToolInputValidation,
  policy: ToolPolicyCheck,
  implementation: ToolImplementation,
  options: ToolExecutionOptions
): Promise<Result<ToolSettlement>> {
  const executionId = options.executionId ?? makeToolExecutionId(`tool-execution-${randomUUID()}`);
  const controller = new AbortController();
  const startedAt = new Date().toISOString();
  runtime.active.set(executionId, { executionId, toolRef: definition.toolRef, request, definition, controller, implementation, startedAt });
  const started = await appendToolEvent({
    runtime,
    eventType: toolRuntimeEventTypes.executionStarted,
    request,
    body: { executionId, toolCallId: request.toolCallId, toolRef: definition.toolRef }
  });
  if (!started.ok) return started;
  const timeoutMs = timeoutFor(definition, runtime, options);
  let timedOut = false;
  try {
    const raw = await withTimeout(
      () => implementation.execute({
        request,
        definition,
        input: validation.normalizedInput ?? {},
        policy,
        signal: controller.signal
      }),
      timeoutMs,
      controller,
      () => { timedOut = true; }
    );
    const normalized = normalizeToolOutput({
      raw,
      definition,
      redacted: policy.redactionRequired,
      maxPreviewChars: runtime.options.maxOutputPreviewChars ?? 2_000
    });
    if (!normalized.ok) {
      return finalizeExecution(runtime, request, definition, validation, policy, {
        executionId,
        status: "failed",
        startedAt,
        error: toExecutionError(normalized.error)
      });
    }
    const resultArtifact = await registerToolJsonArtifact({
      artifactRegistry: runtime.options.artifactRegistry,
      kind: "tool_result",
      content: normalized.value.document,
      source: request.source,
      version: request.version,
      audit: request.audit,
      privacyClass: policy.redactionRequired ? "redacted" : definition.privacyClass,
      retentionClass: "attempt_scoped",
      ...(validation.validationRef === undefined ? {} : { parentRefs: [validation.validationRef] }),
      ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId })
    });
    if (!resultArtifact.ok) return resultArtifact;
    const event = await appendToolEvent({
      runtime,
      eventType: toolRuntimeEventTypes.resultRegistered,
      request,
      body: { executionId, resultArtifactRef: resultArtifact.value, bytes: normalized.value.outputBytes }
    });
    if (!event.ok) return event;
    return finalizeExecution(runtime, request, definition, validation, policy, {
      executionId,
      status: "succeeded",
      startedAt,
      resultArtifactRef: resultArtifact.value,
      outputPreview: normalized.value.outputPreview,
      ...(normalized.value.stdoutPreview === undefined ? {} : { stdoutPreview: normalized.value.stdoutPreview }),
      ...(normalized.value.stderrPreview === undefined ? {} : { stderrPreview: normalized.value.stderrPreview }),
      ...(normalized.value.structuredOutputPreview === undefined ? {} : {
        structuredOutputPreview: normalized.value.structuredOutputPreview
      }),
      sideEffects: normalized.value.sideEffects,
      resource: {
        stdoutBytes: normalized.value.stdoutBytes,
        stderrBytes: normalized.value.stderrBytes,
        outputBytes: normalized.value.outputBytes
      }
    });
  } catch (cause) {
    const status = timedOut ? "timed_out" : controller.signal.aborted ? "cancelled" : "failed";
    const error = timedOut
      ? executionError("timeout", `tool execution timed out after ${timeoutMs}ms`, true)
      : controller.signal.aborted
        ? executionError("cancelled", "tool execution was cancelled", true)
        : errorFromUnknown(cause);
    return finalizeExecution(runtime, request, definition, validation, policy, { executionId, status, startedAt, error });
  } finally {
    runtime.active.delete(executionId);
  }
}

async function waitForConcurrencySlot(
  runtime: ToolRuntimeRuntime,
  definition: ToolDefinition,
  timeoutMs: number | undefined
): Promise<Result<ToolExecutionError | undefined>> {
  const max = Math.max(1, definition.concurrency.maxConcurrentPerTool);
  if (activeCountForTool(runtime, definition.toolRef) < max) return ok(undefined);
  if (!definition.concurrency.queueWhenBusy) {
    return ok(executionError("tool_unavailable", "tool concurrency limit is reached", true));
  }
  const deadline = Date.now() + Math.min(timeoutMs ?? definition.timeout.defaultMs, definition.timeout.maxMs);
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))));
    if (Date.now() >= deadline) break;
    if (activeCountForTool(runtime, definition.toolRef) < max) return ok(undefined);
  }
  return ok(executionError("timeout", "timed out waiting for tool concurrency slot", true));
}

async function withTimeout<T>(
  action: () => Promise<T> | T,
  timeoutMs: number,
  controller: AbortController,
  markTimedOut: () => void
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      markTimedOut();
      controller.abort(new Error("tool execution timed out"));
      reject(new Error("tool execution timed out"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(action), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function timeoutFor(definition: ToolDefinition, runtime: ToolRuntimeRuntime, options: ToolExecutionOptions): number {
  const requested = options.timeoutMs ?? definition.timeout.defaultMs ?? runtime.options.defaultTimeoutMs ?? 30_000;
  return Math.min(requested, definition.timeout.maxMs);
}

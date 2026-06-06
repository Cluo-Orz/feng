import { randomUUID } from "node:crypto";
import { makePolicyRequestId } from "../policy-boundary/index.js";
import { makeLLMRequestId } from "../llm-gateway/index.js";
import type {
  LLMContentBlock,
  LLMUsage,
  NormalizedLLMResponse,
  NormalizedStreamEvent,
  ToolCallBlock
} from "../llm-gateway/index.js";
import { ok, type Result } from "../domain/result.js";
import { addPolicyDecisionToPlan } from "./plan.js";
import { attemptErr } from "./errors.js";
import { appendAttemptEvent, attemptEventTypes, mutateAttempt, type AttemptRuntime } from "./runtime.js";
import type {
  AttemptExecutionPlan,
  AttemptPreparedInputs,
  AttemptRecord,
  AttemptTurnRecord,
  LLMCallResult,
  RunAttemptOptions
} from "./types.js";

const zeroUsage: LLMUsage = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0
};

export async function callLLMForTurn(input: {
  readonly runtime: AttemptRuntime;
  readonly record: AttemptRecord;
  readonly turn: AttemptTurnRecord;
  readonly plan: AttemptExecutionPlan;
  readonly prepared: AttemptPreparedInputs;
  readonly options: RunAttemptOptions;
}): Promise<Result<{
  readonly record: AttemptRecord;
  readonly turn: AttemptTurnRecord;
  readonly plan: AttemptExecutionPlan;
  readonly call: LLMCallResult;
}>> {
  const policy = await evaluateLLMPolicy(input);
  if (!policy.ok) return policy;
  const plan = await addPolicyDecisionToPlan(input.runtime, input.plan, policy.value.policyDecisionId);
  if (!plan.ok) return plan;
  const requestId = makeLLMRequestId(`llm-request-${randomUUID()}`);
  const request = {
    requestId,
    messageListRef: input.turn.messageListRef,
    modelSelection: plan.value.modelSelection,
    requiredCapabilities: plan.value.requiredCapabilities,
    toolSurfaceSummary: plan.value.toolUsePolicy.mode === "disable_model_tool_calls"
      ? []
      : input.prepared.contextToolSurface,
    streaming: plan.value.streamingPreference === "preferred",
    ...(plan.value.timeoutPolicy.turnTimeoutMs === undefined ? {} : {
      timeoutMs: plan.value.timeoutPolicy.turnTimeoutMs
    }),
    retryPolicy: { maxAttempts: 1 },
    policyDecisionId: policy.value.policyDecisionId,
    ...(input.record.correlationId === undefined ? {} : { correlationId: input.record.correlationId }),
    source: input.options.source ?? input.record.source,
    version: input.options.version ?? input.record.version,
    audit: input.options.audit ?? input.record.audit
  };
  let record: AttemptRecord = mutateAttempt(input.record, {
    status: "running",
    llmRequestRefs: [...input.record.llmRequestRefs, requestId]
  });
  let turn: AttemptTurnRecord = { ...input.turn, llmRequestRef: requestId, status: "calling_llm" };
  const turnWrite = await input.runtime.storage.writeTurn(turn);
  if (!turnWrite.ok) return turnWrite;
  const recordWrite = await input.runtime.storage.writeAttempt(record, "record llm request");
  if (!recordWrite.ok) return recordWrite;
  const started = await appendAttemptEvent({
    runtime: input.runtime,
    record,
    eventType: attemptEventTypes.llmCallStarted,
    body: { requestId, messageListRef: input.turn.messageListRef, policyDecisionId: policy.value.policyDecisionId }
  });
  if (!started.ok) return started;
  const response = request.streaming
    ? await callStreaming(input.runtime, request)
    : await callNonStreaming(input.runtime, request);
  if (!response.ok) {
    await appendAttemptEvent({
      runtime: input.runtime,
      record,
      eventType: attemptEventTypes.llmCallFailed,
      body: { requestId, code: response.error.code, message: response.error.message, evidenceRef: response.error.evidenceRef }
    });
    return response;
  }
  const providerReceiptRefs = response.value.response.receiptRef === undefined
    ? record.providerReceiptRefs
    : [...record.providerReceiptRefs, response.value.response.receiptRef];
  record = mutateAttempt(record, { providerReceiptRefs });
  turn = {
    ...turn,
    ...(response.value.response.receiptRef === undefined ? {} : {
      providerReceiptRef: response.value.response.receiptRef
    }),
    status: "completed",
    completedAt: new Date().toISOString()
  };
  const turnDone = await input.runtime.storage.writeTurn(turn);
  if (!turnDone.ok) return turnDone;
  const recordDone = await input.runtime.storage.writeAttempt(record, "record llm response");
  if (!recordDone.ok) return recordDone;
  const completed = await appendAttemptEvent({
    runtime: input.runtime,
    record,
    eventType: attemptEventTypes.llmCallCompleted,
    body: {
      requestId,
      providerReceiptRef: response.value.response.receiptRef,
      finishReason: response.value.response.finishReason,
      toolCallCount: response.value.response.toolCallBlocks.length
    }
  });
  return completed.ok ? ok({ record, turn, plan: plan.value, call: response.value }) : completed;
}

async function evaluateLLMPolicy(input: Parameters<typeof callLLMForTurn>[0]) {
  const decision = await input.runtime.options.policyBoundary.evaluateAction({
    requestId: makePolicyRequestId(`attempt-llm-policy-${randomUUID()}`),
    capability: "external_service.call",
    requestedByModule: "grow-attempt-runner",
    workspace: input.runtime.options.workspace.id,
    growUnit: input.record.growUnitRef.id,
    attempt: input.record.attemptId,
    resourceSummary: `${input.plan.modelSelection.provider}/${input.plan.modelSelection.model}`,
    operation: "llm-call",
    reason: `run attempt turn ${input.turn.turnIndex}`,
    source: input.options.source ?? input.record.source,
    ...(input.record.correlationId === undefined ? {} : { correlationId: input.record.correlationId })
  }, input.options.policyContext);
  if (!decision.ok) return decision;
  if (decision.value.verdict === "ask") {
    return attemptErr({ code: "approval_required", message: "LLM provider call requires approval" });
  }
  if (!["allow", "allow_with_constraints", "allow_with_redaction"].includes(decision.value.verdict)) {
    return attemptErr({ code: "policy_blocked", message: `LLM provider policy verdict is ${decision.value.verdict}` });
  }
  return ok(decision.value);
}

async function callNonStreaming(
  runtime: AttemptRuntime,
  request: Parameters<AttemptRuntime["options"]["llmGateway"]["sendLLMRequest"]>[0]
): Promise<Result<LLMCallResult>> {
  const response = await runtime.options.llmGateway.sendLLMRequest(request);
  return response.ok ? ok({ requestId: request.requestId, response: response.value, streamEvents: [] }) : response;
}

async function callStreaming(
  runtime: AttemptRuntime,
  request: Parameters<AttemptRuntime["options"]["llmGateway"]["sendLLMRequest"]>[0]
): Promise<Result<LLMCallResult>> {
  const streamEvents: NormalizedStreamEvent[] = [];
  for await (const item of runtime.options.llmGateway.streamLLMRequest(request)) {
    if (!item.ok) return item;
    streamEvents.push(item.value);
    if (item.value.type === "response_failed") {
      return attemptErr({
        code: item.value.errorClassification.code === "stream_interrupted" ? "stream_interrupted" : "llm_failed",
        message: item.value.errorClassification.message,
        retryable: item.value.errorClassification.retryable,
        ...(item.value.receiptRef === undefined ? {} : { evidenceRef: item.value.receiptRef })
      });
    }
  }
  const response = responseFromStream(request, streamEvents);
  return ok({ requestId: request.requestId, response, streamEvents });
}

function responseFromStream(
  request: Parameters<AttemptRuntime["options"]["llmGateway"]["sendLLMRequest"]>[0],
  events: readonly NormalizedStreamEvent[]
): NormalizedLLMResponse {
  const text = events.filter((event): event is Extract<NormalizedStreamEvent, { type: "text_delta" }> => event.type === "text_delta")
    .map((event) => event.text).join("");
  const reasoning = events.filter((event): event is Extract<NormalizedStreamEvent, { type: "reasoning_delta" }> => event.type === "reasoning_delta")
    .map((event) => event.text).join("");
  const toolCalls = events
    .filter((event): event is Extract<NormalizedStreamEvent, { type: "tool_call_completed" }> => event.type === "tool_call_completed")
    .map((event) => event.toolCall);
  const completed = events.find((event): event is Extract<NormalizedStreamEvent, { type: "response_completed" }> =>
    event.type === "response_completed"
  );
  const contentBlocks: LLMContentBlock[] = [];
  if (text.length > 0) contentBlocks.push({ type: "text", text });
  if (reasoning.length > 0) contentBlocks.push({ type: "reasoning_summary", text: reasoning });
  contentBlocks.push(...toolCalls);
  return {
    requestId: request.requestId,
    provider: request.modelSelection.provider,
    model: request.modelSelection.model,
    contentBlocks: contentBlocks.length === 0 ? [{ type: "unknown", rawSummary: "stream completed without visible content" }] : contentBlocks,
    toolCallBlocks: toolCalls as readonly ToolCallBlock[],
    usage: completed?.usage ?? zeroUsage,
    finishReason: completed?.finishReason ?? "unknown",
    providerMetadataSummary: { streamEventCount: events.length },
    ...(completed?.receiptRef === undefined ? {} : { receiptRef: completed.receiptRef }),
    source: request.source,
    audit: request.audit
  };
}

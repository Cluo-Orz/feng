import { ok, type Result } from "../domain/result.js";
import { llmGatewayEventTypes } from "./events.js";
import { llmGatewayErr } from "./errors.js";
import { buildProviderRequestEnvelope } from "./request-builder.js";
import { appendLLMEvent, adapterFor, type LLMGatewayRuntime } from "./runtime.js";
import { verifyProviderPolicy } from "./policy.js";
import { registerProviderCallReceipt } from "./receipt.js";
import { classifyProviderError, normalizeStreamEvent, zeroUsage } from "./normalization.js";
import type {
  LLMContentBlock,
  LLMErrorClassification,
  LLMFinishReason,
  LLMRequest,
  LLMUsage,
  NormalizedStreamEvent,
  ProviderAdapterContext,
  ToolCallBlock
} from "./types.js";

interface StreamState {
  sequence: number;
  text: string;
  reasoning: string;
  usage: LLMUsage;
  finishReason: LLMFinishReason;
  readonly toolCalls: Map<string, ToolCallBlock>;
}

export async function* streamLLMRequest(
  runtime: LLMGatewayRuntime,
  request: LLMRequest
): AsyncIterable<Result<NormalizedStreamEvent>> {
  const policy = await verifyProviderPolicy(runtime, request);
  if (!policy.ok) {
    yield policy;
    return;
  }
  const prepared = await prepare(runtime, { ...request, streaming: true });
  if (!prepared.ok) {
    yield prepared;
    return;
  }
  const startedAt = new Date().toISOString();
  const started = await appendLLMEvent({
    runtime,
    eventType: llmGatewayEventTypes.requestStarted,
    body: {
      requestId: request.requestId,
      provider: request.modelSelection.provider,
      model: request.modelSelection.model,
      messageCount: prepared.value.context.providerRequest.summary.messageCount,
      streaming: true
    },
    source: request.source,
    audit: request.audit,
    ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId })
  });
  if (!started.ok) {
    yield started;
    return;
  }
  const state: StreamState = {
    sequence: 0,
    text: "",
    reasoning: "",
    usage: zeroUsage,
    finishReason: "unknown",
    toolCalls: new Map()
  };
  try {
    const stream = prepared.value.adapter.stream?.(prepared.value.context);
    if (stream === undefined) throw new Error("provider adapter does not implement stream");
    let heldCompletion: NormalizedStreamEvent | undefined;
    for await (const raw of stream) {
      state.sequence += 1;
      const normalized = await normalizeWithAdapter(prepared.value.adapter, prepared.value.context, raw, state.sequence);
      if (!normalized.ok) throw normalized.error;
      absorb(state, normalized.value);
      if (normalized.value.type === "response_completed") {
        heldCompletion = normalized.value;
        continue;
      }
      const event = await appendStreamEvent(runtime, request, normalized.value);
      if (!event.ok) {
        yield event;
        return;
      }
      yield ok(normalized.value);
    }
    const completion = await completeStream(runtime, request, prepared.value.context, state, startedAt, heldCompletion);
    yield completion;
  } catch (error) {
    const classified = classifyWithAdapter(prepared.value.adapter, prepared.value.context, error);
    const failed = await failStream(runtime, request, prepared.value.context, state, startedAt, classified);
    yield ok(failed);
  }
}

async function prepare(runtime: LLMGatewayRuntime, request: LLMRequest) {
  const envelope = await buildProviderRequestEnvelope(runtime, request);
  if (!envelope.ok) return envelope;
  const adapter = adapterFor(runtime, request.modelSelection.provider);
  if (!adapter.ok) return adapter;
  return ok({ adapter: adapter.value, context: { request, providerRequest: envelope.value } });
}

async function completeStream(
  runtime: LLMGatewayRuntime,
  request: LLMRequest,
  context: ProviderAdapterContext,
  state: StreamState,
  startedAt: string,
  heldCompletion: NormalizedStreamEvent | undefined
): Promise<Result<NormalizedStreamEvent>> {
  const receipt = await registerProviderCallReceipt(runtime, {
    request,
    provider: request.modelSelection.provider,
    model: request.modelSelection.model,
    startedAt,
    completedAt: new Date().toISOString(),
    retryCount: 0,
    retryReasons: [],
    fallbackTrail: [],
    usage: state.usage,
    finishReason: state.finishReason,
    contentForHash: contentBlocks(state),
    parentRefs: context.providerRequest.parentArtifactRefs
  });
  if (!receipt.ok) return receipt;
  const completion = {
    ...baseEvent(request, state.sequence + 1),
    type: "response_completed" as const,
    usage: state.usage,
    finishReason: state.finishReason,
    receiptRef: receipt.value.receiptRef
  };
  const normalized = heldCompletion?.type === "response_completed"
    ? { ...heldCompletion, receiptRef: receipt.value.receiptRef }
    : completion;
  const event = await appendStreamEvent(runtime, request, normalized);
  if (!event.ok) return event;
  const completed = await appendLLMEvent({
    runtime,
    eventType: llmGatewayEventTypes.responseCompleted,
    body: {
      requestId: request.requestId,
      provider: request.modelSelection.provider,
      model: request.modelSelection.model,
      finishReason: normalized.finishReason,
      receiptRef: receipt.value.receiptRef
    },
    source: request.source,
    audit: request.audit,
    ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId })
  });
  return completed.ok ? ok(normalized) : completed;
}

async function failStream(
  runtime: LLMGatewayRuntime,
  request: LLMRequest,
  context: ProviderAdapterContext,
  state: StreamState,
  startedAt: string,
  failure: LLMErrorClassification
): Promise<NormalizedStreamEvent> {
  const receipt = await registerProviderCallReceipt(runtime, {
    request,
    provider: request.modelSelection.provider,
    model: request.modelSelection.model,
    startedAt,
    completedAt: new Date().toISOString(),
    retryCount: 0,
    retryReasons: [],
    fallbackTrail: [],
    errorClassification: { ...failure, code: failure.code === "unknown_provider_error" ? "stream_interrupted" : failure.code },
    contentForHash: { failure, partial: contentBlocks(state) },
    parentRefs: context.providerRequest.parentArtifactRefs
  });
  const failed = {
    ...baseEvent(request, state.sequence + 1),
    type: "response_failed" as const,
    errorClassification: { ...failure, code: failure.code === "unknown_provider_error" ? "stream_interrupted" as const : failure.code },
    ...(receipt.ok ? { receiptRef: receipt.value.receiptRef } : {})
  };
  await appendStreamEvent(runtime, request, failed);
  await appendLLMEvent({
    runtime,
    eventType: llmGatewayEventTypes.requestFailed,
    body: { requestId: request.requestId, provider: request.modelSelection.provider, model: request.modelSelection.model, error: failed.errorClassification },
    source: request.source,
    audit: request.audit,
    ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId })
  });
  return failed;
}

async function normalizeWithAdapter(
  adapter: { readonly normalizeStreamEvent?: NonNullable<import("./types.js").LLMProviderAdapter["normalizeStreamEvent"]> },
  context: ProviderAdapterContext,
  raw: unknown,
  sequence: number
) {
  if (adapter.normalizeStreamEvent !== undefined) {
    try {
      return ok(await adapter.normalizeStreamEvent(raw, context, sequence));
    } catch (cause) {
      return llmGatewayErr({ code: "response_invalid", message: "provider adapter stream normalization failed", cause });
    }
  }
  return normalizeStreamEvent(raw, context, sequence);
}

function classifyWithAdapter(
  adapter: { readonly normalizeError?: NonNullable<import("./types.js").LLMProviderAdapter["normalizeError"]> },
  context: ProviderAdapterContext,
  error: unknown
): LLMErrorClassification {
  if (adapter.normalizeError !== undefined) return adapter.normalizeError(error, context);
  return classifyProviderError(error, context.request);
}

async function appendStreamEvent(runtime: LLMGatewayRuntime, request: LLMRequest, event: NormalizedStreamEvent) {
  return appendLLMEvent({
    runtime,
    eventType: llmGatewayEventTypes.streamEventNormalized,
    body: { requestId: request.requestId, type: event.type, sequence: event.sequence },
    source: request.source,
    audit: request.audit,
    ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId })
  });
}

function absorb(state: StreamState, event: NormalizedStreamEvent): void {
  if (event.type === "text_delta") state.text += event.text;
  if (event.type === "reasoning_delta") state.reasoning += event.text;
  if (event.type === "usage_delta") state.usage = { ...state.usage, ...event.usage };
  if (event.type === "tool_call_completed") state.toolCalls.set(event.toolCall.callId, event.toolCall);
  if (event.type === "response_completed") {
    state.usage = event.usage;
    state.finishReason = event.finishReason;
  }
}

function contentBlocks(state: StreamState): readonly LLMContentBlock[] {
  const blocks: LLMContentBlock[] = [];
  if (state.text.length > 0) blocks.push({ type: "text", text: state.text });
  if (state.reasoning.length > 0) blocks.push({ type: "reasoning_summary", text: state.reasoning });
  blocks.push(...state.toolCalls.values());
  return blocks;
}

function baseEvent(request: LLMRequest, sequence: number) {
  return {
    requestId: request.requestId,
    provider: request.modelSelection.provider,
    model: request.modelSelection.model,
    sequence,
    source: request.source,
    audit: request.audit
  };
}

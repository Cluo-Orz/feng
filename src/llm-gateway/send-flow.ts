import { ok, type Result } from "../domain/result.js";
import { llmGatewayEventTypes } from "./events.js";
import { llmGatewayErr } from "./errors.js";
import { buildProviderRequestEnvelope } from "./request-builder.js";
import { appendLLMEvent, adapterFor, type LLMGatewayRuntime } from "./runtime.js";
import { verifyProviderPolicy } from "./policy.js";
import { attachReceipt, failedResultWithReceipt, registerProviderCallReceipt } from "./receipt.js";
import { classifyProviderError, normalizeResponse } from "./normalization.js";
import type {
  LLMErrorClassification,
  LLMModelSelection,
  LLMRequest,
  NormalizedLLMResponse,
  ProviderAdapterContext,
  ProviderFallbackRecord,
  ProviderRequestEnvelope
} from "./types.js";

interface FlowState {
  readonly retryCount: number;
  readonly retryReasons: readonly LLMErrorClassification["code"][];
  readonly fallbackTrail: readonly ProviderFallbackRecord[];
  readonly fallbackIndex: number;
}

export async function sendLLMRequest(
  runtime: LLMGatewayRuntime,
  request: LLMRequest
): Promise<Result<NormalizedLLMResponse>> {
  const policy = await verifyProviderPolicy(runtime, request);
  if (!policy.ok) return policy;
  let current = request;
  let state: FlowState = { retryCount: 0, retryReasons: [], fallbackTrail: [], fallbackIndex: 0 };
  let lastFailure: LLMErrorClassification | undefined;
  let startedAt = new Date().toISOString();
  let lastEnvelope: ProviderRequestEnvelope | undefined;
  while (true) {
    const prepared = await prepare(runtime, current);
    if (!prepared.ok) return prepared;
    lastEnvelope = prepared.value.envelope;
    startedAt = new Date().toISOString();
    const started = await appendStarted(runtime, current, prepared.value.envelope);
    if (!started.ok) return started;
    try {
      const raw = await prepared.value.adapter.send?.(prepared.value.context);
      if (raw === undefined) throw new Error("provider adapter does not implement send");
      const normalized = await normalizeWithAdapter(prepared.value.adapter, prepared.value.context, raw);
      if (!normalized.ok) throw normalized.error;
      const completedAt = new Date().toISOString();
      const receipt = await registerProviderCallReceipt(runtime, {
        request: current,
        provider: current.modelSelection.provider,
        model: current.modelSelection.model,
        startedAt,
        completedAt,
        retryCount: state.retryCount,
        retryReasons: state.retryReasons,
        fallbackTrail: state.fallbackTrail,
        usage: normalized.value.usage,
        finishReason: normalized.value.finishReason,
        contentForHash: normalized.value,
        parentRefs: prepared.value.envelope.parentArtifactRefs
      });
      if (!receipt.ok) return receipt;
      const response = attachReceipt(normalized.value, receipt.value.receiptRef);
      const completed = await appendCompleted(runtime, current, response);
      return completed.ok ? ok(response) : completed;
    } catch (error) {
      lastFailure = classifyWithAdapter(prepared.value.adapter, prepared.value.context, error);
      const failed = await appendFailed(runtime, current, lastFailure);
      if (!failed.ok) return failed;
      const next = await nextRequest(runtime, current, state, lastFailure);
      if (!next.ok) return next;
      if (next.value === undefined) break;
      current = next.value.request;
      state = next.value.state;
    }
  }
  return failedResultWithReceipt(runtime, {
    request: current,
    provider: current.modelSelection.provider,
    model: current.modelSelection.model,
    startedAt,
    completedAt: new Date().toISOString(),
    retryCount: state.retryCount,
    retryReasons: state.retryReasons,
    fallbackTrail: state.fallbackTrail,
    errorClassification: lastFailure,
    contentForHash: lastFailure ?? "llm request failed",
    parentRefs: lastEnvelope?.parentArtifactRefs ?? []
  });
}

async function prepare(runtime: LLMGatewayRuntime, request: LLMRequest) {
  const envelope = await buildProviderRequestEnvelope(runtime, request);
  if (!envelope.ok) return envelope;
  const adapter = adapterFor(runtime, request.modelSelection.provider);
  if (!adapter.ok) return adapter;
  return ok({
    envelope: envelope.value,
    adapter: adapter.value,
    context: { request, providerRequest: envelope.value }
  });
}

async function normalizeWithAdapter(
  adapter: { readonly normalizeResponse?: NonNullable<import("./types.js").LLMProviderAdapter["normalizeResponse"]> },
  context: ProviderAdapterContext,
  raw: unknown
) {
  if (context.providerRequest.summary.provider !== context.request.modelSelection.provider) {
    return llmGatewayErr({ code: "response_invalid", message: "provider request summary mismatches request" });
  }
  if (adapter.normalizeResponse !== undefined) {
    try {
      return ok(await adapter.normalizeResponse(raw, context));
    } catch (cause) {
      return llmGatewayErr({ code: "response_invalid", message: "provider adapter response normalization failed", cause });
    }
  }
  return normalizeResponse(raw, context);
}

function classifyWithAdapter(
  adapter: { readonly normalizeError?: NonNullable<import("./types.js").LLMProviderAdapter["normalizeError"]> },
  context: ProviderAdapterContext,
  error: unknown
): LLMErrorClassification {
  if (adapter.normalizeError !== undefined) return adapter.normalizeError(error, context);
  return classifyProviderError(error, context.request);
}

async function nextRequest(
  runtime: LLMGatewayRuntime,
  request: LLMRequest,
  state: FlowState,
  failure: LLMErrorClassification
): Promise<Result<{ readonly request: LLMRequest; readonly state: FlowState } | undefined>> {
  if (shouldRetry(request, state, failure)) {
    const nextState = {
      ...state,
      retryCount: state.retryCount + 1,
      retryReasons: [...state.retryReasons, failure.code]
    };
    const event = await appendLLMEvent({
      runtime,
      eventType: llmGatewayEventTypes.retryPerformed,
      body: { requestId: request.requestId, provider: request.modelSelection.provider, model: request.modelSelection.model, reason: failure.code },
      source: request.source,
      audit: request.audit,
      ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId })
    });
    return event.ok ? ok({ request, state: nextState }) : event;
  }
  const fallback = nextFallback(request, state, failure);
  if (fallback === undefined) return ok(undefined);
  const trail = [...state.fallbackTrail, {
    from: request.modelSelection,
    to: fallback,
    reason: failure.code,
    at: new Date().toISOString()
  }];
  const event = await appendLLMEvent({
    runtime,
    eventType: llmGatewayEventTypes.fallbackPerformed,
    body: { requestId: request.requestId, from: request.modelSelection, to: fallback, reason: failure.code },
    source: request.source,
    audit: request.audit,
    ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId })
  });
  return event.ok ? ok({
    request: { ...request, modelSelection: fallback },
    state: { retryCount: state.retryCount, retryReasons: state.retryReasons, fallbackTrail: trail, fallbackIndex: state.fallbackIndex + 1 }
  }) : event;
}

function shouldRetry(request: LLMRequest, state: FlowState, failure: LLMErrorClassification): boolean {
  const policy = request.retryPolicy;
  if (policy === undefined || !failure.retryable) return false;
  const maxAttempts = Math.max(1, policy.maxAttempts);
  if (state.retryCount + 1 >= maxAttempts) return false;
  return policy.retryOn === undefined || policy.retryOn.includes(failure.code);
}

function nextFallback(
  request: LLMRequest,
  state: FlowState,
  failure: LLMErrorClassification
): LLMModelSelection | undefined {
  const policy = request.fallbackPolicy;
  if (policy === undefined) return undefined;
  const allowed = policy.onErrorCodes === undefined
    ? failure.fallbackRecommended
    : policy.onErrorCodes.includes(failure.code);
  return allowed ? policy.fallbacks[state.fallbackIndex] : undefined;
}

async function appendStarted(runtime: LLMGatewayRuntime, request: LLMRequest, envelope: ProviderRequestEnvelope) {
  return appendLLMEvent({
    runtime,
    eventType: llmGatewayEventTypes.requestStarted,
    body: {
      requestId: request.requestId,
      provider: request.modelSelection.provider,
      model: request.modelSelection.model,
      messageCount: envelope.summary.messageCount,
      streaming: false
    },
    source: request.source,
    audit: request.audit,
    ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId })
  });
}

async function appendCompleted(runtime: LLMGatewayRuntime, request: LLMRequest, response: NormalizedLLMResponse) {
  return appendLLMEvent({
    runtime,
    eventType: llmGatewayEventTypes.responseCompleted,
    body: {
      requestId: request.requestId,
      provider: response.provider,
      model: response.model,
      finishReason: response.finishReason,
      receiptRef: response.receiptRef
    },
    source: request.source,
    audit: request.audit,
    ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId })
  });
}

async function appendFailed(runtime: LLMGatewayRuntime, request: LLMRequest, failure: LLMErrorClassification) {
  return appendLLMEvent({
    runtime,
    eventType: llmGatewayEventTypes.requestFailed,
    body: {
      requestId: request.requestId,
      provider: request.modelSelection.provider,
      model: request.modelSelection.model,
      error: failure
    },
    source: request.source,
    audit: request.audit,
    ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId })
  });
}

import { ok, type Result } from "../domain/result.js";
import { stableStringify } from "../event-ledger/stable-json.js";
import { checkModelCapabilities, unsupportedRequirements } from "./capabilities.js";
import { llmGatewayErr } from "./errors.js";
import { resolveProviderMessages } from "./message-list.js";
import { adapterFor, type LLMGatewayRuntime } from "./runtime.js";
import type {
  LLMRequest,
  ProviderRequestEnvelope,
  ProviderRequestSummary
} from "./types.js";

export async function buildProviderRequestEnvelope(
  runtime: LLMGatewayRuntime,
  request: LLMRequest
): Promise<Result<ProviderRequestEnvelope>> {
  const adapter = adapterFor(runtime, request.modelSelection.provider);
  if (!adapter.ok) return adapter;
  const messages = await resolveProviderMessages(runtime, request);
  if (!messages.ok) return messages;
  const requiredCapabilities = {
    ...(request.requiredCapabilities ?? {}),
    ...(request.streaming ? { streaming: true } : {})
  };
  const capability = await checkModelCapabilities(runtime, {
    modelSelection: request.modelSelection,
    requiredCapabilities
  });
  if (!capability.ok) return capability;
  const unsupported = unsupportedRequirements(capability.value.capabilitySummary, requiredCapabilities);
  if (unsupported.length > 0) {
    return llmGatewayErr({
      code: "model_capability_unsupported",
      message: `model ${request.modelSelection.provider}/${request.modelSelection.model} lacks ${unsupported.join(", ")}`,
      retryable: false
    });
  }
  const tools = request.toolSurfaceSummary ?? [];
  const built = await buildPayload(adapter.value, request, messages.value.messages, tools);
  if (!built.ok) return built;
  const summary = requestSummary(request, messages.value.messages, tools.length, requiredCapabilities, built.value);
  return ok({
    summary,
    payload: built.value.payload,
    providerNeutralMessages: messages.value.messages,
    parentArtifactRefs: messages.value.parentArtifactRefs
  });
}

export async function buildProviderRequestSummary(
  runtime: LLMGatewayRuntime,
  request: LLMRequest
): Promise<Result<ProviderRequestSummary>> {
  const envelope = await buildProviderRequestEnvelope(runtime, request);
  return envelope.ok ? ok(envelope.value.summary) : envelope;
}

async function buildPayload(
  adapter: { readonly buildProviderRequest?: NonNullable<import("./types.js").LLMProviderAdapter["buildProviderRequest"]> },
  request: LLMRequest,
  messages: ProviderRequestEnvelope["providerNeutralMessages"],
  tools: NonNullable<LLMRequest["toolSurfaceSummary"]>
) {
  try {
    if (adapter.buildProviderRequest !== undefined) {
      return ok(await adapter.buildProviderRequest({ request, messages, tools }));
    }
    return ok({
      payload: {
        provider: request.modelSelection.provider,
        model: request.modelSelection.model,
        messages,
        tools: tools.map((tool) => ({
          id: tool.toolId,
          name: tool.name,
          description: tool.capabilitySummary,
          safeForModel: tool.safeForModel
        })),
        stream: request.streaming,
        timeoutMs: request.timeoutMs
      },
      requestShape: "provider-neutral-json",
      preview: "provider-neutral message request"
    });
  } catch (cause) {
    return llmGatewayErr({ code: "request_invalid", message: "provider request build failed", cause });
  }
}

function requestSummary(
  request: LLMRequest,
  messages: ProviderRequestEnvelope["providerNeutralMessages"],
  toolSurfaceCount: number,
  requiredCapabilities: NonNullable<LLMRequest["requiredCapabilities"]>,
  built: { readonly payload: unknown; readonly requestShape?: string; readonly preview?: string }
): ProviderRequestSummary {
  return {
    requestId: request.requestId,
    provider: request.modelSelection.provider,
    model: request.modelSelection.model,
    ...(request.modelSelection.modelVersion === undefined ? {} : { modelVersion: request.modelSelection.modelVersion }),
    ...(request.messageListRef === undefined ? {} : { messageListRef: request.messageListRef }),
    messageCount: messages.length,
    toolSurfaceCount,
    streaming: request.streaming,
    estimatedInputTokens: estimateMessages(messages),
    requiredCapabilities,
    requestShape: built.requestShape ?? shapeOf(built.payload),
    providerRequestPreview: sanitizePreview(built.preview ?? stableStringify(built.payload)),
    policyDecisionId: request.policyDecisionId,
    builtAt: new Date().toISOString()
  };
}

function estimateMessages(messages: ProviderRequestEnvelope["providerNeutralMessages"]): number {
  const chars = messages.reduce((sum, message) => {
    return sum + message.content.reduce((inner, part) => inner + part.text.length, 0);
  }, 0);
  return Math.ceil(chars / 4);
}

function sanitizePreview(value: string): string {
  return value.replace(/[A-Za-z0-9_\-]{32,}/g, "[redacted-token]").slice(0, 800);
}

function shapeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? `object:${Object.keys(value as Record<string, unknown>).sort().join(",")}` : typeof value;
}

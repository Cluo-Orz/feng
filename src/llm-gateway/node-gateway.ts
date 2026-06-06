import { ok, type Result } from "../domain/result.js";
import { buildProviderRequestEnvelope, buildProviderRequestSummary } from "./request-builder.js";
import { checkModelCapabilities, getModelCapabilities, listProviders } from "./capabilities.js";
import { classifyProviderError, normalizeResponse, normalizeStreamEvent } from "./normalization.js";
import { createLLMGatewayRuntime } from "./runtime.js";
import { sendLLMRequest } from "./send-flow.js";
import { streamLLMRequest } from "./stream-flow.js";
import type {
  LLMGateway,
  LLMGatewayOptions,
  LLMRequest,
  NormalizedLLMResponse,
  NormalizedStreamEvent
} from "./types.js";

export function createLLMGateway(options: LLMGatewayOptions): LLMGateway {
  const runtime = createLLMGatewayRuntime(options);
  return {
    listProviders: () => listProviders(runtime),
    getModelCapabilities: (provider, model) => getModelCapabilities(runtime, provider, model),
    checkModelCapabilities: (input) => checkModelCapabilities(runtime, input),
    buildProviderRequest: (request) => buildProviderRequestSummary(runtime, request),
    sendLLMRequest: (request) => sendLLMRequest(runtime, request),
    streamLLMRequest: (request) => streamLLMRequest(runtime, request),
    normalizeProviderResponse: async (rawResponse, request) => {
      const envelope = await buildProviderRequestEnvelope(runtime, request);
      if (!envelope.ok) return envelope;
      const normalized = await normalizeResponse(rawResponse, { request, providerRequest: envelope.value });
      return normalized.ok ? ok(normalized.value as NormalizedLLMResponse) : normalized;
    },
    normalizeProviderStream: async (rawEvent, request) => {
      const envelope = await buildProviderRequestEnvelope(runtime, request);
      if (!envelope.ok) return envelope;
      const normalized = await normalizeStreamEvent(rawEvent, { request, providerRequest: envelope.value }, 1);
      return normalized as Result<NormalizedStreamEvent>;
    },
    normalizeProviderError: (error, request?: Partial<LLMRequest>) => ok(classifyProviderError(error, request))
  };
}

import { ok, type Result } from "../domain/result.js";
import { llmGatewayEventTypes } from "./events.js";
import { llmGatewayErr } from "./errors.js";
import { appendLLMEvent, adapterFor, type LLMGatewayRuntime } from "./runtime.js";
import type {
  LLMGatewayOptions,
  LLMRequiredCapabilities,
  ModelCapabilityCheck,
  ModelCapabilityCheckInput,
  ModelCapabilitySummary,
  ProviderList
} from "./types.js";

export async function listProviders(runtime: LLMGatewayRuntime): Promise<Result<ProviderList>> {
  const fromAdapters = [...runtime.adapters.keys()];
  const fromCapabilities = (runtime.options.defaultCapabilities ?? []).map((item) => item.provider);
  return ok({ providers: [...new Set([...fromAdapters, ...fromCapabilities])] });
}

export async function getModelCapabilities(
  runtime: LLMGatewayRuntime,
  provider: string,
  model: string
): Promise<Result<ModelCapabilitySummary>> {
  const fromDefaults = runtime.options.defaultCapabilities?.find((item) => item.provider === provider && item.model === model);
  const adapter = runtime.adapters.get(provider);
  if (adapter?.getCapabilities !== undefined) {
    try {
      const fromAdapter = await adapter.getCapabilities(model);
      if (fromAdapter !== undefined) return ok(fromAdapter);
    } catch (cause) {
      return llmGatewayErr({
        code: "provider_unavailable",
        message: `provider ${provider} capability lookup failed`,
        retryable: true,
        cause
      });
    }
  }
  if (fromDefaults !== undefined) return ok(fromDefaults);
  const registered = adapterFor(runtime, provider);
  return registered.ok ? ok(unknownCapability(runtime.options, provider, model)) : registered;
}

export async function checkModelCapabilities(
  runtime: LLMGatewayRuntime,
  input: ModelCapabilityCheckInput
): Promise<Result<ModelCapabilityCheck>> {
  const summary = await getModelCapabilities(runtime, input.modelSelection.provider, input.modelSelection.model);
  if (!summary.ok) return summary;
  const unsupported = unsupportedRequirements(summary.value, input.requiredCapabilities ?? {});
  const check: ModelCapabilityCheck = {
    modelSelection: input.modelSelection,
    capabilitySummary: summary.value,
    compatible: unsupported.length === 0,
    unsupported,
    warnings: unknownWarnings(summary.value, input.requiredCapabilities ?? {})
  };
  const event = await appendLLMEvent({
    runtime,
    eventType: llmGatewayEventTypes.modelCapabilityChecked,
    body: {
      provider: input.modelSelection.provider,
      model: input.modelSelection.model,
      compatible: check.compatible,
      unsupported
    },
    source: summary.value.source,
    audit: summary.value.audit
  });
  return event.ok ? ok(check) : event;
}

export function unsupportedRequirements(
  summary: ModelCapabilitySummary,
  required: LLMRequiredCapabilities
): readonly string[] {
  const items: string[] = [];
  if (required.streaming === true && summary.supportsStreaming !== true) items.push("streaming");
  if (required.toolCalls === true && summary.supportsToolCalls !== true) items.push("tool_calls");
  if (required.structuredOutput === true && summary.supportsStructuredOutput !== true) items.push("structured_output");
  if (required.multimodalInput === true && summary.supportsMultimodalInput !== true) items.push("multimodal_input");
  if (required.reasoningTrace === true && summary.supportsReasoningTrace !== true) items.push("reasoning_trace");
  return items;
}

function unknownWarnings(summary: ModelCapabilitySummary, required: LLMRequiredCapabilities): readonly string[] {
  const warnings: string[] = [];
  if (required.streaming === true && summary.supportsStreaming === "unknown") warnings.push("streaming capability is unknown");
  if (required.toolCalls === true && summary.supportsToolCalls === "unknown") warnings.push("tool call capability is unknown");
  if (required.structuredOutput === true && summary.supportsStructuredOutput === "unknown") warnings.push("structured output capability is unknown");
  if (required.multimodalInput === true && summary.supportsMultimodalInput === "unknown") warnings.push("multimodal input capability is unknown");
  if (required.reasoningTrace === true && summary.supportsReasoningTrace === "unknown") warnings.push("reasoning trace capability is unknown");
  return warnings;
}

function unknownCapability(options: LLMGatewayOptions, provider: string, model: string): ModelCapabilitySummary {
  const now = new Date().toISOString();
  return {
    provider,
    model,
    contextLimit: "unknown",
    outputLimit: "unknown",
    supportsStreaming: "unknown",
    supportsToolCalls: "unknown",
    supportsStructuredOutput: "unknown",
    supportsMultimodalInput: "unknown",
    supportsReasoningTrace: "unknown",
    toolCallFormat: "unknown",
    requestLimits: {},
    knownUnsupportedFeatures: ["capability summary not supplied by adapter"],
    source: {
      kind: "system",
      origin: "llm-gateway",
      workspace: options.workspace.id,
      userProvided: false,
      receivedAt: now,
      privacyLevel: "workspace_private"
    },
    version: { schemaVersion: "1", producerVersion: options.producer },
    audit: { createdAt: now, createdBy: options.producer, reason: "default unknown model capability" }
  };
}

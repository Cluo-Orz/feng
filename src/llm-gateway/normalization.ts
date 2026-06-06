import { ok, type Result } from "../domain/result.js";
import { llmGatewayErr } from "./errors.js";
import type {
  LLMContentBlock,
  LLMErrorClassification,
  LLMFinishReason,
  LLMRequest,
  LLMUsage,
  NormalizedLLMResponse,
  NormalizedStreamEvent,
  ProviderAdapterContext,
  ToolCallBlock
} from "./types.js";

export const zeroUsage: LLMUsage = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0
};

export async function normalizeResponse(
  raw: unknown,
  context: ProviderAdapterContext
): Promise<Result<Omit<NormalizedLLMResponse, "receiptRef">>> {
  try {
    return ok(genericResponse(raw, context.request));
  } catch (cause) {
    return llmGatewayErr({ code: "response_invalid", message: "provider response could not be normalized", cause });
  }
}

export async function normalizeStreamEvent(
  raw: unknown,
  context: ProviderAdapterContext,
  sequence: number
): Promise<Result<NormalizedStreamEvent>> {
  try {
    return ok(genericStreamEvent(raw, context.request, sequence));
  } catch (cause) {
    return llmGatewayErr({ code: "response_invalid", message: "provider stream event could not be normalized", cause });
  }
}

export function classifyProviderError(error: unknown, request?: Partial<LLMRequest>): LLMErrorClassification {
  const statusCode = statusFrom(error);
  const text = messageFrom(error).toLowerCase();
  const code = codeFrom(statusCode, text, error);
  return {
    code,
    message: messageFrom(error),
    ...(request?.modelSelection?.provider === undefined ? {} : { provider: request.modelSelection.provider }),
    ...(request?.modelSelection?.model === undefined ? {} : { model: request.modelSelection.model }),
    ...(statusCode === undefined ? {} : { statusCode }),
    retryable: retryable(code),
    fallbackRecommended: fallbackRecommended(code),
    contextCompressionRequired: code === "context_length_exceeded"
  };
}

export function usageFrom(value: unknown): LLMUsage {
  const record = asRecord(value);
  if (record === undefined) return zeroUsage;
  const input = numberValue(record.prompt_tokens) ?? numberValue(record.input_tokens) ?? numberValue(record.inputTokens) ?? 0;
  const output = numberValue(record.completion_tokens) ?? numberValue(record.output_tokens) ?? numberValue(record.outputTokens) ?? 0;
  const reasoning = numberValue(record.reasoning_tokens) ?? numberValue(record.reasoningTokens) ?? 0;
  const cacheRead = nestedNumber(record.prompt_tokens_details, "cached_tokens") ?? numberValue(record.cacheReadTokens) ?? 0;
  const cacheWrite = numberValue(record.cacheWriteTokens) ?? 0;
  const total = numberValue(record.total_tokens) ?? numberValue(record.totalTokens) ?? input + output + reasoning;
  return {
    inputTokens: input,
    outputTokens: output,
    reasoningTokens: reasoning,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    totalTokens: total
  };
}

function genericResponse(raw: unknown, request: LLMRequest): Omit<NormalizedLLMResponse, "receiptRef"> {
  const record = asRecord(raw);
  if (record === undefined) throw new Error("response is not an object");
  const choice = firstChoice(record);
  const message = asRecord(choice?.message) ?? asRecord(choice?.delta) ?? record;
  const blocks = blocksFromMessage(message, record);
  const toolBlocks = blocks.filter((block): block is ToolCallBlock => block.type === "tool_call");
  return {
    requestId: request.requestId,
    provider: request.modelSelection.provider,
    model: request.modelSelection.model,
    contentBlocks: blocks.length > 0 ? blocks : [{ type: "unknown", rawSummary: summarize(raw) }],
    toolCallBlocks: toolBlocks,
    usage: usageFrom(record.usage),
    finishReason: finishReason(String(choice?.finish_reason ?? record.finish_reason ?? "unknown")),
    ...(typeof record.stop_reason === "string" ? { stopReason: record.stop_reason } : {}),
    providerMetadataSummary: providerMetadata(record),
    source: request.source,
    audit: request.audit
  };
}

function genericStreamEvent(raw: unknown, request: LLMRequest, sequence: number): NormalizedStreamEvent {
  const base = {
    requestId: request.requestId,
    provider: request.modelSelection.provider,
    model: request.modelSelection.model,
    sequence,
    source: request.source,
    audit: request.audit
  };
  const record = asRecord(raw);
  if (record === undefined) throw new Error("stream event is not an object");
  if (typeof record.type === "string" && record.requestId !== undefined) {
    return { ...record, ...base, sequence } as NormalizedStreamEvent;
  }
  const choice = firstChoice(record);
  const delta = asRecord(choice?.delta) ?? asRecord(choice?.message) ?? record;
  if (typeof delta.content === "string" && delta.content.length > 0) {
    return { ...base, type: "text_delta", text: delta.content };
  }
  if (typeof delta.reasoning === "string") return { ...base, type: "reasoning_delta", text: delta.reasoning };
  if (typeof delta.reasoning_content === "string") return { ...base, type: "reasoning_delta", text: delta.reasoning_content };
  const tool = firstToolDelta(delta);
  if (tool !== undefined) return tool;
  if (record.usage !== undefined) return { ...base, type: "usage_delta", usage: usageFrom(record.usage) };
  const finish = choice?.finish_reason ?? record.finish_reason;
  if (typeof finish === "string" && finish.length > 0) {
    return { ...base, type: "response_completed", usage: usageFrom(record.usage), finishReason: finishReason(finish) };
  }
  if (typeof record.warning === "string") return { ...base, type: "provider_warning", warning: record.warning };
  return { ...base, type: "provider_warning", warning: `unrecognized stream event: ${summarize(raw)}` };

  function firstToolDelta(deltaRecord: Record<string, unknown>): NormalizedStreamEvent | undefined {
    const calls = Array.isArray(deltaRecord.tool_calls) ? deltaRecord.tool_calls : undefined;
    const first = asRecord(calls?.[0]);
    if (first === undefined) return undefined;
    const fn = asRecord(first.function);
    const callId = String(first.id ?? first.call_id ?? `tool-${String(first.index ?? 0)}`);
    const name = typeof fn?.name === "string" ? fn.name : "";
    const args = typeof fn?.arguments === "string" ? fn.arguments : "";
    if (name.length > 0) return { ...base, type: "tool_call_started", callId, name };
    return { ...base, type: "tool_call_delta", callId, argumentsTextDelta: args };
  }
}

function blocksFromMessage(message: Record<string, unknown>, response: Record<string, unknown>): readonly LLMContentBlock[] {
  const blocks: LLMContentBlock[] = [];
  if (typeof message.content === "string" && message.content.length > 0) blocks.push({ type: "text", text: message.content });
  if (typeof message.reasoning === "string" && message.reasoning.length > 0) blocks.push({ type: "reasoning_summary", text: message.reasoning });
  if (typeof message.reasoning_content === "string" && message.reasoning_content.length > 0) {
    blocks.push({ type: "reasoning_summary", text: message.reasoning_content });
  }
  if (response.output_text !== undefined && typeof response.output_text === "string" && response.output_text.length > 0) {
    blocks.push({ type: "text", text: response.output_text });
  }
  if (message.refusal !== undefined && typeof message.refusal === "string") {
    blocks.push({ type: "refusal_or_safety_notice", text: message.refusal });
  }
  for (const tool of toolCallsFrom(message.tool_calls)) blocks.push(tool);
  return blocks;
}

function toolCallsFrom(value: unknown): readonly ToolCallBlock[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const record = asRecord(item) ?? {};
    const fn = asRecord(record.function) ?? {};
    const argumentsText = typeof fn.arguments === "string" ? fn.arguments : stableJson(fn.arguments ?? {});
    return {
      type: "tool_call" as const,
      callId: String(record.id ?? record.call_id ?? `tool-${index}`),
      name: String(fn.name ?? record.name ?? "tool"),
      argumentsText,
      ...parseArguments(argumentsText),
      providerMetadataSummary: providerMetadata(record)
    };
  });
}

function parseArguments(argumentsText: string): { readonly arguments?: unknown } {
  try {
    return { arguments: JSON.parse(argumentsText) };
  } catch {
    return {};
  }
}

function finishReason(value: string): LLMFinishReason {
  if (value === "stop") return "stop";
  if (value === "length" || value === "max_tokens") return "length";
  if (value === "tool_calls" || value === "function_call") return "tool_calls";
  if (value === "content_filter" || value === "content-filter") return "content_filter";
  if (value === "cancelled") return "cancelled";
  if (value === "error") return "error";
  return "unknown";
}

function codeFrom(status: number | undefined, text: string, error: unknown): LLMErrorClassification["code"] {
  const structured = asRecord(error)?.code;
  if (typeof structured === "string" && llmErrorCodes.has(structured)) {
    return structured as LLMErrorClassification["code"];
  }
  if (status === 401 || status === 403 || includesAny(text, ["unauthorized", "invalid api key", "auth"])) return "auth_failed";
  if (status === 429 || includesAny(text, ["rate limit", "too many requests", "quota"])) return "rate_limited";
  if (status === 408 || includesAny(text, ["timeout", "timed out", "deadline exceeded"])) return "timeout";
  if (includesAny(text, ["context length", "too many tokens", "maximum context", "prompt is too long"])) return "context_length_exceeded";
  if (includesAny(text, ["content_filter", "safety", "policy violation"])) return "content_filtered";
  if (status !== undefined && status >= 500) return "provider_internal_error";
  if (status !== undefined && status >= 400) return "request_invalid";
  if (error instanceof TypeError && includesAny(text, ["network", "fetch", "connection"])) return "network_failed";
  return "unknown_provider_error";
}

const llmErrorCodes = new Set([
  "provider_unavailable",
  "network_failed",
  "timeout",
  "rate_limited",
  "auth_failed",
  "permission_denied",
  "policy_blocked",
  "context_length_exceeded",
  "model_capability_unsupported",
  "request_invalid",
  "response_invalid",
  "stream_interrupted",
  "tool_call_parse_failed",
  "content_filtered",
  "provider_internal_error",
  "unknown_provider_error"
]);

function retryable(code: LLMErrorClassification["code"]): boolean {
  return ["network_failed", "timeout", "rate_limited", "provider_internal_error", "provider_unavailable", "unknown_provider_error"].includes(code);
}

function fallbackRecommended(code: LLMErrorClassification["code"]): boolean {
  return ["rate_limited", "provider_unavailable", "provider_internal_error", "context_length_exceeded", "content_filtered"].includes(code);
}

function firstChoice(record: Record<string, unknown>): Record<string, unknown> | undefined {
  return asRecord(Array.isArray(record.choices) ? record.choices[0] : undefined);
}

function providerMetadata(record: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const key of ["id", "object", "created", "system_fingerprint", "provider", "model"]) {
    if (record[key] !== undefined) metadata[key] = record[key];
  }
  return metadata;
}

function statusFrom(error: unknown): number | undefined {
  const record = asRecord(error);
  const status = record?.status_code ?? record?.status;
  return typeof status === "number" ? status : undefined;
}

function messageFrom(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return summarize(error);
}

function includesAny(text: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined;
}

function nestedNumber(value: unknown, key: string): number | undefined {
  const record = asRecord(value);
  return record === undefined ? undefined : numberValue(record[key]);
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function summarize(value: unknown): string {
  try {
    return JSON.stringify(value)?.slice(0, 500) ?? String(value);
  } catch {
    return String(value);
  }
}

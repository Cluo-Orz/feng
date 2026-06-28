import type {
  AuditDescriptor,
  SourceDescriptor,
  VersionDescriptor
} from "../domain/index.js";
import type {
  LLMProviderAdapter,
  ModelCapabilitySummary,
  ProviderAdapterContext
} from "../llm-gateway/index.js";
import type { ProviderNeutralMessage } from "../context-message-compiler/index.js";

export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
  readonly text: () => Promise<string>;
}

export type FetchLike = (url: string, init: {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly signal?: AbortSignal;
}) => Promise<FetchResponseLike>;

export interface OpenAICompatibleConfig {
  readonly provider: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly contextLimit?: number;
  readonly outputLimit?: number;
  readonly reasoningModel?: boolean;
  readonly fetchImpl?: FetchLike;
  readonly now?: () => string;
}

interface ProviderError extends Error {
  status?: number;
  code?: string;
}

const defaultFetch: FetchLike = (url, init) =>
  fetch(url, init) as unknown as Promise<FetchResponseLike>;

function toOpenAIMessages(messages: readonly ProviderNeutralMessage[]): readonly Record<string, unknown>[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content.map((part) => part.text).join(""),
    ...(message.name === undefined ? {} : { name: message.name })
  }));
}

function descriptors(config: OpenAICompatibleConfig): {
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
} {
  const now = (config.now ?? (() => new Date().toISOString()))();
  return {
    source: {
      kind: "system",
      origin: `provider:${config.provider}`,
      userProvided: false,
      receivedAt: now,
      privacyLevel: "workspace_private"
    },
    version: { schemaVersion: "1.0.0", producerVersion: `provider-${config.provider}` },
    audit: { createdAt: now, createdBy: `provider:${config.provider}`, reason: "describe provider model capability" }
  };
}

export function buildCapabilitySummary(config: OpenAICompatibleConfig, model: string): ModelCapabilitySummary {
  const meta = descriptors(config);
  return {
    provider: config.provider,
    model,
    contextLimit: config.contextLimit ?? 65536,
    outputLimit: config.outputLimit ?? 8192,
    supportsStreaming: true,
    supportsToolCalls: true,
    supportsStructuredOutput: true,
    supportsMultimodalInput: false,
    supportsReasoningTrace: config.reasoningModel ?? true,
    toolCallFormat: "openai_function",
    requestLimits: {},
    knownUnsupportedFeatures: [],
    source: meta.source,
    version: meta.version,
    audit: meta.audit
  };
}

export function buildRequestPayload(
  config: OpenAICompatibleConfig,
  context: ProviderAdapterContext
): Record<string, unknown> {
  const messages = toOpenAIMessages(context.providerRequest.providerNeutralMessages);
  const tools = context.request.toolSurfaceSummary ?? [];
  return {
    model: context.request.modelSelection.model,
    messages,
    max_tokens: config.maxTokens ?? 4096,
    ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
    stream: false,
    ...(tools.length === 0
      ? {}
      : {
          tools: tools.map((tool) => ({
            type: "function",
            function: { name: tool.name, description: tool.capabilitySummary }
          }))
        })
  };
}

export function createOpenAICompatibleAdapter(config: OpenAICompatibleConfig): LLMProviderAdapter {
  const fetchImpl = config.fetchImpl ?? defaultFetch;
  const endpoint = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  return {
    provider: config.provider,
    getCapabilities: async (model) => buildCapabilitySummary(config, model),
    listModels: async () => [buildCapabilitySummary(config, config.model)],
    send: async (context: ProviderAdapterContext) => {
      const payload = buildRequestPayload(config, context);
      const timeoutMs = context.request.timeoutMs ?? 120_000;
      const controller = new AbortController();
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(timeoutError(config.provider, timeoutMs));
        }, timeoutMs);
      });
      try {
        const response = await Promise.race([
          fetchImpl(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(payload),
            signal: controller.signal
          }),
          timeout
        ]);
        if (!response.ok) {
          const detail = await safeText(response);
          const error: ProviderError = new Error(`provider ${config.provider} returned ${response.status}: ${detail}`);
          error.status = response.status;
          throw error;
        }
        return await response.json();
      } catch (cause) {
        if (timedOut && !isTimeoutError(cause)) throw timeoutError(config.provider, timeoutMs, cause);
        throw cause;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
  };
}

function timeoutError(provider: string, timeoutMs: number, cause?: unknown): ProviderError {
  const error: ProviderError = new Error(`provider ${provider} timed out after ${timeoutMs}ms`);
  error.code = "timeout";
  if (cause !== undefined) error.cause = cause;
  return error;
}

function isTimeoutError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { readonly code?: unknown }).code : undefined;
  return code === "timeout";
}

async function safeText(response: FetchResponseLike): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "<unreadable body>";
  }
}

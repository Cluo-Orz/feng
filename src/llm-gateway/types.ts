import type { BrandedString } from "../domain/brand.js";
import type {
  ArtifactRef,
  AuditDescriptor,
  MessageListRef,
  PolicyDecisionId,
  SourceDescriptor,
  VersionDescriptor
} from "../domain/index.js";
import type { Result } from "../domain/result.js";
import type { ArtifactRegistry } from "../artifact-registry/index.js";
import type { ContextMessageCompiler, ProviderNeutralMessage, ToolSurfaceSummary } from "../context-message-compiler/index.js";
import type { EventLedger } from "../event-ledger/index.js";
import type { WorkspaceHandle } from "../file-store/index.js";
import type { PolicyBoundary } from "../policy-boundary/index.js";

export type LLMRequestId = BrandedString<"LLMRequestId">;
export type ProviderCallReceiptId = BrandedString<"ProviderCallReceiptId">;
export type CapabilitySupport = boolean | "unknown" | "unsupported";
export type ToolCallFormat = "openai_function" | "anthropic_tool_use" | "gemini_function_call" | "json_block" | "none" | "unknown";
export type LLMFinishReason = "stop" | "length" | "tool_calls" | "content_filter" | "cancelled" | "error" | "unknown";
export type LLMErrorCode =
  | "provider_unavailable"
  | "network_failed"
  | "timeout"
  | "rate_limited"
  | "auth_failed"
  | "permission_denied"
  | "policy_blocked"
  | "context_length_exceeded"
  | "model_capability_unsupported"
  | "request_invalid"
  | "response_invalid"
  | "stream_interrupted"
  | "tool_call_parse_failed"
  | "content_filtered"
  | "provider_internal_error"
  | "unknown_provider_error";

export interface ModelCapabilitySummary {
  readonly provider: string;
  readonly model: string;
  readonly modelVersion?: string;
  readonly contextLimit: number | "unknown";
  readonly outputLimit: number | "unknown";
  readonly supportsStreaming: CapabilitySupport;
  readonly supportsToolCalls: CapabilitySupport;
  readonly supportsStructuredOutput: CapabilitySupport;
  readonly supportsMultimodalInput: CapabilitySupport;
  readonly supportsReasoningTrace: CapabilitySupport;
  readonly toolCallFormat: ToolCallFormat;
  readonly requestLimits: Record<string, number | string>;
  readonly knownUnsupportedFeatures: readonly string[];
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
}

export interface LLMRequiredCapabilities {
  readonly streaming?: boolean;
  readonly toolCalls?: boolean;
  readonly structuredOutput?: boolean;
  readonly multimodalInput?: boolean;
  readonly reasoningTrace?: boolean;
}

export interface LLMModelSelection {
  readonly provider: string;
  readonly model: string;
  readonly modelVersion?: string;
}

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly retryOn?: readonly LLMErrorCode[];
}

export interface FallbackPolicy {
  readonly fallbacks: readonly LLMModelSelection[];
  readonly onErrorCodes?: readonly LLMErrorCode[];
}

export interface LLMRequest {
  readonly requestId: LLMRequestId;
  readonly messageListRef?: MessageListRef;
  readonly providerNeutralMessages?: readonly ProviderNeutralMessage[];
  readonly modelSelection: LLMModelSelection;
  readonly requiredCapabilities?: LLMRequiredCapabilities;
  readonly toolSurfaceSummary?: readonly ToolSurfaceSummary[];
  readonly streaming: boolean;
  readonly timeoutMs?: number;
  readonly retryPolicy?: RetryPolicy;
  readonly fallbackPolicy?: FallbackPolicy;
  readonly policyDecisionId: PolicyDecisionId;
  readonly correlationId?: string;
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
}

export interface ProviderRequestSummary {
  readonly requestId: LLMRequestId;
  readonly provider: string;
  readonly model: string;
  readonly modelVersion?: string;
  readonly messageListRef?: MessageListRef;
  readonly messageCount: number;
  readonly toolSurfaceCount: number;
  readonly streaming: boolean;
  readonly estimatedInputTokens: number;
  readonly requiredCapabilities: LLMRequiredCapabilities;
  readonly requestShape: string;
  readonly providerRequestPreview: string;
  readonly policyDecisionId: PolicyDecisionId;
  readonly builtAt: string;
}

export interface ProviderRequestEnvelope {
  readonly summary: ProviderRequestSummary;
  readonly payload: unknown;
  readonly providerNeutralMessages: readonly ProviderNeutralMessage[];
  readonly parentArtifactRefs: readonly ArtifactRef[];
}

export interface ProviderList {
  readonly providers: readonly string[];
}

export interface ModelCapabilityCheckInput {
  readonly modelSelection: LLMModelSelection;
  readonly requiredCapabilities?: LLMRequiredCapabilities;
}

export interface ModelCapabilityCheck {
  readonly modelSelection: LLMModelSelection;
  readonly capabilitySummary: ModelCapabilitySummary;
  readonly compatible: boolean;
  readonly unsupported: readonly string[];
  readonly warnings: readonly string[];
}

export interface LLMUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly totalTokens: number;
}

export interface ToolCallBlock {
  readonly type: "tool_call";
  readonly callId: string;
  readonly name: string;
  readonly argumentsText: string;
  readonly arguments?: unknown;
  readonly providerMetadataSummary?: Record<string, unknown>;
}

export type LLMContentBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "reasoning_summary"; readonly text: string }
  | { readonly type: "structured_output"; readonly value: unknown }
  | ToolCallBlock
  | { readonly type: "refusal_or_safety_notice"; readonly text: string }
  | { readonly type: "unknown"; readonly rawSummary: string };

export interface LLMErrorClassification {
  readonly code: LLMErrorCode;
  readonly message: string;
  readonly provider?: string;
  readonly model?: string;
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly fallbackRecommended: boolean;
  readonly contextCompressionRequired: boolean;
}

export interface NormalizedLLMResponse {
  readonly requestId: LLMRequestId;
  readonly provider: string;
  readonly model: string;
  readonly contentBlocks: readonly LLMContentBlock[];
  readonly toolCallBlocks: readonly ToolCallBlock[];
  readonly usage: LLMUsage;
  readonly finishReason: LLMFinishReason;
  readonly stopReason?: string;
  readonly providerMetadataSummary: Record<string, unknown>;
  readonly receiptRef?: ArtifactRef;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface NormalizedStreamBase {
  readonly requestId: LLMRequestId;
  readonly provider: string;
  readonly model: string;
  readonly sequence: number;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export type NormalizedStreamEvent =
  | (NormalizedStreamBase & { readonly type: "response_started" })
  | (NormalizedStreamBase & { readonly type: "text_delta"; readonly text: string })
  | (NormalizedStreamBase & { readonly type: "reasoning_delta"; readonly text: string })
  | (NormalizedStreamBase & { readonly type: "tool_call_started"; readonly callId: string; readonly name: string })
  | (NormalizedStreamBase & { readonly type: "tool_call_delta"; readonly callId: string; readonly argumentsTextDelta: string })
  | (NormalizedStreamBase & { readonly type: "tool_call_completed"; readonly toolCall: ToolCallBlock })
  | (NormalizedStreamBase & { readonly type: "usage_delta"; readonly usage: Partial<LLMUsage> })
  | (NormalizedStreamBase & { readonly type: "response_completed"; readonly usage: LLMUsage; readonly finishReason: LLMFinishReason; readonly receiptRef?: ArtifactRef })
  | (NormalizedStreamBase & { readonly type: "response_failed"; readonly errorClassification: LLMErrorClassification; readonly receiptRef?: ArtifactRef })
  | (NormalizedStreamBase & { readonly type: "provider_warning"; readonly warning: string });

export interface ProviderFallbackRecord {
  readonly from: LLMModelSelection;
  readonly to: LLMModelSelection;
  readonly reason: LLMErrorCode;
  readonly at: string;
}

export interface ProviderCallReceipt {
  readonly receiptId: ProviderCallReceiptId;
  readonly requestId: LLMRequestId;
  readonly messageListRef?: MessageListRef;
  readonly provider: string;
  readonly model: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly streaming: boolean;
  readonly retryCount: number;
  readonly retryReasons: readonly LLMErrorCode[];
  readonly fallbackUsed: boolean;
  readonly fallbackTrail: readonly ProviderFallbackRecord[];
  readonly usage: LLMUsage;
  readonly finishReason: LLMFinishReason;
  readonly errorClassification?: LLMErrorClassification;
  readonly policyDecisionId: PolicyDecisionId;
  readonly correlationId?: string;
  readonly contentHash: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface ProviderAdapterContext {
  readonly request: LLMRequest;
  readonly providerRequest: ProviderRequestEnvelope;
}

export interface LLMProviderAdapter {
  readonly provider: string;
  readonly listModels?: () => Promise<readonly ModelCapabilitySummary[]>;
  readonly getCapabilities?: (model: string) => Promise<ModelCapabilitySummary | undefined>;
  readonly buildProviderRequest?: (input: {
    readonly request: LLMRequest;
    readonly messages: readonly ProviderNeutralMessage[];
    readonly tools: readonly ToolSurfaceSummary[];
  }) => Promise<{ readonly payload: unknown; readonly requestShape?: string; readonly preview?: string }>;
  readonly send?: (context: ProviderAdapterContext) => Promise<unknown>;
  readonly stream?: (context: ProviderAdapterContext) => AsyncIterable<unknown>;
  readonly normalizeResponse?: (raw: unknown, context: ProviderAdapterContext) => Promise<Omit<NormalizedLLMResponse, "receiptRef">>;
  readonly normalizeStreamEvent?: (raw: unknown, context: ProviderAdapterContext, sequence: number) => Promise<NormalizedStreamEvent>;
  readonly normalizeError?: (error: unknown, context?: Partial<ProviderAdapterContext>) => LLMErrorClassification;
}

export interface LLMGatewayOptions {
  readonly workspace: WorkspaceHandle;
  readonly ledger: EventLedger;
  readonly artifactRegistry: ArtifactRegistry;
  readonly policyBoundary: PolicyBoundary;
  readonly contextCompiler?: ContextMessageCompiler;
  readonly producer: string;
  readonly adapters?: readonly LLMProviderAdapter[];
  readonly defaultCapabilities?: readonly ModelCapabilitySummary[];
}

export interface LLMGateway {
  readonly listProviders: () => Promise<Result<ProviderList>>;
  readonly getModelCapabilities: (provider: string, model: string) => Promise<Result<ModelCapabilitySummary>>;
  readonly checkModelCapabilities: (input: ModelCapabilityCheckInput) => Promise<Result<ModelCapabilityCheck>>;
  readonly buildProviderRequest: (request: LLMRequest) => Promise<Result<ProviderRequestSummary>>;
  readonly sendLLMRequest: (request: LLMRequest) => Promise<Result<NormalizedLLMResponse>>;
  readonly streamLLMRequest: (request: LLMRequest) => AsyncIterable<Result<NormalizedStreamEvent>>;
  readonly normalizeProviderResponse: (rawResponse: unknown, request: LLMRequest) => Promise<Result<NormalizedLLMResponse>>;
  readonly normalizeProviderStream: (rawEvent: unknown, request: LLMRequest) => Promise<Result<NormalizedStreamEvent>>;
  readonly normalizeProviderError: (error: unknown, request?: Partial<LLMRequest>) => Result<LLMErrorClassification>;
}

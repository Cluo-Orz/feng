import { randomUUID } from "node:crypto";
import type { ArtifactRef } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import { sha256Text, stableStringify } from "../event-ledger/stable-json.js";
import { makeProviderCallReceiptId } from "./brand.js";
import { llmGatewayErr } from "./errors.js";
import type { LLMGatewayRuntime } from "./runtime.js";
import type {
  LLMErrorClassification,
  LLMFinishReason,
  LLMRequest,
  LLMUsage,
  NormalizedLLMResponse,
  ProviderCallReceipt,
  ProviderFallbackRecord
} from "./types.js";
import { zeroUsage } from "./normalization.js";

export interface ReceiptInput {
  readonly request: LLMRequest;
  readonly provider: string;
  readonly model: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly retryCount: number;
  readonly retryReasons: readonly LLMErrorClassification["code"][];
  readonly fallbackTrail: readonly ProviderFallbackRecord[];
  readonly usage?: LLMUsage;
  readonly finishReason?: LLMFinishReason;
  readonly errorClassification?: LLMErrorClassification;
  readonly contentForHash: unknown;
  readonly parentRefs?: readonly ArtifactRef[];
}

export async function registerProviderCallReceipt(
  runtime: LLMGatewayRuntime,
  input: ReceiptInput
): Promise<Result<{ readonly receipt: ProviderCallReceipt; readonly receiptRef: ArtifactRef }>> {
  const receipt: ProviderCallReceipt = {
    receiptId: makeProviderCallReceiptId(`provider-call-receipt-${randomUUID()}`),
    requestId: input.request.requestId,
    ...(input.request.messageListRef === undefined ? {} : { messageListRef: input.request.messageListRef }),
    provider: input.provider,
    model: input.model,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    streaming: input.request.streaming,
    retryCount: input.retryCount,
    retryReasons: input.retryReasons,
    fallbackUsed: input.fallbackTrail.length > 0,
    fallbackTrail: input.fallbackTrail,
    usage: input.usage ?? zeroUsage,
    finishReason: input.finishReason ?? (input.errorClassification === undefined ? "unknown" : "error"),
    ...(input.errorClassification === undefined ? {} : { errorClassification: input.errorClassification }),
    policyDecisionId: input.request.policyDecisionId,
    ...(input.request.correlationId === undefined ? {} : { correlationId: input.request.correlationId }),
    contentHash: sha256Text(stableStringify(input.contentForHash)),
    source: input.request.source,
    audit: input.request.audit
  };
  const artifactInput = {
    kind: "summary",
    content: JSON.stringify(receipt, null, 2),
    mediaType: "application/json",
    encoding: "utf8",
    source: input.request.source,
    version: input.request.version,
    audit: input.request.audit,
    privacyClass: "contains_model_output",
    retentionClass: "attempt_scoped",
    producerModule: "llm-gateway",
    ...(input.request.correlationId === undefined ? {} : { correlationId: input.request.correlationId })
  } as const;
  const parents = input.parentRefs ?? [];
  const artifact = parents.length === 0
    ? await runtime.options.artifactRegistry.registerArtifact(artifactInput)
    : await runtime.options.artifactRegistry.registerDerivedArtifact({ ...artifactInput, parentRefs: parents });
  if (!artifact.ok) return artifact;
  return ok({ receipt, receiptRef: artifact.value });
}

export function attachReceipt(response: Omit<NormalizedLLMResponse, "receiptRef">, receiptRef: ArtifactRef): NormalizedLLMResponse {
  return { ...response, receiptRef };
}

export async function failedResultWithReceipt(
  runtime: LLMGatewayRuntime,
  input: ReceiptInput
): Promise<Result<never>> {
  const receipt = await registerProviderCallReceipt(runtime, input);
  return receipt.ok
    ? llmGatewayErr({
        code: input.errorClassification?.code ?? "llm_failed",
        message: input.errorClassification?.message ?? "LLM request failed",
        retryable: input.errorClassification?.retryable ?? false,
        evidenceRef: receipt.value.receiptRef
      })
    : receipt;
}

import { ok, type Result } from "../domain/result.js";
import { llmGatewayErr } from "./errors.js";
import type { LLMGatewayRuntime } from "./runtime.js";
import type { LLMRequest } from "./types.js";
import type { ArtifactRef } from "../domain/index.js";
import type { ProviderNeutralMessage } from "../context-message-compiler/index.js";

export interface ResolvedMessages {
  readonly messages: readonly ProviderNeutralMessage[];
  readonly parentArtifactRefs: readonly ArtifactRef[];
}

export async function resolveProviderMessages(
  runtime: LLMGatewayRuntime,
  request: LLMRequest
): Promise<Result<ResolvedMessages>> {
  if (request.providerNeutralMessages !== undefined) {
    const valid = validateMessages(request.providerNeutralMessages);
    return valid.ok ? ok({ messages: request.providerNeutralMessages, parentArtifactRefs: [] }) : valid;
  }
  if (request.messageListRef === undefined) {
    return llmGatewayErr({
      code: "invalid_input",
      message: "LLMRequest requires providerNeutralMessages or messageListRef"
    });
  }
  if (runtime.options.contextCompiler === undefined) {
    return llmGatewayErr({
      code: "artifact_unavailable",
      message: "messageListRef requires a contextCompiler dependency"
    });
  }
  const explained = await runtime.options.contextCompiler.explainMessageList(request.messageListRef);
  if (!explained.ok) {
    return llmGatewayErr({
      code: explained.error.code === "not_found" ? "artifact_unavailable" : explained.error.code,
      message: explained.error.message,
      cause: explained.error
    });
  }
  const artifactRef = explained.value.compileReport.artifactRef;
  const materialized = await runtime.options.artifactRegistry.materializeArtifact(artifactRef, {
    reason: "llm gateway materialize compiled message list",
    allowArchived: true,
    maxBytes: 5 * 1024 * 1024
  });
  if (!materialized.ok) return materialized;
  if (materialized.value.status !== "available" || typeof materialized.value.content !== "string") {
    return llmGatewayErr({
      code: "artifact_unavailable",
      message: `compiled message list artifact is ${materialized.value.status}`
    });
  }
  return parseMessageArtifact(materialized.value.content, artifactRef);
}

function parseMessageArtifact(content: string, artifactRef: ArtifactRef): Result<ResolvedMessages> {
  try {
    const parsed = JSON.parse(content) as { readonly providerNeutralMessages?: unknown };
    if (!Array.isArray(parsed.providerNeutralMessages)) {
      return llmGatewayErr({ code: "schema_incompatible", message: "compiled message list missing providerNeutralMessages" });
    }
    const messages = parsed.providerNeutralMessages as readonly ProviderNeutralMessage[];
    const valid = validateMessages(messages);
    return valid.ok ? ok({ messages, parentArtifactRefs: [artifactRef] }) : valid;
  } catch (cause) {
    return llmGatewayErr({ code: "schema_incompatible", message: "compiled message list artifact is invalid JSON", cause });
  }
}

function validateMessages(messages: readonly ProviderNeutralMessage[]): Result<void> {
  if (messages.length === 0) {
    return llmGatewayErr({ code: "invalid_input", message: "providerNeutralMessages cannot be empty" });
  }
  for (const message of messages) {
    if (!["system", "user", "assistant"].includes(message.role)) {
      return llmGatewayErr({ code: "schema_incompatible", message: "provider neutral message role is unsupported" });
    }
    if (!Array.isArray(message.content) || message.content.length === 0) {
      return llmGatewayErr({ code: "schema_incompatible", message: "provider neutral message content cannot be empty" });
    }
    if (message.content.some((part) => part.type !== "text" || typeof part.text !== "string")) {
      return llmGatewayErr({ code: "schema_incompatible", message: "provider neutral message content must be text parts" });
    }
  }
  return ok(undefined);
}

import { describe, expect, it } from "vitest";
import {
  buildCapabilitySummary,
  buildRequestPayload,
  createOpenAICompatibleAdapter,
  type FetchLike,
  type OpenAICompatibleConfig
} from "../../src/providers/index.js";
import type { ProviderAdapterContext } from "../../src/llm-gateway/index.js";

const baseConfig: OpenAICompatibleConfig = {
  provider: "deepseek",
  apiKey: "test-key",
  baseUrl: "https://api.deepseek.com/",
  model: "deepseek-v4-pro",
  maxTokens: 1024,
  now: () => "2026-06-07T00:00:00.000Z"
};

function context(extra: Partial<ProviderAdapterContext["request"]> = {}): ProviderAdapterContext {
  return {
    request: {
      requestId: "req-1" as ProviderAdapterContext["request"]["requestId"],
      modelSelection: { provider: "deepseek", model: "deepseek-v4-pro" },
      streaming: false,
      policyDecisionId: "pd-1" as ProviderAdapterContext["request"]["policyDecisionId"],
      source: { kind: "system", origin: "t", userProvided: false, receivedAt: "2026-06-07T00:00:00.000Z", privacyLevel: "workspace_private" },
      version: { schemaVersion: "1.0.0" },
      audit: { createdAt: "2026-06-07T00:00:00.000Z", createdBy: "t", reason: "t" },
      ...extra
    },
    providerRequest: {
      summary: { provider: "deepseek" } as ProviderAdapterContext["providerRequest"]["summary"],
      payload: {},
      providerNeutralMessages: [
        { role: "system", content: [{ type: "text", text: "You are a writer." }] },
        { role: "user", content: [{ type: "text", text: "Write " }, { type: "text", text: "a poem." }] }
      ],
      parentArtifactRefs: []
    }
  };
}

function fakeFetch(impl: FetchLike): FetchLike {
  return impl;
}

describe("openai-compatible adapter", () => {
  it("builds a capability summary with reasoning support by default", () => {
    const summary = buildCapabilitySummary(baseConfig, "deepseek-v4-pro");
    expect(summary.provider).toBe("deepseek");
    expect(summary.supportsReasoningTrace).toBe(true);
    expect(summary.toolCallFormat).toBe("openai_function");
    expect(summary.contextLimit).toBe(65536);
  });

  it("honors explicit reasoning/limit overrides", () => {
    const summary = buildCapabilitySummary({ ...baseConfig, reasoningModel: false, contextLimit: 8, outputLimit: 4 }, "m");
    expect(summary.supportsReasoningTrace).toBe(false);
    expect(summary.contextLimit).toBe(8);
    expect(summary.outputLimit).toBe(4);
  });

  it("flattens provider-neutral messages into a chat payload", () => {
    const payload = buildRequestPayload(baseConfig, context());
    expect(payload.model).toBe("deepseek-v4-pro");
    expect(payload.max_tokens).toBe(1024);
    const messages = payload.messages as { role: string; content: string }[];
    expect(messages[1]?.content).toBe("Write a poem.");
  });

  it("includes tools when the request carries a tool surface", () => {
    const payload = buildRequestPayload(baseConfig, context({
      toolSurfaceSummary: [{
        toolId: "t1" as never,
        name: "write_chapter",
        capabilitySummary: "writes a chapter",
        safeForModel: true
      } as never]
    }));
    expect(Array.isArray(payload.tools)).toBe(true);
  });

  it("posts to the chat completions endpoint and returns parsed json", async () => {
    let captured: { url: string; body: string } | undefined;
    const adapter = createOpenAICompatibleAdapter({
      ...baseConfig,
      fetchImpl: fakeFetch(async (url, init) => {
        captured = { url, body: init.body };
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "ok" } }] }), text: async () => "" };
      })
    });
    const raw = await adapter.send?.(context());
    expect(captured?.url).toBe("https://api.deepseek.com/chat/completions");
    expect(JSON.parse(captured?.body ?? "{}").model).toBe("deepseek-v4-pro");
    expect((raw as { choices: unknown[] }).choices.length).toBe(1);
  });

  it("throws a status-bearing error on non-2xx responses", async () => {
    const adapter = createOpenAICompatibleAdapter({
      ...baseConfig,
      fetchImpl: fakeFetch(async () => ({ ok: false, status: 429, json: async () => ({}), text: async () => "rate limited" }))
    });
    await expect(adapter.send?.(context())).rejects.toMatchObject({ status: 429 });
  });

  it("hard-times out even when fetch ignores abort", async () => {
    let signal: AbortSignal | undefined;
    const adapter = createOpenAICompatibleAdapter({
      ...baseConfig,
      fetchImpl: fakeFetch(async (_url, init) => {
        signal = init.signal;
        return new Promise(() => undefined);
      })
    });

    await expect(adapter.send?.(context({ timeoutMs: 5 }))).rejects.toMatchObject({ code: "timeout" });
    expect(signal?.aborted).toBe(true);
  });

  it("tolerates an unreadable error body", async () => {
    const adapter = createOpenAICompatibleAdapter({
      ...baseConfig,
      fetchImpl: fakeFetch(async () => ({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => {
          throw new Error("stream closed");
        }
      }))
    });
    await expect(adapter.send?.(context())).rejects.toMatchObject({ status: 500 });
  });

  it("exposes capabilities and model listing", async () => {
    const adapter = createOpenAICompatibleAdapter(baseConfig);
    const caps = await adapter.getCapabilities?.("deepseek-v4-pro");
    expect(caps?.model).toBe("deepseek-v4-pro");
    const models = await adapter.listModels?.();
    expect(models?.[0]?.provider).toBe("deepseek");
  });
});

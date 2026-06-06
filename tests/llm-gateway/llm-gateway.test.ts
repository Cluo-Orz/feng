import { describe, expect, it } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import { compileInput, makeContextFixture } from "../context-message-compiler/helpers.js";
import { createGrowAndAgenda } from "../agenda-dod-manager/helpers.js";
import {
  allowProviderPolicy,
  denyProviderPolicy,
  fakeAdapter,
  llmRequest,
  makeGateway,
  messageListRequest,
  parseArtifact
} from "./helpers.js";
import type { ProviderCallReceipt } from "../../src/llm-gateway/index.js";

describe("LLM Gateway", () => {
  it("builds provider request summaries without calling the provider", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const adapter = fakeAdapter();
      const gateway = makeGateway(fixture, [adapter]);
      const policy = await allowProviderPolicy(fixture);

      const built = await gateway.buildProviderRequest(llmRequest(fixture, policy));

      expect(built.ok).toBe(true);
      if (!built.ok) throw new Error(built.error.message);
      expect(built.value.provider).toBe("fake");
      expect(built.value.messageCount).toBe(1);
      expect(adapter.calls()).toBe(0);
    });
  });

  it("rejects unsupported required capabilities instead of downgrading", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const adapter = fakeAdapter({ capabilities: { supportsStructuredOutput: "unsupported" } });
      const gateway = makeGateway(fixture, [adapter]);
      const policy = await allowProviderPolicy(fixture);

      const result = await gateway.buildProviderRequest(
        llmRequest(fixture, policy, { requiredCapabilities: { structuredOutput: true } })
      );

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.error.code).toBe("model_capability_unsupported");
    });
  });

  it("sends requests, normalizes tool calls, and writes a receipt artifact", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const adapter = fakeAdapter({
        rawResponses: [{
          choices: [{
            message: {
              content: "need a tool",
              tool_calls: [{
                id: "call-1",
                function: { name: "inspect_world", arguments: "{\"boss\":\"crane\"}" }
              }]
            },
            finish_reason: "tool_calls"
          }],
          usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 }
        }]
      });
      const gateway = makeGateway(fixture, [adapter]);
      const policy = await allowProviderPolicy(fixture);

      const result = await gateway.sendLLMRequest(llmRequest(fixture, policy));

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.finishReason).toBe("tool_calls");
      expect(result.value.toolCallBlocks[0]?.name).toBe("inspect_world");
      expect(adapter.calls()).toBe(1);
      const materialized = await fixture.artifacts.materializeArtifact(result.value.receiptRef!, {
        reason: "read receipt",
        maxBytes: 16 * 1024
      });
      expect(materialized.ok).toBe(true);
      if (!materialized.ok) throw new Error(materialized.error.message);
      const receipt = parseArtifact<ProviderCallReceipt>(materialized.value.content);
      expect(receipt.policyDecisionId).toBe(policy);
      expect(receipt.finishReason).toBe("tool_calls");
    });
  });

  it("does not call provider adapters when policy denies the boundary", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const adapter = fakeAdapter();
      const gateway = makeGateway(fixture, [adapter]);
      const policy = await denyProviderPolicy(fixture);

      const result = await gateway.sendLLMRequest(llmRequest(fixture, policy));

      expect(result.ok).toBe(false);
      expect(adapter.calls()).toBe(0);
    });
  });

  it("retries provider failures and then falls back with a receipt trail", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const primary = fakeAdapter({ errors: [{ status: 429, message: "rate limit" }, { status: 429, message: "rate limit" }] });
      const backup = fakeAdapter({ provider: "backup" });
      const gateway = makeGateway(fixture, [primary, backup]);
      const policy = await allowProviderPolicy(fixture);

      const result = await gateway.sendLLMRequest(llmRequest(fixture, policy, {
        retryPolicy: { maxAttempts: 2 },
        fallbackPolicy: { fallbacks: [{ provider: "backup", model: "backup-model" }] }
      }));

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.provider).toBe("backup");
      expect(primary.calls()).toBe(2);
      expect(backup.calls()).toBe(1);
      const artifact = await fixture.artifacts.materializeArtifact(result.value.receiptRef!, {
        reason: "read fallback receipt",
        maxBytes: 16 * 1024
      });
      if (!artifact.ok) throw new Error(artifact.error.message);
      const receipt = parseArtifact<ProviderCallReceipt>(artifact.value.content);
      expect(receipt.retryCount).toBe(1);
      expect(receipt.fallbackUsed).toBe(true);
    });
  });

  it("streams normalized events and writes a completion receipt", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const adapter = fakeAdapter({
        streamEvents: [
          { choices: [{ delta: { content: "hel" } }] },
          { choices: [{ delta: { content: "lo" } }] },
          { choices: [{ finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }
        ]
      });
      const gateway = makeGateway(fixture, [adapter]);
      const policy = await allowProviderPolicy(fixture);

      const events = [];
      for await (const event of gateway.streamLLMRequest(llmRequest(fixture, policy, { streaming: true }))) events.push(event);

      expect(events.every((event) => event.ok)).toBe(true);
      const values = events.filter((event) => event.ok).map((event) => event.value);
      expect(values.map((event) => event.type)).toEqual(["text_delta", "text_delta", "usage_delta", "response_completed"]);
      expect(values.at(-1)?.type).toBe("response_completed");
      expect(values.at(-1)).toHaveProperty("receiptRef");
    });
  });

  it("returns explicit response_failed events on stream interruption", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const adapter = fakeAdapter({
        streamEvents: [{ choices: [{ delta: { content: "partial" } }] }],
        streamError: new Error("connection reset")
      });
      const gateway = makeGateway(fixture, [adapter]);
      const policy = await allowProviderPolicy(fixture);

      const events = [];
      for await (const event of gateway.streamLLMRequest(llmRequest(fixture, policy, { streaming: true }))) events.push(event);

      const failed = events
        .filter((event) => event.ok)
        .map((event) => event.value)
        .find((event) => event.type === "response_failed");
      expect(failed?.type).toBe("response_failed");
      if (failed?.type !== "response_failed") throw new Error("missing failed stream event");
      expect(failed.errorClassification.code).toBe("stream_interrupted");
      expect(failed).toHaveProperty("receiptRef");
    });
  });

  it("materializes compiled MessageListRef artifacts without compiling prompt content", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const grow = await createGrowAndAgenda(fixture, "xiaoshuo-agent");
      if (!grow.ok) throw new Error(grow.error.message);
      const messageList = await fixture.context.compileMessageList(compileInput(fixture, grow.value));
      if (!messageList.ok) throw new Error(messageList.error.message);
      const adapter = fakeAdapter();
      const gateway = makeGateway(fixture, [adapter]);
      const policy = await allowProviderPolicy(fixture);

      const result = await gateway.sendLLMRequest(messageListRequest(fixture, policy, messageList.value));

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const payload = adapter.builtPayloads()[0] as { readonly messages: readonly { readonly role: string }[] };
      expect(payload.messages[0]?.role).toBe("system");
    });
  });
});

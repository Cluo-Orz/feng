import { describe, expect, it } from "vitest";
import { makeMessageListId, makePolicyDecisionId, makeRef } from "../../src/domain/index.js";
import { createLLMGateway, type LLMProviderAdapter, type NormalizedStreamEvent } from "../../src/llm-gateway/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import { makeContextFixture } from "../context-message-compiler/helpers.js";
import { audit, source, version } from "../agenda-dod-manager/helpers.js";
import {
  allowProviderPolicy,
  fakeAdapter,
  llmRequest,
  makeGateway
} from "./helpers.js";
import { makePolicyRequestId } from "../../src/policy-boundary/index.js";

describe("LLM Gateway edge behavior", () => {
  it("lists providers and returns explicit unknown capabilities for registered adapters", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const adapter: LLMProviderAdapter = { provider: "unknown-provider" };
      const gateway = makeGateway(fixture, [adapter]);

      const listed = await gateway.listProviders();
      const caps = await gateway.getModelCapabilities("unknown-provider", "mystery");

      expect(listed.ok && listed.value.providers).toContain("unknown-provider");
      expect(caps.ok && caps.value.supportsStreaming).toBe("unknown");
      expect(caps.ok && caps.value.knownUnsupportedFeatures.length).toBeGreaterThan(0);
    });
  });

  it("surfaces capability lookup failures as provider_unavailable", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const gateway = makeGateway(fixture, [{
        provider: "broken",
        getCapabilities: async () => { throw new Error("catalog offline"); }
      }]);

      const caps = await gateway.getModelCapabilities("broken", "model");

      expect(caps.ok).toBe(false);
      if (caps.ok) throw new Error("expected failure");
      expect(caps.error.code).toBe("provider_unavailable");
    });
  });

  it("reports every unknown required capability without assuming support", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const gateway = makeGateway(fixture, [{ provider: "unknown-provider" }]);

      const check = await gateway.checkModelCapabilities({
        modelSelection: { provider: "unknown-provider", model: "mystery" },
        requiredCapabilities: {
          streaming: true,
          toolCalls: true,
          structuredOutput: true,
          multimodalInput: true,
          reasoningTrace: true
        }
      });

      expect(check.ok).toBe(true);
      if (!check.ok) throw new Error(check.error.message);
      expect(check.value.compatible).toBe(false);
      expect(check.value.unsupported).toHaveLength(5);
      expect(check.value.warnings).toHaveLength(5);
    });
  });

  it("combines adapter and default capability provider lists", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const capsFn = fakeAdapter({ provider: "catalog" }).getCapabilities;
      if (capsFn === undefined) throw new Error("missing caps");
      const defaultCapability = await capsFn("catalog-model");
      if (defaultCapability === undefined) throw new Error("missing default cap");
      const gateway = createLLMGateway({
        workspace: fixture.workspace,
        ledger: fixture.ledger,
        artifactRegistry: fixture.artifacts,
        policyBoundary: fixture.policy,
        contextCompiler: fixture.context,
        producer: "llm-gateway-test",
        adapters: [{ provider: "adapter-only" }],
        defaultCapabilities: [defaultCapability]
      });

      const listed = await gateway.listProviders();
      const caps = await gateway.getModelCapabilities("catalog", "catalog-model");

      expect(listed.ok && listed.value.providers).toEqual(expect.arrayContaining(["adapter-only", "catalog"]));
      expect(caps.ok && caps.value.provider).toBe("catalog");
    });
  });

  it("rejects policy decisions that allow the wrong capability", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const decision = await fixture.policy.evaluateAction({
        requestId: makePolicyRequestId("wrong-policy-capability"),
        capability: "file.read",
        requestedByModule: "llm-gateway",
        workspace: fixture.workspace.id,
        resourceSummary: "provider:fake",
        operation: "send",
        reason: "wrong capability",
        source: source(fixture, "system")
      }, {
        caller: "llm-gateway",
        environment: {
          hostSandboxAvailable: false,
          networkAvailable: true,
          externalEnforcementAvailable: false,
          secretStoreAvailable: false
        },
        rules: [{ capability: "file.read", resource: "*", verdict: "allow" }]
      });
      if (!decision.ok) throw new Error(decision.error.message);
      const adapter = fakeAdapter();
      const gateway = makeGateway(fixture, [adapter]);

      const result = await gateway.sendLLMRequest(llmRequest(fixture, decision.value.policyDecisionId));

      expect(result.ok).toBe(false);
      expect(adapter.calls()).toBe(0);
      if (result.ok) throw new Error("expected failure");
      expect(result.error.code).toBe("policy_blocked");
    });
  });

  it("validates message list inputs before provider calls", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const policy = await allowProviderPolicy(fixture);
      const messageListRef = makeRef("message_list", makeMessageListId("missing-message-list"));
      const gatewayWithoutContext = createLLMGateway({
        workspace: fixture.workspace,
        ledger: fixture.ledger,
        artifactRegistry: fixture.artifacts,
        policyBoundary: fixture.policy,
        producer: "llm-gateway-test",
        adapters: [fakeAdapter()]
      });

      const baseMissingRequest = llmRequest(fixture, policy);
      const { providerNeutralMessages: _messages, ...missingRequestRest } = baseMissingRequest;
      void _messages;
      const missing = await gatewayWithoutContext.buildProviderRequest({ ...missingRequestRest, messageListRef });
      const empty = await makeGateway(fixture, [fakeAdapter()]).buildProviderRequest(llmRequest(fixture, policy, {
        providerNeutralMessages: []
      }));

      expect(missing.ok).toBe(false);
      if (missing.ok) throw new Error("expected missing message list failure");
      expect(missing.error.code).toBe("artifact_unavailable");
      expect(empty.ok).toBe(false);
      if (empty.ok) throw new Error("expected empty message failure");
      expect(empty.error.code).toBe("invalid_input");

      const badRole = await makeGateway(fixture, [fakeAdapter()]).buildProviderRequest(llmRequest(fixture, policy, {
        providerNeutralMessages: [{ role: "bad" as never, content: [{ type: "text", text: "x" }] }]
      }));
      const badPart = await makeGateway(fixture, [fakeAdapter()]).buildProviderRequest(llmRequest(fixture, policy, {
        providerNeutralMessages: [{ role: "user", content: [{ type: "image" as never, text: "x" }] }]
      }));
      const baseNoInput = llmRequest(fixture, policy);
      const { providerNeutralMessages: _none, ...noInput } = baseNoInput;
      void _none;
      const missingInput = await makeGateway(fixture, [fakeAdapter()]).buildProviderRequest(noInput);
      const emptyContent = await makeGateway(fixture, [fakeAdapter()]).buildProviderRequest(llmRequest(fixture, policy, {
        providerNeutralMessages: [{ role: "user", content: [] }]
      }));
      expect(badRole.ok).toBe(false);
      expect(badPart.ok).toBe(false);
      expect(missingInput.ok).toBe(false);
      expect(emptyContent.ok).toBe(false);
    });
  });

  it("uses the default provider request builder and reports builder failures", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const policy = await allowProviderPolicy(fixture);
      const capsFn = fakeAdapter().getCapabilities;
      if (capsFn === undefined) throw new Error("missing caps");
      const defaultBuilder = makeGateway(fixture, [{
        provider: "fake",
        getCapabilities: capsFn
      }]);
      const throwingBuilder = makeGateway(fixture, [{
        provider: "fake",
        getCapabilities: capsFn,
        buildProviderRequest: async () => { throw new Error("bad request shape"); }
      }]);

      const built = await defaultBuilder.buildProviderRequest(llmRequest(fixture, policy, {
        timeoutMs: 123,
        modelSelection: { provider: "fake", model: "fake-model", modelVersion: "v1" }
      }));
      const failed = await throwingBuilder.buildProviderRequest(llmRequest(fixture, policy));

      expect(built.ok && built.value.requestShape).toBe("provider-neutral-json");
      expect(built.ok && built.value.modelVersion).toBe("v1");
      expect(failed.ok).toBe(false);
      if (failed.ok) throw new Error("expected builder failure");
      expect(failed.error.code).toBe("request_invalid");
    });
  });

  it("rejects missing policy decisions before streaming or sending", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const gateway = makeGateway(fixture, [fakeAdapter()]);
      const request = llmRequest(fixture, makePolicyDecisionId("missing-policy"));

      const sent = await gateway.sendLLMRequest(request);
      const streamed = [];
      for await (const event of gateway.streamLLMRequest({ ...request, streaming: true })) streamed.push(event);
      const preparedFailure = [];
      const allowed = await allowProviderPolicy(fixture);
      for await (const event of gateway.streamLLMRequest(llmRequest(fixture, allowed, {
        streaming: true,
        modelSelection: { provider: "missing-provider", model: "x" }
      }))) preparedFailure.push(event);

      expect(sent.ok).toBe(false);
      if (sent.ok) throw new Error("expected missing policy failure");
      expect(sent.error.code).toBe("policy_blocked");
      expect(streamed[0]?.ok).toBe(false);
      expect(preparedFailure[0]?.ok).toBe(false);
    });
  });

  it("normalizes full responses, stream events, and provider errors through public ports", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const gateway = makeGateway(fixture, [fakeAdapter()]);
      const policy = await allowProviderPolicy(fixture);
      const request = llmRequest(fixture, policy);

      const response = await gateway.normalizeProviderResponse({
        output_text: "visible",
        choices: [{ message: { reasoning: "because", refusal: "no" }, finish_reason: "content_filter" }],
        usage: { inputTokens: 3, outputTokens: 2, reasoningTokens: 1 }
      }, request);
      const stream = await gateway.normalizeProviderStream({ warning: "slow provider" }, request);
      const auth = gateway.normalizeProviderError({ status: 401, message: "invalid api key" }, request);
      const context = gateway.normalizeProviderError(new Error("context length exceeded"), request);
      const internal = gateway.normalizeProviderError({ status: 500, message: "server down" }, request);
      const invalid = gateway.normalizeProviderError({ status: 400, message: "bad request" }, request);
      const network = gateway.normalizeProviderError(new TypeError("fetch network connection failed"), request);
      const structured = gateway.normalizeProviderError({ code: "tool_call_parse_failed", message: "bad args" }, request);

      expect(response.ok && response.value.finishReason).toBe("content_filter");
      expect(response.ok && response.value.contentBlocks.map((block) => block.type)).toContain("reasoning_summary");
      expect(stream.ok && stream.value.type).toBe("provider_warning");
      expect(auth.ok && auth.value.code).toBe("auth_failed");
      expect(context.ok && context.value.code).toBe("context_length_exceeded");
      expect(internal.ok && internal.value.code).toBe("provider_internal_error");
      expect(invalid.ok && invalid.value.code).toBe("request_invalid");
      expect(network.ok && network.value.code).toBe("network_failed");
      expect(structured.ok && structured.value.code).toBe("tool_call_parse_failed");
    });
  });

  it("covers normalization variants for finish reasons, usage aliases, and stream shapes", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const gateway = makeGateway(fixture, [fakeAdapter()]);
      const policy = await allowProviderPolicy(fixture);
      const request = llmRequest(fixture, policy);

      const length = await gateway.normalizeProviderResponse({
        choices: [{ message: { tool_calls: [{ call_id: "c", function: { name: "tool", arguments: { a: 1 } } }] }, finish_reason: "max_tokens" }],
        usage: { input_tokens: 3, output_tokens: 2, cacheReadTokens: 1, cacheWriteTokens: 1 }
      }, request);
      const invalidResponse = await gateway.normalizeProviderResponse("not object", request);
      const normalizedStream = await gateway.normalizeProviderStream({
        type: "response_started",
        requestId: request.requestId
      }, request);
      const reasoningStream = await gateway.normalizeProviderStream({ choices: [{ delta: { reasoning_content: "think" } }] }, request);
      const finishStream = await gateway.normalizeProviderStream({ choices: [{ finish_reason: "length" }] }, request);
      const unknownStream = await gateway.normalizeProviderStream({ strange: true }, request);
      const cancelled = await gateway.normalizeProviderResponse({ choices: [{ message: { content: "x" }, finish_reason: "cancelled" }] }, request);
      const errored = await gateway.normalizeProviderResponse({ choices: [{ message: { content: "x" }, finish_reason: "error" }] }, request);
      const unknownFinish = await gateway.normalizeProviderResponse({ choices: [{ message: { content: "x" }, finish_reason: "weird" }] }, request);

      expect(length.ok && length.value.finishReason).toBe("length");
      expect(length.ok && length.value.toolCallBlocks[0]?.argumentsText).toBe("{\"a\":1}");
      expect(invalidResponse.ok).toBe(false);
      expect(normalizedStream.ok && normalizedStream.value.type).toBe("response_started");
      expect(reasoningStream.ok && reasoningStream.value.type).toBe("reasoning_delta");
      expect(finishStream.ok && finishStream.value.type).toBe("response_completed");
      expect(unknownStream.ok && unknownStream.value.type).toBe("provider_warning");
      expect(cancelled.ok && cancelled.value.finishReason).toBe("cancelled");
      expect(errored.ok && errored.value.finishReason).toBe("error");
      expect(unknownFinish.ok && unknownFinish.value.finishReason).toBe("unknown");
    });
  });

  it("returns failure receipts when adapters cannot send or normalize", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const policy = await allowProviderPolicy(fixture);
      const noSendBase = fakeAdapter();
      const noSend = makeGateway(fixture, [{
        provider: "fake",
        getCapabilities: async (model) => {
          if (noSendBase.getCapabilities === undefined) throw new Error("missing caps");
          return noSendBase.getCapabilities(model);
        },
        buildProviderRequest: async (input) => {
          if (noSendBase.buildProviderRequest === undefined) throw new Error("missing builder");
          return noSendBase.buildProviderRequest(input);
        }
      }]);
      const badNormalizer = makeGateway(fixture, [{
        ...fakeAdapter(),
        normalizeResponse: async () => { throw new Error("bad shape"); }
      }]);

      const missingSend = await noSend.sendLLMRequest(llmRequest(fixture, policy));
      const invalidResponse = await badNormalizer.sendLLMRequest(llmRequest(fixture, policy));

      expect(missingSend.ok).toBe(false);
      expect(invalidResponse.ok).toBe(false);
      if (invalidResponse.ok) throw new Error("expected invalid response");
      expect(invalidResponse.error.code).toBe("response_invalid");
      expect(invalidResponse.error.evidenceRef).toBeDefined();
    });
  });

  it("normalizes streaming tool-call blocks and adapter stream normalizer failures", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const policy = await allowProviderPolicy(fixture);
      const toolStream = makeGateway(fixture, [fakeAdapter({
        streamEvents: [
          { choices: [{ delta: { tool_calls: [{ id: "call-1", function: { name: "look" } }] } }] },
          { choices: [{ delta: { tool_calls: [{ id: "call-1", function: { arguments: "{\"x\":1}" } }] } }] },
          { choices: [{ finish_reason: "tool_calls" }] }
        ]
      })]);
      const badStream = makeGateway(fixture, [{
        ...fakeAdapter({ streamEvents: [{ type: "x" }] }),
        normalizeStreamEvent: async () => { throw new Error("bad stream event"); }
      }]);

      const toolEvents: NormalizedStreamEvent[] = [];
      for await (const event of toolStream.streamLLMRequest(llmRequest(fixture, policy, { streaming: true }))) {
        if (event.ok) toolEvents.push(event.value);
      }
      const badEvents: NormalizedStreamEvent[] = [];
      for await (const event of badStream.streamLLMRequest(llmRequest(fixture, policy, { streaming: true }))) {
        if (event.ok) badEvents.push(event.value);
      }

      expect(toolEvents.map((event) => event.type)).toContain("tool_call_started");
      expect(toolEvents.map((event) => event.type)).toContain("tool_call_delta");
      const failed = badEvents.find((event) => event.type === "response_failed");
      expect(failed?.type).toBe("response_failed");
      if (failed?.type !== "response_failed") throw new Error("expected failed stream");
      expect(failed.errorClassification.code).toBe("response_invalid");
    });
  });

  it("returns stream failures when preparation succeeds but adapter streaming is absent", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const policy = await allowProviderPolicy(fixture);
      const capsFn = fakeAdapter().getCapabilities;
      if (capsFn === undefined) throw new Error("missing caps");
      const gateway = makeGateway(fixture, [{
        provider: "fake",
        getCapabilities: capsFn,
        buildProviderRequest: async ({ messages }) => ({ payload: { messages } })
      }]);

      const events = [];
      for await (const event of gateway.streamLLMRequest(llmRequest(fixture, policy, { streaming: true }))) events.push(event);

      const failed = events.find((event) => event.ok && event.value.type === "response_failed");
      expect(failed?.ok).toBe(true);
    });
  });
});

import {
  createLLMGateway,
  makeLLMRequestId,
  type LLMGateway,
  type LLMProviderAdapter,
  type LLMRequest,
  type ModelCapabilitySummary
} from "../../src/llm-gateway/index.js";
import { makePolicyRequestId, type PolicyContext } from "../../src/policy-boundary/index.js";
import type { ContextFixture } from "../context-message-compiler/helpers.js";
import { audit, source, version } from "../agenda-dod-manager/helpers.js";
import type { PolicyDecisionId, MessageListRef } from "../../src/domain/index.js";

let requestSeq = 0;
let policySeq = 0;

export interface FakeAdapter extends LLMProviderAdapter {
  readonly calls: () => number;
  readonly builtPayloads: () => readonly unknown[];
}

export function makeGateway(fixture: ContextFixture, adapters: readonly LLMProviderAdapter[]): LLMGateway {
  return createLLMGateway({
    workspace: fixture.workspace,
    ledger: fixture.ledger,
    artifactRegistry: fixture.artifacts,
    policyBoundary: fixture.policy,
    contextCompiler: fixture.context,
    producer: "llm-gateway-test",
    adapters
  });
}

export function fakeAdapter(input: {
  readonly provider?: string;
  readonly rawResponses?: readonly unknown[];
  readonly errors?: readonly unknown[];
  readonly streamEvents?: readonly unknown[];
  readonly streamError?: unknown;
  readonly capabilities?: Partial<ModelCapabilitySummary>;
} = {}): FakeAdapter {
  const provider = input.provider ?? "fake";
  const built: unknown[] = [];
  let calls = 0;
  const responses = [...(input.rawResponses ?? [defaultResponse(provider)])];
  const errors = [...(input.errors ?? [])];
  return {
    provider,
    calls: () => calls,
    builtPayloads: () => built,
    getCapabilities: async (model) => capability(provider, model, input.capabilities),
    buildProviderRequest: async ({ request, messages, tools }) => {
      const payload = { provider, model: request.modelSelection.model, messages, tools, stream: request.streaming };
      built.push(payload);
      return { payload, requestShape: "fake-json", preview: `fake ${messages.length} messages` };
    },
    send: async () => {
      calls += 1;
      const nextError = errors.shift();
      if (nextError !== undefined) throw nextError;
      return responses.shift() ?? defaultResponse(provider);
    },
    stream: async function* () {
      calls += 1;
      for (const event of input.streamEvents ?? []) yield event;
      if (input.streamError !== undefined) throw input.streamError;
    }
  };
}

export async function allowProviderPolicy(fixture: ContextFixture): Promise<PolicyDecisionId> {
  const decision = await fixture.policy.evaluateAction(policyRequest(fixture, "external_service.call"), policyContext("allow"));
  if (!decision.ok) throw new Error(decision.error.message);
  return decision.value.policyDecisionId;
}

export async function denyProviderPolicy(fixture: ContextFixture): Promise<PolicyDecisionId> {
  const decision = await fixture.policy.evaluateAction(policyRequest(fixture, "external_service.call"), policyContext("deny"));
  if (!decision.ok) throw new Error(decision.error.message);
  return decision.value.policyDecisionId;
}

export function llmRequest(
  fixture: ContextFixture,
  policyDecisionId: PolicyDecisionId,
  extra: Partial<LLMRequest> = {}
): LLMRequest {
  requestSeq += 1;
  return {
    requestId: makeLLMRequestId(`llm-request-${requestSeq}`),
    providerNeutralMessages: [{ role: "user", content: [{ type: "text", text: "Grow a boss agent." }] }],
    modelSelection: { provider: "fake", model: "fake-model" },
    requiredCapabilities: {},
    streaming: false,
    policyDecisionId,
    source: source(fixture, "system"),
    version,
    audit: audit("call llm"),
    ...extra
  };
}

export function messageListRequest(
  fixture: ContextFixture,
  policyDecisionId: PolicyDecisionId,
  messageListRef: MessageListRef
): LLMRequest {
  const request = llmRequest(fixture, policyDecisionId);
  const { providerNeutralMessages: _messages, ...rest } = request;
  void _messages;
  return { ...rest, messageListRef };
}

export function parseArtifact<T>(content: string | Uint8Array | undefined): T {
  if (typeof content !== "string") throw new Error("expected string artifact");
  return JSON.parse(content) as T;
}

function capability(
  provider: string,
  model: string,
  extra: Partial<ModelCapabilitySummary> = {}
): ModelCapabilitySummary {
  return {
    provider,
    model,
    contextLimit: 128_000,
    outputLimit: 8_192,
    supportsStreaming: true,
    supportsToolCalls: true,
    supportsStructuredOutput: true,
    supportsMultimodalInput: false,
    supportsReasoningTrace: true,
    toolCallFormat: "openai_function",
    requestLimits: {},
    knownUnsupportedFeatures: [],
    source: {
      kind: "system",
      origin: "llm-gateway-test",
      userProvided: false,
      receivedAt: "2026-06-06T00:00:00.000Z",
      privacyLevel: "workspace_private"
    },
    version,
    audit: audit("capability"),
    ...extra
  };
}

function defaultResponse(provider: string): unknown {
  return {
    id: "response-1",
    model: `${provider}-model`,
    choices: [{ message: { content: "done" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }
  };
}

function policyRequest(fixture: ContextFixture, capabilityName: string) {
  policySeq += 1;
  return {
    requestId: makePolicyRequestId(`llm-policy-${policySeq}`),
    capability: capabilityName,
    requestedByModule: "llm-gateway",
    workspace: fixture.workspace.id,
    resourceSummary: "provider:fake",
    operation: "send",
    reason: "unit test provider call",
    source: source(fixture, "system")
  };
}

function policyContext(verdict: "allow" | "deny"): PolicyContext {
  return {
    caller: "llm-gateway",
    environment: {
      hostSandboxAvailable: false,
      networkAvailable: true,
      externalEnforcementAvailable: false,
      secretStoreAvailable: false
    },
    rules: [{ capability: "external_service.call", resource: "*", verdict }]
  };
}

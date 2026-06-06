import {
  createGrowAttemptRunner,
  type GrowAttemptRunner
} from "../../src/grow-attempt-runner/index.js";
import { createLLMGateway, type LLMProviderAdapter } from "../../src/llm-gateway/index.js";
import {
  createToolRuntime,
  type RegisterToolInput,
  type ToolImplementation,
  type ToolRuntime
} from "../../src/tool-runtime/index.js";
import type { PolicyContext } from "../../src/policy-boundary/index.js";
import type { TempWorkspace } from "../file-store/helpers.js";
import {
  makeContextFixture,
  type ContextFixture
} from "../context-message-compiler/helpers.js";
import { audit, source, version } from "../agenda-dod-manager/helpers.js";

export interface AttemptFixture extends ContextFixture {
  readonly llm: ReturnType<typeof createLLMGateway>;
  readonly toolsRuntime: ToolRuntime;
  readonly runner: GrowAttemptRunner;
}

export function makeAttemptFixture(
  workspace: TempWorkspace,
  adapter: LLMProviderAdapter = fakeAdapter()
): AttemptFixture {
  const fixture = makeContextFixture(workspace);
  const toolsRuntime = createToolRuntime({
    workspace: fixture.workspace,
    store: fixture.store,
    ledger: fixture.ledger,
    artifactRegistry: fixture.artifacts,
    policyBoundary: fixture.policy,
    skillRegistry: fixture.skills,
    producer: "attempt-test",
    implementations: [echoImplementation()],
    defaultTimeoutMs: 500
  });
  const llm = createLLMGateway({
    workspace: fixture.workspace,
    ledger: fixture.ledger,
    artifactRegistry: fixture.artifacts,
    policyBoundary: fixture.policy,
    contextCompiler: fixture.context,
    producer: "attempt-test",
    adapters: [adapter]
  });
  return {
    ...fixture,
    llm,
    toolsRuntime,
    runner: createGrowAttemptRunner({
      workspace: fixture.workspace,
      store: fixture.store,
      ledger: fixture.ledger,
      artifactRegistry: fixture.artifacts,
      policyBoundary: fixture.policy,
      growUnitManager: fixture.grow,
      admissionInbox: fixture.admission,
      agendaDoDManager: fixture.agenda,
      contextCompiler: fixture.context,
      llmGateway: llm,
      toolRuntime: toolsRuntime,
      producer: "attempt-test"
    })
  };
}

export function fakeAdapter(responses: readonly unknown[] = [textResponse("done")]): LLMProviderAdapter & { calls: () => number } {
  const queue = [...responses];
  let calls = 0;
  return {
    provider: "fake",
    calls: () => calls,
    getCapabilities: async (model) => ({
      provider: "fake",
      model,
      contextLimit: 128_000,
      outputLimit: 8_192,
      supportsStreaming: true,
      supportsToolCalls: true,
      supportsStructuredOutput: true,
      supportsMultimodalInput: false,
      supportsReasoningTrace: false,
      toolCallFormat: "openai_function",
      requestLimits: {},
      knownUnsupportedFeatures: [],
      source: sourceForAdapter(),
      version,
      audit: audit("model capability")
    }),
    buildProviderRequest: async ({ request, messages, tools }) => ({
      payload: { model: request.modelSelection.model, messages, tools },
      requestShape: "fake-chat",
      preview: `messages=${messages.length}; tools=${tools.length}`
    }),
    send: async () => {
      calls += 1;
      return queue.shift() ?? textResponse("done");
    },
    stream: async function* (context) {
      calls += 1;
      yield { type: "text_delta", requestId: context.request.requestId, text: "streamed" };
      yield {
        type: "response_completed",
        requestId: context.request.requestId,
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 2
        },
        finishReason: "stop"
      };
    }
  };
}

export function textResponse(text: string): unknown {
  return {
    choices: [{ message: { content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }
  };
}

export function toolResponse(name = "test.echo"): unknown {
  return {
    choices: [{
      message: {
        content: "",
        tool_calls: [{ id: "call-1", function: { name, arguments: JSON.stringify({ prompt: "hello" }) } }]
      },
      finish_reason: "tool_calls"
    }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }
  };
}

export function allowAllPolicy(): PolicyContext {
  return {
    caller: "attempt-test",
    environment: {
      hostSandboxAvailable: true,
      networkAvailable: true,
      externalEnforcementAvailable: true,
      secretStoreAvailable: true
    },
    rules: [
      { capability: "external_service.call", resource: "*", verdict: "allow" },
      { capability: "file.read", resource: "*", verdict: "allow" },
      { capability: "runtime.target_action", resource: "*", verdict: "allow" }
    ]
  };
}

export function denyProviderPolicy(): PolicyContext {
  return {
    ...allowAllPolicy(),
    rules: [{ capability: "external_service.call", resource: "*", verdict: "deny" }]
  };
}

export function echoToolInput(fixture: AttemptFixture): RegisterToolInput {
  return {
    name: "echo",
    namespace: "test",
    version,
    lifecycle: "active",
    sourceKind: "system_default",
    source: source(fixture, "system"),
    description: "Echo prompt.",
    inputSchema: {
      type: "object",
      properties: { prompt: { type: "string" } },
      required: ["prompt"],
      additionalProperties: false
    },
    outputSchemaSummary: "echoed prompt",
    declaredCapabilities: ["file.read"],
    risk: "low",
    sideEffects: {
      mutatesWorkspace: false,
      mutatesExternalWorld: false,
      readsSecrets: false,
      networkAccess: false,
      summary: "read-only echo"
    },
    implementation: { kind: "host_function", implementationId: "echo" },
    audit: audit("register echo")
  };
}

export function echoImplementation(): ToolImplementation {
  return {
    implementationId: "echo",
    execute: ({ input }) => ({ stdout: `echo:${String((input as { prompt?: string }).prompt ?? "")}` })
  };
}

function sourceForAdapter() {
  return {
    kind: "system" as const,
    origin: "attempt-test",
    userProvided: false,
    receivedAt: "2026-06-06T00:00:00.000Z",
    privacyLevel: "workspace_private" as const
  };
}

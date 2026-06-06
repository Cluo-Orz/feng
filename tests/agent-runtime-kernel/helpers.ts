import { createAgentRuntimeKernel, type AgentRuntimeKernel } from "../../src/agent-runtime-kernel/index.js";
import { createLLMGateway, type LLMProviderAdapter, type ModelCapabilitySummary } from "../../src/llm-gateway/index.js";
import { createToolRuntime, type RegisterToolInput, type ToolImplementation, type ToolRuntime } from "../../src/tool-runtime/index.js";
import type { HatchPackageRef, TargetWorldRef } from "../../src/domain/index.js";
import type { PolicyContext } from "../../src/policy-boundary/index.js";
import type { TempWorkspace } from "../file-store/helpers.js";
import {
  allowHatchPublish,
  audit,
  contractInput,
  createGrowAgendaDod,
  policy,
  readyVerdict,
  source,
  version
} from "../runtime-contract-registry/helpers.js";
import { hatchInput } from "../hatch-builder/helpers.js";
import { makeTargetFixture, registerGameWorld, type TargetFixture } from "../target-world-adapter/helpers.js";

export interface AgentRuntimeFixture extends TargetFixture {
  readonly agentRuntime: AgentRuntimeKernel;
  readonly toolRuntime: ToolRuntime;
  readonly adapterCalls: () => number;
}

export function makeAgentRuntimeFixture(
  workspace: TempWorkspace,
  responses: readonly unknown[] = [actionResponse()]
): AgentRuntimeFixture {
  const fixture = makeTargetFixture(workspace);
  const adapter = fakeAdapter(responses);
  const toolRuntime = createToolRuntime({
    workspace: fixture.workspace,
    store: fixture.store,
    ledger: fixture.ledger,
    artifactRegistry: fixture.artifacts,
    policyBoundary: fixture.policy,
    skillRegistry: fixture.skills,
    producer: "agent-runtime-test",
    implementations: [echoImplementation()]
  });
  const llmGateway = createLLMGateway({
    workspace: fixture.workspace,
    ledger: fixture.ledger,
    artifactRegistry: fixture.artifacts,
    policyBoundary: fixture.policy,
    producer: "agent-runtime-test",
    adapters: [adapter]
  });
  return {
    ...fixture,
    toolRuntime,
    agentRuntime: createAgentRuntimeKernel({
      workspace: fixture.workspace,
      store: fixture.store,
      ledger: fixture.ledger,
      artifactRegistry: fixture.artifacts,
      policyBoundary: fixture.policy,
      runtimeContractRegistry: fixture.contracts,
      hatchBuilder: fixture.hatch,
      llmGateway,
      toolRuntime,
      targetWorldAdapter: fixture.target,
      producer: "agent-runtime-test",
      runtimeKernelVersion: "agent-runtime-test@1"
    }),
    adapterCalls: adapter.calls
  };
}

export async function buildAgentPackage(fixture: AgentRuntimeFixture, publish = false) {
  const setup = await createGrowAgendaDod(fixture);
  if (!setup.ok) return setup;
  const verdict = await readyVerdict(fixture, setup.value.growUnitRef, setup.value.dodRef);
  if (!verdict.ok) return verdict;
  const contract = await fixture.contracts.registerRuntimeContract(contractInput(fixture, setup.value.growUnitRef, {
    runtimeKernelType: "standard_agent_kernel",
    evidenceRefs: verdict.value.evidenceArtifactRefs,
    readinessVerdictRef: verdict.value.readinessVerdictRef
  }));
  if (!contract.ok) return contract;
  const verified = await fixture.contracts.verifyRuntimeContractForHatch(contract.value, verdict.value.readinessVerdictRef);
  if (!verified.ok) return verified;
  const locked = await fixture.contracts.lockRuntimeContractForHatch(contract.value, {
    reason: "lock agent runtime contract",
    policyContext: allowHatchPublish()
  });
  if (!locked.ok) return locked;
  const request = await fixture.hatch.requestHatch(hatchInput(fixture, {
    growUnitRef: setup.value.growUnitRef,
    readinessVerdictRef: verdict.value.readinessVerdictRef,
    runtimeContractRef: contract.value
  }, {
    packageName: "boss-agent-runtime",
    targetPackageKind: "agent_runtime"
  }));
  if (!request.ok) return request;
  const plan = await fixture.hatch.buildHatchPlan(request.value, allowHatchPublish());
  if (!plan.ok) return plan;
  const pkg = await fixture.hatch.buildHatchPackage(plan.value.hatchBuildPlanRef);
  if (!pkg.ok || !publish) return pkg;
  const published = await fixture.hatch.publishLocalHatchPackage(pkg.value, {
    reason: "publish for production runtime",
    policyContext: allowHatchPublish()
  });
  return published.ok ? { ok: true as const, value: pkg.value } : published;
}

export async function buildWorldInput(fixture: AgentRuntimeFixture, pkg: HatchPackageRef, targetWorldRef: TargetWorldRef) {
  const packageRecord = await fixture.hatch.getHatchPackage(pkg);
  if (!packageRecord.ok) return packageRecord;
  return fixture.target.normalizeWorldInput({
    targetWorldRef,
    runtimeContractRef: packageRecord.value.runtimeContractRef,
    hatchPackageRef: pkg,
    inputKind: "tick_state",
    normalizedInput: { tick: 7, boss: { hp: 40, phase: "rage" }, player: { distance: 3 } },
    privacyClass: "workspace_private",
    correlationId: "tick-7",
    source: source(fixture, "target_world"),
    audit: audit("normalize tick")
  });
}

export async function readyAgentRuntime(fixture: AgentRuntimeFixture, publish = false) {
  const pkg = await buildAgentPackage(fixture, publish);
  if (!pkg.ok) return pkg;
  const world = await registerGameWorld(fixture);
  if (!world.ok) return world;
  const input = await buildWorldInput(fixture, pkg.value, world.value.targetWorldRef);
  if (!input.ok) return input;
  return { ok: true as const, value: { hatchPackageRef: pkg.value, targetWorldRef: world.value.targetWorldRef, worldInputRef: input.value.worldInputRef } };
}

export function allowRuntimePolicy(): PolicyContext {
  return policy([{ capability: "*", resource: "*", verdict: "allow" }]);
}

export function denyRuntimePolicy(capability = "*"): PolicyContext {
  return policy([{ capability, resource: "*", verdict: "deny" }]);
}

export function echoToolInput(fixture: AgentRuntimeFixture): RegisterToolInput {
  return {
    name: "echo",
    namespace: "test",
    version,
    lifecycle: "active",
    sourceKind: "system_default",
    source: source(fixture, "system"),
    description: "Echoes runtime prompt input.",
    inputSchema: {
      type: "object",
      properties: { prompt: { type: "string" } },
      required: ["prompt"],
      additionalProperties: false
    },
    outputSchemaSummary: "echo output",
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
    privacyClass: "workspace_private",
    audit: audit("register runtime echo tool")
  };
}

export { audit, source, version };

export function actionResponse() {
  return {
    id: "runtime-response-1",
    model: "fake-model",
    choices: [{
      message: {
        content: JSON.stringify({
          outputKind: "action_event",
          content: { decision: "attack close player" },
          actions: [{ actionKind: "attack", actionPayload: { style: "slash" }, resourceSummary: "boss attack" }]
        })
      },
      finish_reason: "stop"
    }],
    usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 }
  };
}

export function toolCallResponse() {
  return {
    id: "runtime-response-tool",
    model: "fake-model",
    choices: [{
      message: {
        content: "",
        tool_calls: [{
          id: "tool-call-1",
          function: { name: "test.echo", arguments: JSON.stringify({ prompt: "scan arena" }) }
        }]
      },
      finish_reason: "tool_calls"
    }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }
  };
}

function fakeAdapter(rawResponses: readonly unknown[]): LLMProviderAdapter & { readonly calls: () => number } {
  const responses = [...rawResponses];
  let calls = 0;
  return {
    provider: "fake",
    calls: () => calls,
    getCapabilities: async (model) => capability(model),
    send: async () => {
      calls += 1;
      return responses.shift() ?? actionResponse();
    }
  };
}

function capability(model: string): ModelCapabilitySummary {
  return {
    provider: "fake",
    model,
    contextLimit: 128000,
    outputLimit: 8192,
    supportsStreaming: true,
    supportsToolCalls: true,
    supportsStructuredOutput: true,
    supportsMultimodalInput: false,
    supportsReasoningTrace: false,
    toolCallFormat: "openai_function",
    requestLimits: {},
    knownUnsupportedFeatures: [],
    source: {
      kind: "system",
      origin: "agent-runtime-test",
      userProvided: false,
      receivedAt: "2026-06-06T00:00:00.000Z",
      privacyLevel: "workspace_private"
    },
    version,
    audit: audit("fake model capability")
  };
}

function echoImplementation(): ToolImplementation {
  return {
    implementationId: "echo",
    execute: ({ input }) => ({ structuredOutput: { echoed: String((input as { prompt?: unknown }).prompt ?? "") } })
  };
}

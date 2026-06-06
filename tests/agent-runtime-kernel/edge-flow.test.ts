import { describe, expect, it } from "vitest";
import { makeRuntimeTurnId, runtimeTurnRef } from "../../src/agent-runtime-kernel/index.js";
import type { HatchPackageRef, TargetWorldRef } from "../../src/domain/index.js";
import { makeLLMRequestId } from "../../src/llm-gateway/index.js";
import type { WorldInputEnvelopeRef } from "../../src/target-world-adapter/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import { buildTargetPackage, lockedContractSetup, registerGameWorld } from "../target-world-adapter/helpers.js";
import {
  allowRuntimePolicy,
  audit,
  denyRuntimePolicy,
  makeAgentRuntimeFixture,
  readyAgentRuntime,
  source,
  toolCallResponse,
  version
} from "./helpers.js";

describe("Agent Runtime Kernel edge flow", () => {
  it("rejects non-LLM hatch packages", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgentRuntimeFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const pkg = await buildTargetPackage(fixture, setup.value);
      expect(pkg.ok).toBe(true);
      if (!pkg.ok) throw new Error(pkg.error.message);
      const world = await registerGameWorld(fixture);
      expect(world.ok).toBe(true);
      if (!world.ok) throw new Error(world.error.message);
      const started = await fixture.agentRuntime.startRuntimeInvocation({
        hatchPackageRef: pkg.value,
        targetWorldRef: world.value.targetWorldRef,
        mode: "debug",
        modelSelection: { provider: "fake", model: "fake-model" },
        source: source(fixture, "runtime"),
        version,
        audit: audit("start non llm")
      });
      expect(started.ok).toBe(false);
      if (started.ok) throw new Error("non llm runtime should fail");
      expect(started.error.code).toBe("runtime_kernel_unsupported");
    });
  });

  it("supports direct message compilation and completion lifecycle", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgentRuntimeFixture(workspace);
      const ready = await readyAgentRuntime(fixture);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const invocation = await startDebug(fixture, ready.value);
      const turnRef = runtimeTurnRef(makeRuntimeTurnId("manual-runtime-turn"));
      const message = await fixture.agentRuntime.compileRuntimeMessageList({
        invocationRef: invocation,
        turnRef,
        worldInputRef: ready.value.worldInputRef
      });
      expect(message.ok).toBe(true);
      if (!message.ok) throw new Error(message.error.message);
      const explained = await fixture.agentRuntime.explainRuntimeMessageList(message.value);
      expect(explained.ok).toBe(true);
      const completed = await fixture.agentRuntime.completeRuntimeInvocation(invocation, "manual complete");
      expect(completed.ok).toBe(true);
      const second = await fixture.agentRuntime.completeRuntimeInvocation(invocation, "again");
      expect(second.ok).toBe(false);
      if (second.ok) throw new Error("second complete should fail");
      expect(second.error.code).toBe("invalid_state");
    });
  });

  it("cancels a running invocation", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgentRuntimeFixture(workspace);
      const ready = await readyAgentRuntime(fixture);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const invocation = await startDebug(fixture, ready.value);
      const cancelled = await fixture.agentRuntime.cancelRuntimeInvocation(invocation, "stop");
      expect(cancelled.ok).toBe(true);
      if (!cancelled.ok) throw new Error(cancelled.error.message);
      expect(cancelled.value.to).toBe("cancelled");
    });
  });

  it("fails replay mode without replay response and accepts replay response", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgentRuntimeFixture(workspace);
      const ready = await readyAgentRuntime(fixture);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const missing = await fixture.agentRuntime.runRuntimeTurn(
        await startReplay(fixture, ready.value),
        ready.value.worldInputRef
      );
      expect(missing.ok).toBe(false);
      if (missing.ok) throw new Error("missing replay response should fail");
      expect(missing.error.code).toBe("invalid_input");
      const replay = await fixture.agentRuntime.runRuntimeTurn(
        await startReplay(fixture, ready.value),
        ready.value.worldInputRef,
        { replayResponse: replayResponse() }
      );
      expect(replay.ok).toBe(true);
      if (!replay.ok) throw new Error(replay.error.message);
      expect(replay.value.status).toBe("completed");
    });
  });

  it("records policy and tool boundary failures", async () => {
    await withWorkspace(async (workspace) => {
      const deniedFixture = makeAgentRuntimeFixture(workspace);
      const ready = await readyAgentRuntime(deniedFixture);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const denied = await deniedFixture.agentRuntime.runRuntimeTurn(
        await startDebug(deniedFixture, ready.value),
        ready.value.worldInputRef,
        { policyContext: denyRuntimePolicy("external_service.call") }
      );
      expect(denied.ok).toBe(false);
      if (denied.ok) throw new Error("denied policy should fail");
      expect(denied.error.code).toBe("policy_blocked");
    });
    await withWorkspace(async (workspace) => {
      const fixture = makeAgentRuntimeFixture(workspace, [toolCallResponse()]);
      const ready = await readyAgentRuntime(fixture);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const missingTool = await fixture.agentRuntime.runRuntimeTurn(
        await startDebug(fixture, ready.value),
        ready.value.worldInputRef,
        { policyContext: allowRuntimePolicy() }
      );
      expect(missingTool.ok).toBe(false);
      if (missingTool.ok) throw new Error("missing tool should fail");
      expect(missingTool.error.code).toBe("tool_unavailable");
    });
  });
});

async function startDebug(fixture: ReturnType<typeof makeAgentRuntimeFixture>, ready: ReadyRuntime) {
  const invocation = await fixture.agentRuntime.startRuntimeInvocation({
    hatchPackageRef: ready.hatchPackageRef,
    targetWorldRef: ready.targetWorldRef,
    mode: "debug",
    modelSelection: { provider: "fake", model: "fake-model" },
    source: source(fixture, "runtime"),
    version,
    audit: audit("start debug")
  });
  if (!invocation.ok) throw new Error(invocation.error.message);
  return invocation.value;
}

async function startReplay(fixture: ReturnType<typeof makeAgentRuntimeFixture>, ready: ReadyRuntime) {
  const invocation = await fixture.agentRuntime.startRuntimeInvocation({
    hatchPackageRef: ready.hatchPackageRef,
    targetWorldRef: ready.targetWorldRef,
    mode: "replay",
    modelSelection: { provider: "fake", model: "fake-model" },
    source: source(fixture, "runtime"),
    version,
    audit: audit("start replay")
  });
  if (!invocation.ok) throw new Error(invocation.error.message);
  return invocation.value;
}

function replayResponse() {
  return {
    requestId: makeLLMRequestId("replay-request"),
    provider: "fake",
    model: "fake-model",
    contentBlocks: [{ type: "text" as const, text: JSON.stringify({ outputKind: "action_event", content: { decision: "idle" } }) }],
    toolCallBlocks: [],
    usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 2 },
    finishReason: "stop" as const,
    providerMetadataSummary: {},
    source: {
      kind: "runtime" as const,
      origin: "agent-runtime-test",
      userProvided: false,
      receivedAt: "2026-06-06T00:00:00.000Z",
      privacyLevel: "workspace_private" as const
    },
    audit: audit("replay response")
  };
}

interface ReadyRuntime {
  readonly hatchPackageRef: HatchPackageRef;
  readonly targetWorldRef: TargetWorldRef;
  readonly worldInputRef: WorldInputEnvelopeRef;
}

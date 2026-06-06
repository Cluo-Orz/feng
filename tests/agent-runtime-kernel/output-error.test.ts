import { describe, expect, it } from "vitest";
import { AgentRuntimeStorage } from "../../src/agent-runtime-kernel/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import {
  allowRuntimePolicy,
  audit,
  echoToolInput,
  makeAgentRuntimeFixture,
  readyAgentRuntime,
  source,
  version
} from "./helpers.js";

describe("Agent Runtime Kernel output and error branches", () => {
  it("uses external enforcement for target action dispatch", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgentRuntimeFixture(workspace);
      const ready = await readyAgentRuntime(fixture);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const invocation = await start(fixture, ready.value);
      const turn = await fixture.agentRuntime.runRuntimeTurn(invocation, ready.value.worldInputRef, {
        policyContext: allowRuntimePolicy(),
        externalEnforcement: { enforcedBy: "game-engine-test", summary: "host validates action" },
        dispatchTargetActions: true
      });
      expect(turn.ok).toBe(true);
      if (!turn.ok) throw new Error(turn.error.message);
      expect(turn.value.targetActionRequestRefs).toHaveLength(1);
    });
  });

  it("fails unsupported output kind and forbidden target action", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgentRuntimeFixture(workspace, [noKindResponse()]);
      const ready = await readyAgentRuntime(fixture);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const badKind = await fixture.agentRuntime.runRuntimeTurn(await start(fixture, ready.value), ready.value.worldInputRef, {
        policyContext: allowRuntimePolicy(),
        outputKind: "text_result"
      });
      expect(badKind.ok).toBe(false);
      if (badKind.ok) throw new Error("bad kind should fail");
      expect(badKind.error.code).toBe("runtime_output_invalid");
    });
    await withWorkspace(async (workspace) => {
      const fixture = makeAgentRuntimeFixture(workspace, [forbiddenActionResponse()]);
      const ready = await readyAgentRuntime(fixture);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const forbidden = await fixture.agentRuntime.runRuntimeTurn(await start(fixture, ready.value), ready.value.worldInputRef, {
        policyContext: allowRuntimePolicy()
      });
      expect(forbidden.ok).toBe(false);
      if (forbidden.ok) throw new Error("forbidden action should fail");
      expect(forbidden.error.code).toBe("contract_incompatible");
    });
  });

  it("records provider and tool validation failures without bypassing runtime storage", async () => {
    await withWorkspace(async (workspace) => {
      const providerFixture = makeAgentRuntimeFixture(workspace, ["bad response"]);
      const ready = await readyAgentRuntime(providerFixture);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const failed = await providerFixture.agentRuntime.runRuntimeTurn(await start(providerFixture, ready.value), ready.value.worldInputRef, {
        policyContext: allowRuntimePolicy()
      });
      expect(failed.ok).toBe(false);
      if (failed.ok) throw new Error("provider should fail");
      expect(failed.error.code).toBe("response_invalid");
    });
    await withWorkspace(async (workspace) => {
      const fixture = makeAgentRuntimeFixture(workspace, [invalidToolArgumentsResponse()]);
      const tool = await fixture.toolRuntime.registerTool(echoToolInput(fixture));
      expect(tool.ok).toBe(true);
      if (!tool.ok) throw new Error(tool.error.message);
      const ready = await readyAgentRuntime(fixture);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const turn = await fixture.agentRuntime.runRuntimeTurn(await start(fixture, ready.value), ready.value.worldInputRef, {
        policyContext: allowRuntimePolicy()
      });
      expect(turn.ok).toBe(true);
      if (!turn.ok) throw new Error(turn.error.message);
      expect(turn.value.toolSettlementRefs).toHaveLength(1);
      const storage = new AgentRuntimeStorage(fixture.store, fixture.workspace);
      expect((await storage.readTurn(turn.value.runtimeTurnRef)).ok).toBe(true);
      expect((await storage.readOutput({ kind: "runtime_output", id: "missing" as never })).ok).toBe(false);
      expect((await storage.readTrace({ kind: "runtime_trace", id: "missing" as never })).ok).toBe(false);
    });
  });
});

async function start(fixture: ReturnType<typeof makeAgentRuntimeFixture>, ready: ReadyRuntime) {
  const invocation = await fixture.agentRuntime.startRuntimeInvocation({
    hatchPackageRef: ready.hatchPackageRef,
    targetWorldRef: ready.targetWorldRef,
    mode: "debug",
    modelSelection: { provider: "fake", model: "fake-model" },
    source: source(fixture, "runtime"),
    version,
    audit: audit("start output error")
  });
  if (!invocation.ok) throw new Error(invocation.error.message);
  return invocation.value;
}

function forbiddenActionResponse() {
  return {
    id: "runtime-response-forbidden",
    model: "fake-model",
    choices: [{
      message: { content: JSON.stringify({ outputKind: "action_event", actionKind: "spawn_unbounded", actionPayload: {} }) },
      finish_reason: "stop"
    }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }
  };
}

function noKindResponse() {
  return {
    id: "runtime-response-no-kind",
    model: "fake-model",
    choices: [{
      message: { content: JSON.stringify({ content: { text: "unsupported text output" } }) },
      finish_reason: "stop"
    }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }
  };
}

function invalidToolArgumentsResponse() {
  return {
    id: "runtime-response-invalid-tool",
    model: "fake-model",
    choices: [{
      message: {
        content: "",
        tool_calls: [{ id: "tool-call-invalid", function: { name: "test.echo", arguments: "{bad json" } }]
      },
      finish_reason: "tool_calls"
    }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }
  };
}

interface ReadyRuntime {
  readonly hatchPackageRef: import("../../src/domain/index.js").HatchPackageRef;
  readonly targetWorldRef: import("../../src/domain/index.js").TargetWorldRef;
  readonly worldInputRef: import("../../src/target-world-adapter/index.js").WorldInputEnvelopeRef;
}

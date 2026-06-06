import { describe, expect, it } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import {
  allowRuntimePolicy,
  audit,
  echoToolInput,
  makeAgentRuntimeFixture,
  readyAgentRuntime,
  source,
  toolCallResponse,
  version
} from "./helpers.js";

describe("Agent Runtime Kernel tool and trace boundaries", () => {
  it("settles model tool calls through Tool Runtime without producing target output", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgentRuntimeFixture(workspace, [toolCallResponse()]);
      const tool = await fixture.toolRuntime.registerTool(echoToolInput(fixture));
      expect(tool.ok).toBe(true);
      if (!tool.ok) throw new Error(tool.error.message);
      const ready = await readyAgentRuntime(fixture);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const invocation = await fixture.agentRuntime.startRuntimeInvocation({
        hatchPackageRef: ready.value.hatchPackageRef,
        targetWorldRef: ready.value.targetWorldRef,
        mode: "debug",
        modelSelection: { provider: "fake", model: "fake-model" },
        source: source(fixture, "runtime"),
        version,
        audit: audit("start tool runtime")
      });
      expect(invocation.ok).toBe(true);
      if (!invocation.ok) throw new Error(invocation.error.message);
      const turn = await fixture.agentRuntime.runRuntimeTurn(invocation.value, ready.value.worldInputRef, {
        policyContext: allowRuntimePolicy()
      });
      expect(turn.ok).toBe(true);
      if (!turn.ok) throw new Error(turn.error.message);
      expect(turn.value.status).toBe("tool_settled");
      expect(turn.value.toolSettlementRefs).toHaveLength(1);
      expect(turn.value.runtimeOutputRef).toBeUndefined();
      const explanation = await fixture.agentRuntime.explainRuntimeInvocation(invocation.value);
      expect(explanation.ok).toBe(true);
      if (!explanation.ok) throw new Error(explanation.error.message);
      expect(explanation.value.facts).toContain("toolSettlements=1");
    });
  });

  it("gates runtime trace reads with policy context", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgentRuntimeFixture(workspace);
      const ready = await readyAgentRuntime(fixture);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const invocation = await fixture.agentRuntime.startRuntimeInvocation({
        hatchPackageRef: ready.value.hatchPackageRef,
        targetWorldRef: ready.value.targetWorldRef,
        mode: "debug",
        modelSelection: { provider: "fake", model: "fake-model" },
        source: source(fixture, "runtime"),
        version,
        audit: audit("start trace runtime")
      });
      expect(invocation.ok).toBe(true);
      if (!invocation.ok) throw new Error(invocation.error.message);
      const turn = await fixture.agentRuntime.runRuntimeTurn(invocation.value, ready.value.worldInputRef, {
        policyContext: allowRuntimePolicy()
      });
      expect(turn.ok).toBe(true);
      const explanation = await fixture.agentRuntime.explainRuntimeInvocation(invocation.value);
      expect(explanation.ok).toBe(true);
      if (!explanation.ok || explanation.value.traceRef === undefined) throw new Error("missing trace");
      const blocked = await fixture.agentRuntime.readRuntimeTrace(explanation.value.traceRef);
      expect(blocked.ok).toBe(false);
      if (blocked.ok) throw new Error("trace should be policy gated");
      expect(blocked.error.code).toBe("privacy_blocked");
      const allowed = await fixture.agentRuntime.readRuntimeTrace(explanation.value.traceRef, {
        policyContext: allowRuntimePolicy()
      });
      expect(allowed.ok).toBe(true);
      if (!allowed.ok) throw new Error(allowed.error.message);
      expect(allowed.value.runtimeMessageListRefs).toHaveLength(1);
    });
  });
});

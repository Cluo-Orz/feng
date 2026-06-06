import { describe, expect, it } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import {
  allowRuntimePolicy,
  audit,
  makeAgentRuntimeFixture,
  readyAgentRuntime,
  source,
  version
} from "./helpers.js";

describe("Agent Runtime Kernel runtime flow", () => {
  it("runs an LLM action turn through runtime message list and target adapter", async () => {
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
        audit: audit("start runtime")
      });
      expect(invocation.ok).toBe(true);
      if (!invocation.ok) throw new Error(invocation.error.message);
      const turn = await fixture.agentRuntime.runRuntimeTurn(invocation.value, ready.value.worldInputRef, {
        policyContext: allowRuntimePolicy(),
        dispatchTargetActions: true
      });
      expect(turn.ok).toBe(true);
      if (!turn.ok) throw new Error(turn.error.message);
      expect(turn.value.status).toBe("completed");
      expect(turn.value.runtimeOutputRef).toBeDefined();
      expect(turn.value.targetActionRequestRefs).toHaveLength(1);
      const message = await fixture.agentRuntime.explainRuntimeMessageList(turn.value.runtimeMessageListRef);
      expect(message.ok).toBe(true);
      if (!message.ok) throw new Error(message.error.message);
      expect(message.value.sourceMap.entries.some((entry) => entry.section === "target_world_input")).toBe(true);
      expect(message.value.budgetReport.estimatedUsage).toBeGreaterThan(0);
      const explanation = await fixture.agentRuntime.explainRuntimeInvocation(invocation.value);
      expect(explanation.ok).toBe(true);
      if (!explanation.ok) throw new Error(explanation.error.message);
      expect(explanation.value.facts).toContain("targetActions=1");
      expect(explanation.value.traceRef).toBeDefined();
    });
  });

  it("compiles message list in dry run without calling the LLM", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgentRuntimeFixture(workspace);
      const ready = await readyAgentRuntime(fixture);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const invocation = await fixture.agentRuntime.startRuntimeInvocation({
        hatchPackageRef: ready.value.hatchPackageRef,
        targetWorldRef: ready.value.targetWorldRef,
        mode: "dry_run",
        modelSelection: { provider: "fake", model: "fake-model" },
        source: source(fixture, "runtime"),
        version,
        audit: audit("start dry run")
      });
      expect(invocation.ok).toBe(true);
      if (!invocation.ok) throw new Error(invocation.error.message);
      const turn = await fixture.agentRuntime.runRuntimeTurn(invocation.value, ready.value.worldInputRef);
      expect(turn.ok).toBe(true);
      if (!turn.ok) throw new Error(turn.error.message);
      expect(turn.value.status).toBe("dry_run");
      expect(fixture.adapterCalls()).toBe(0);
      const message = await fixture.agentRuntime.explainRuntimeMessageList(turn.value.runtimeMessageListRef);
      expect(message.ok).toBe(true);
    });
  });
});

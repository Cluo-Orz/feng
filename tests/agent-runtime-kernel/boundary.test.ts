import { describe, expect, it } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import {
  audit,
  makeAgentRuntimeFixture,
  readyAgentRuntime,
  source,
  version
} from "./helpers.js";

describe("Agent Runtime Kernel startup boundaries", () => {
  it("rejects production mode for unpublished hatch packages", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgentRuntimeFixture(workspace);
      const ready = await readyAgentRuntime(fixture, false);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const invocation = await fixture.agentRuntime.startRuntimeInvocation({
        hatchPackageRef: ready.value.hatchPackageRef,
        targetWorldRef: ready.value.targetWorldRef,
        mode: "production",
        modelSelection: { provider: "fake", model: "fake-model" },
        source: source(fixture, "runtime"),
        version,
        audit: audit("start production")
      });
      expect(invocation.ok).toBe(false);
      if (invocation.ok) throw new Error("production invocation should fail");
      expect(invocation.error.code).toBe("production_lock_violation");
    });
  });

  it("starts production mode when hatch package has been published locally", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgentRuntimeFixture(workspace);
      const ready = await readyAgentRuntime(fixture, true);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const invocation = await fixture.agentRuntime.startRuntimeInvocation({
        hatchPackageRef: ready.value.hatchPackageRef,
        targetWorldRef: ready.value.targetWorldRef,
        mode: "production",
        modelSelection: { provider: "fake", model: "fake-model" },
        source: source(fixture, "runtime"),
        version,
        audit: audit("start production published")
      });
      expect(invocation.ok).toBe(true);
      if (!invocation.ok) throw new Error(invocation.error.message);
      const explanation = await fixture.agentRuntime.explainRuntimeInvocation(invocation.value);
      expect(explanation.ok).toBe(true);
      if (!explanation.ok) throw new Error(explanation.error.message);
      expect(explanation.value.summary).toBe("production running");
    });
  });
});

import { describe, expect, test } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import {
  audit,
  lockedContractSetup,
  makeTargetFixture,
  registerGameWorld,
  source,
  version
} from "./helpers.js";

describe("Target World Adapter descriptors and compatibility", () => {
  test("registers target worlds and requires an active adapter for compatibility", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeTargetFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const targetWorld = await fixture.target.registerTargetWorld({
        name: "Inactive Arena",
        kind: "game_engine",
        description: "Arena with a registered but inactive adapter.",
        inputKinds: ["tick_state"],
        outputKinds: ["action_event"],
        actionKinds: ["move", "attack"],
        validationKinds: ["scenario_check"],
        debugSignalKinds: ["failure_trace"],
        privacyBoundary: "workspace_private",
        environmentBoundary: "local process",
        capabilityRequirements: ["runtime.target_action"],
        source: source(fixture, "system"),
        version,
        audit: audit("register inactive world")
      });
      expect(targetWorld.ok).toBe(true);
      if (!targetWorld.ok) throw new Error(targetWorld.error.message);
      const adapter = await fixture.target.registerAdapter({
        targetWorldRef: targetWorld.value,
        name: "Inactive Adapter",
        supportedRuntimeKernelTypes: ["non_llm_runtime"],
        supportedInputKinds: ["tick_state"],
        supportedOutputKinds: ["action_event"],
        supportedActionKinds: ["move", "attack"],
        supportedValidationKinds: ["scenario_check"],
        hostIntegrationSummary: "registered only",
        compatibility: "compatible when active",
        policyBoundarySummary: "runtime.target_action required",
        source: source(fixture, "system"),
        version,
        audit: audit("register inactive adapter")
      });
      expect(adapter.ok).toBe(true);
      if (!adapter.ok) throw new Error(adapter.error.message);
      const inactive = await fixture.target.checkRuntimeContractCompatibility(setup.value.runtimeContractRef, targetWorld.value);
      expect(inactive.ok).toBe(true);
      if (inactive.ok) {
        expect(inactive.value.compatible).toBe(false);
        expect(inactive.value.blockers).toContain("no active adapter supports runtime kernel");
      }

      const active = await fixture.target.changeAdapterLifecycle(adapter.value, "active", "activate");
      expect(active.ok).toBe(true);
      const compatible = await fixture.target.checkRuntimeContractCompatibility(setup.value.runtimeContractRef, targetWorld.value);
      expect(compatible.ok).toBe(true);
      if (!compatible.ok) throw new Error(compatible.error.message);
      expect(compatible.value.compatible).toBe(true);
      expect(compatible.value.matchedInputKinds).toContain("tick_state");
      expect(compatible.value.matchedOutputKinds).toContain("action_event");
      const explanation = await fixture.target.explainCompatibility(compatible.value.reportRef);
      expect(explanation.ok).toBe(true);
      if (explanation.ok) expect(explanation.value.join("\n")).toContain("compatible=true");
      const page = await fixture.target.listAdapters({ targetWorldRef: targetWorld.value, lifecycle: "active" });
      expect(page.ok).toBe(true);
      if (page.ok) expect(page.value.records).toHaveLength(1);
    });
  });

  test("rejects adapter declarations outside target world boundaries", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeTargetFixture(workspace);
      const registered = await registerGameWorld(fixture);
      expect(registered.ok).toBe(true);
      if (!registered.ok) throw new Error(registered.error.message);
      const invalid = await fixture.target.registerAdapter({
        targetWorldRef: registered.value.targetWorldRef,
        name: "Invalid Adapter",
        supportedRuntimeKernelTypes: ["non_llm_runtime"],
        supportedInputKinds: ["dialogue_turn"],
        supportedOutputKinds: ["action_event"],
        supportedActionKinds: ["move"],
        supportedValidationKinds: ["scenario_check"],
        hostIntegrationSummary: "bad input",
        compatibility: "bad",
        policyBoundarySummary: "none",
        source: source(fixture, "system"),
        version,
        audit: audit("register invalid adapter")
      });
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) expect(invalid.error.code).toBe("adapter_incompatible");
    });
  });
});

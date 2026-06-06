import { describe, expect, test } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import { makeTargetWorldId, makeRef } from "../../src/domain/index.js";
import {
  audit,
  makeTargetFixture,
  registerGameWorld,
  source,
  version
} from "./helpers.js";

describe("Target World Adapter descriptor edge cases", () => {
  test("surfaces invalid descriptors, missing targets, lifecycle conflicts, and pagination", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeTargetFixture(workspace);
      const invalid = await fixture.target.registerTargetWorld({
        name: " ",
        kind: "game_engine",
        description: "invalid",
        inputKinds: ["tick_state"],
        outputKinds: ["action_event"],
        actionKinds: ["move"],
        validationKinds: ["scenario_check"],
        debugSignalKinds: ["failure_trace"],
        privacyBoundary: "workspace_private",
        environmentBoundary: "local",
        capabilityRequirements: [],
        source: source(fixture, "system"),
        version,
        audit: audit("invalid world")
      });
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) expect(invalid.error.code).toBe("invalid_input");

      const target = await registerGameWorld(fixture);
      expect(target.ok).toBe(true);
      if (!target.ok) throw new Error(target.error.message);
      const read = await fixture.target.getTargetWorld(target.value.targetWorldRef);
      expect(read.ok).toBe(true);
      if (read.ok) expect(read.value.name).toBe("Boss Arena");

      const missing = await fixture.target.registerAdapter({
        targetWorldRef: makeRef("target_world", makeTargetWorldId("target-world-missing")),
        name: "Missing Target Adapter",
        supportedRuntimeKernelTypes: ["non_llm_runtime"],
        supportedInputKinds: ["tick_state"],
        supportedOutputKinds: ["action_event"],
        supportedActionKinds: ["move"],
        supportedValidationKinds: ["scenario_check"],
        hostIntegrationSummary: "missing",
        compatibility: "none",
        policyBoundarySummary: "none",
        source: source(fixture, "system"),
        version,
        audit: audit("missing target adapter")
      });
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.error.code).toBe("not_found");

      const invalidOutput = await fixture.target.registerAdapter({
        targetWorldRef: target.value.targetWorldRef,
        name: "Invalid Output Adapter",
        supportedRuntimeKernelTypes: ["non_llm_runtime"],
        supportedInputKinds: ["tick_state"],
        supportedOutputKinds: ["text_result"],
        supportedActionKinds: ["move"],
        supportedValidationKinds: ["scenario_check"],
        hostIntegrationSummary: "bad output",
        compatibility: "bad",
        policyBoundarySummary: "none",
        source: source(fixture, "system"),
        version,
        audit: audit("invalid output adapter")
      });
      expect(invalidOutput.ok).toBe(false);
      if (!invalidOutput.ok) expect(invalidOutput.error.code).toBe("adapter_incompatible");

      const conflict = await fixture.target.changeAdapterLifecycle(target.value.adapterRef, "active", "already active");
      expect(conflict.ok).toBe(false);
      if (!conflict.ok) expect(conflict.error.code).toBe("lifecycle_conflict");
      const second = await fixture.target.registerAdapter({
        targetWorldRef: target.value.targetWorldRef,
        name: "Second Adapter",
        supportedRuntimeKernelTypes: ["non_llm_runtime"],
        supportedInputKinds: ["tick_state"],
        supportedOutputKinds: ["action_event"],
        supportedActionKinds: ["move"],
        supportedValidationKinds: ["scenario_check"],
        hostIntegrationSummary: "second",
        compatibility: "ok",
        policyBoundarySummary: "policy",
        source: source(fixture, "system"),
        version,
        audit: audit("second adapter")
      });
      expect(second.ok).toBe(true);
      const page = await fixture.target.listAdapters({ targetWorldRef: target.value.targetWorldRef, limit: 1 });
      expect(page.ok).toBe(true);
      if (!page.ok) throw new Error(page.error.message);
      expect(page.value.nextCursor).toBe("1");
      if (page.value.nextCursor === undefined) throw new Error("expected next cursor");
      const next = await fixture.target.listAdapters({ targetWorldRef: target.value.targetWorldRef, cursor: page.value.nextCursor, limit: 1 });
      expect(next.ok).toBe(true);
      if (next.ok) expect(next.value.records).toHaveLength(1);
    });
  });
});

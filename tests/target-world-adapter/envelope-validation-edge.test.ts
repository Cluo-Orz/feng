import { describe, expect, test } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import { makeArtifactId, makeRef } from "../../src/domain/index.js";
import {
  allowHatchPublish,
  audit,
  buildTargetPackage,
  hatchInput,
  lockedContractSetup,
  makeTargetFixture,
  registerGameWorld,
  source
} from "./helpers.js";

describe("Target World Adapter envelope and validation edge cases", () => {
  test("blocks missing raw input artifacts and package contract mismatches", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeTargetFixture(workspace);
      const first = await lockedContractSetup(fixture);
      const second = await lockedContractSetup(fixture);
      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) throw new Error("contract setup failed");
      const target = await registerGameWorld(fixture);
      const firstPackage = await buildTargetPackage(fixture, first.value);
      expect(target.ok && firstPackage.ok).toBe(true);
      if (!target.ok || !firstPackage.ok) throw new Error("target setup failed");
      const missingRaw = await fixture.target.normalizeWorldInput({
        targetWorldRef: target.value.targetWorldRef,
        runtimeContractRef: first.value.runtimeContractRef,
        hatchPackageRef: firstPackage.value,
        inputKind: "tick_state",
        rawInputArtifactRef: makeRef("artifact", makeArtifactId("artifact-missing")),
        normalizedInput: { tick: 1 },
        privacyClass: "workspace_private",
        source: source(fixture, "system"),
        audit: audit("missing raw")
      });
      expect(missingRaw.ok).toBe(false);
      if (!missingRaw.ok) expect(missingRaw.error.code).toBe("artifact_unavailable");

      const mismatchInput = await fixture.target.normalizeWorldInput({
        targetWorldRef: target.value.targetWorldRef,
        runtimeContractRef: second.value.runtimeContractRef,
        hatchPackageRef: firstPackage.value,
        inputKind: "tick_state",
        normalizedInput: { tick: 2 },
        privacyClass: "workspace_private",
        source: source(fixture, "system"),
        audit: audit("mismatch input")
      });
      expect(mismatchInput.ok).toBe(false);
      if (!mismatchInput.ok) expect(mismatchInput.error.code).toBe("contract_incompatible");

      const validation = await fixture.target.runTargetValidation({
        targetWorldRef: target.value.targetWorldRef,
        runtimeContractRef: second.value.runtimeContractRef,
        hatchPackageRef: firstPackage.value,
        validationKind: "scenario_check",
        inputRefs: [],
        outputRefs: [],
        result: "blocked",
        summary: "mismatch validation",
        source: source(fixture, "system"),
        audit: audit("mismatch validation")
      });
      expect(validation.ok).toBe(false);
      if (!validation.ok) expect(validation.error.code).toBe("contract_incompatible");

      const debug = await fixture.target.recordTargetDebugSignal({
        targetWorldRef: target.value.targetWorldRef,
        runtimeContractRef: second.value.runtimeContractRef,
        hatchPackageRef: firstPackage.value,
        signalKind: "failure_trace",
        summary: "mismatch debug",
        privacyClass: "workspace_private",
        source: source(fixture, "system"),
        audit: audit("mismatch debug")
      });
      expect(debug.ok).toBe(false);
      if (!debug.ok) expect(debug.error.code).toBe("contract_incompatible");

      const retracted = await fixture.hatch.retractHatchPackage(firstPackage.value, "retract for target boundary");
      expect(retracted.ok).toBe(true);
      const afterRetract = await fixture.target.normalizeWorldInput({
        targetWorldRef: target.value.targetWorldRef,
        runtimeContractRef: first.value.runtimeContractRef,
        hatchPackageRef: firstPackage.value,
        inputKind: "tick_state",
        normalizedInput: { tick: 3 },
        privacyClass: "workspace_private",
        source: source(fixture, "system"),
        audit: audit("retracted package input")
      });
      expect(afterRetract.ok).toBe(false);
      if (!afterRetract.ok) expect(afterRetract.error.code).toBe("package_verification_failed");
    });
  });

  test("distinguishes target-supported output from contract-supported output", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeTargetFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const world = await fixture.target.registerTargetWorld({
        name: "Text-Capable Arena",
        kind: "game_engine",
        description: "Target accepts text and action events, contract only accepts action events.",
        inputKinds: ["tick_state"],
        outputKinds: ["action_event", "text_result"],
        actionKinds: ["move"],
        validationKinds: ["scenario_check"],
        debugSignalKinds: ["failure_trace"],
        privacyBoundary: "workspace_private",
        environmentBoundary: "local",
        capabilityRequirements: ["runtime.target_action"],
        source: source(fixture, "system"),
        version: { schemaVersion: "1.0.0", producerVersion: "target-test" },
        audit: audit("register text world")
      });
      expect(world.ok).toBe(true);
      if (!world.ok) throw new Error(world.error.message);
      const adapter = await fixture.target.registerAdapter({
        targetWorldRef: world.value,
        name: "Text Adapter",
        supportedRuntimeKernelTypes: ["non_llm_runtime"],
        supportedInputKinds: ["tick_state"],
        supportedOutputKinds: ["action_event", "text_result"],
        supportedActionKinds: ["move"],
        supportedValidationKinds: ["scenario_check"],
        hostIntegrationSummary: "text capable",
        compatibility: "partial",
        policyBoundarySummary: "policy",
        source: source(fixture, "system"),
        version: { schemaVersion: "1.0.0", producerVersion: "target-test" },
        audit: audit("register text adapter")
      });
      expect(adapter.ok).toBe(true);
      if (!adapter.ok) throw new Error(adapter.error.message);
      await fixture.target.changeAdapterLifecycle(adapter.value, "active", "activate text adapter");
      const request = await fixture.hatch.requestHatch(hatchInput(fixture, setup.value, {
        packageName: "text-edge-package",
        requestedVersion: { schemaVersion: "30.0.0", producerVersion: "target-test" }
      }));
      expect(request.ok).toBe(true);
      if (!request.ok) throw new Error(request.error.message);
      const plan = await fixture.hatch.buildHatchPlan(request.value, allowHatchPublish());
      expect(plan.ok).toBe(true);
      if (!plan.ok) throw new Error(plan.error.message);
      const pkg = await fixture.hatch.buildHatchPackage(plan.value.hatchBuildPlanRef);
      expect(pkg.ok).toBe(true);
      if (!pkg.ok) throw new Error(pkg.error.message);
      const output = await fixture.target.normalizeRuntimeOutput({
        targetWorldRef: world.value,
        runtimeContractRef: setup.value.runtimeContractRef,
        hatchPackageRef: pkg.value,
        outputKind: "text_result",
        normalizedOutput: "text is target-supported but contract-invalid",
        privacyClass: "workspace_private",
        source: source(fixture, "system"),
        audit: audit("contract invalid output")
      });
      expect(output.ok).toBe(false);
      if (!output.ok) expect(output.error.code).toBe("runtime_output_invalid");
    });
  });
});

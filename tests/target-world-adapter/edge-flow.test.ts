import { describe, expect, test } from "vitest";
import { contractInput } from "../runtime-contract-registry/helpers.js";
import {
  newWorldOutputRef,
  TargetWorldAdapterStorage,
  workspaceTargetWorldStream,
  type WorldOutputEnvelope
} from "../../src/target-world-adapter/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import {
  audit,
  buildTargetPackage,
  lockedContractSetup,
  makeTargetFixture,
  registerGameWorld,
  source
} from "./helpers.js";

describe("Target World Adapter edge flows", () => {
  test("builds target world streams for workspace-level events", () => {
    expect(workspaceTargetWorldStream("workspace-stream").streamType).toBe("target_world");
  });

  test("supports explicit external enforcement and action cancellation", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeTargetFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const target = await registerGameWorld(fixture);
      const pkg = await buildTargetPackage(fixture, setup.value);
      expect(target.ok && pkg.ok).toBe(true);
      if (!target.ok || !pkg.ok) throw new Error("target setup failed");
      const output = await fixture.target.normalizeRuntimeOutput({
        targetWorldRef: target.value.targetWorldRef,
        runtimeContractRef: setup.value.runtimeContractRef,
        hatchPackageRef: pkg.value,
        outputKind: "action_event",
        normalizedOutput: { action: "move" },
        privacyClass: "workspace_private",
        source: source(fixture, "system"),
        audit: audit("normalize output")
      });
      expect(output.ok).toBe(true);
      if (!output.ok) throw new Error(output.error.message);
      const external = await fixture.target.prepareTargetAction(output.value.worldOutputRef, {
        actionKind: "move",
        actionPayload: { x: 0, y: 1 },
        resourceSummary: "move with host enforcement",
        externalEnforcement: { enforcedBy: "game-engine", summary: "engine validates action" },
        reason: "external enforcement",
        source: source(fixture, "system"),
        audit: audit("prepare external action")
      });
      expect(external.ok).toBe(true);
      if (!external.ok) throw new Error(external.error.message);
      expect(external.value.boundaryDeclaration.level).toBe("external_enforcement");
      const dispatched = await fixture.target.dispatchTargetAction(external.value.targetActionRequestRef, "dispatch external");
      expect(dispatched.ok).toBe(true);
      const secondDispatch = await fixture.target.dispatchTargetAction(external.value.targetActionRequestRef, "dispatch again");
      expect(secondDispatch.ok).toBe(false);
      if (!secondDispatch.ok) expect(secondDispatch.error.code).toBe("invalid_state");

      const cancellable = await fixture.target.prepareTargetAction(output.value.worldOutputRef, {
        actionKind: "attack",
        actionPayload: { target: "player" },
        resourceSummary: "cancel attack",
        externalEnforcement: { enforcedBy: "game-engine", summary: "engine validates action" },
        reason: "prepare cancel",
        source: source(fixture, "system"),
        audit: audit("prepare cancel action")
      });
      expect(cancellable.ok).toBe(true);
      if (!cancellable.ok) throw new Error(cancellable.error.message);
      const cancelled = await fixture.target.cancelTargetAction(cancellable.value.targetActionRequestRef, "cancel action");
      expect(cancelled.ok).toBe(true);
      if (cancelled.ok) expect(cancelled.value.to).toBe("cancelled");
      const cancelAgain = await fixture.target.cancelTargetAction(cancellable.value.targetActionRequestRef, "cancel again");
      expect(cancelAgain.ok).toBe(false);
      if (!cancelAgain.ok) expect(cancelAgain.error.code).toBe("invalid_state");
    });
  });

  test("blocks unsupported outputs, actions, validation kinds, and debug signals", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeTargetFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const target = await registerGameWorld(fixture);
      const pkg = await buildTargetPackage(fixture, setup.value);
      expect(target.ok && pkg.ok).toBe(true);
      if (!target.ok || !pkg.ok) throw new Error("target setup failed");
      const badOutput = await fixture.target.normalizeRuntimeOutput({
        targetWorldRef: target.value.targetWorldRef,
        runtimeContractRef: setup.value.runtimeContractRef,
        hatchPackageRef: pkg.value,
        outputKind: "text_result",
        normalizedOutput: "not a boss action",
        privacyClass: "workspace_private",
        source: source(fixture, "system"),
        audit: audit("bad output")
      });
      expect(badOutput.ok).toBe(false);
      if (!badOutput.ok) expect(badOutput.error.code).toBe("runtime_output_invalid");

      const output = await fixture.target.normalizeRuntimeOutput({
        targetWorldRef: target.value.targetWorldRef,
        runtimeContractRef: setup.value.runtimeContractRef,
        hatchPackageRef: pkg.value,
        outputKind: "action_event",
        normalizedOutput: { action: "move" },
        privacyClass: "workspace_private",
        source: source(fixture, "system"),
        audit: audit("good output")
      });
      expect(output.ok).toBe(true);
      if (!output.ok) throw new Error(output.error.message);
      const unsupportedAction = await fixture.target.prepareTargetAction(output.value.worldOutputRef, {
        actionKind: "teleport",
        actionPayload: {},
        resourceSummary: "teleport",
        reason: "unsupported action",
        source: source(fixture, "system"),
        audit: audit("unsupported action")
      });
      expect(unsupportedAction.ok).toBe(false);
      if (!unsupportedAction.ok) expect(unsupportedAction.error.code).toBe("contract_incompatible");

      const validation = await fixture.target.runTargetValidation({
        targetWorldRef: target.value.targetWorldRef,
        runtimeContractRef: setup.value.runtimeContractRef,
        hatchPackageRef: pkg.value,
        validationKind: "lint",
        inputRefs: [],
        outputRefs: [],
        result: "blocked",
        summary: "unsupported validation",
        source: source(fixture, "system"),
        audit: audit("unsupported validation")
      });
      expect(validation.ok).toBe(false);
      if (!validation.ok) expect(validation.error.code).toBe("target_validation_failed");
      const debug = await fixture.target.recordTargetDebugSignal({
        targetWorldRef: target.value.targetWorldRef,
        runtimeContractRef: setup.value.runtimeContractRef,
        hatchPackageRef: pkg.value,
        signalKind: "performance_sample",
        summary: "unsupported debug signal",
        privacyClass: "workspace_private",
        source: source(fixture, "system"),
        audit: audit("unsupported debug")
      });
      expect(debug.ok).toBe(false);
      if (!debug.ok) expect(debug.error.code).toBe("debug_signal_blocked");
    });
  });

  test("rejects target actions unsupported by the target when contract has no action boundary", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeTargetFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const target = await registerGameWorld(fixture);
      const pkg = await buildTargetPackage(fixture, setup.value);
      expect(target.ok && pkg.ok).toBe(true);
      if (!target.ok || !pkg.ok) throw new Error("target setup failed");
      const noAction = await fixture.contracts.registerRuntimeContract(contractInput(fixture, setup.value.growUnitRef, {
        name: "no-action-boundary",
        version: { schemaVersion: "40.0.0", producerVersion: "target-test" },
        shape: {},
        capabilityRequirements: []
      }));
      expect(noAction.ok).toBe(true);
      if (!noAction.ok) throw new Error(noAction.error.message);
      const artifact = await fixture.artifacts.registerArtifact({
        kind: "summary",
        content: "{}",
        mediaType: "application/json",
        encoding: "utf8",
        source: source(fixture, "system"),
        version: { schemaVersion: "1.0.0", producerVersion: "target-test" },
        audit: audit("manual world output artifact"),
        privacyClass: "workspace_private",
        retentionClass: "runtime_scoped",
        producerModule: "human"
      });
      expect(artifact.ok).toBe(true);
      if (!artifact.ok) throw new Error(artifact.error.message);
      const ref = newWorldOutputRef();
      const record: WorldOutputEnvelope = {
        targetWorldRef: target.value.targetWorldRef,
        runtimeContractRef: noAction.value,
        hatchPackageRef: pkg.value,
        outputKind: "action_event",
        normalizedOutputRef: artifact.value,
        actionRequestRefs: [],
        eventRefs: [],
        privacyClass: "workspace_private",
        source: source(fixture, "system"),
        audit: audit("manual world output"),
        worldOutputId: ref.id,
        worldOutputRef: ref,
        createdAt: "2026-06-06T00:00:00.000Z",
        recordVersion: 1
      };
      const storage = new TargetWorldAdapterStorage(fixture.store, fixture.workspace);
      expect((await storage.writeWorldOutput(record, "write manual output")).ok).toBe(true);
      expect((await storage.addWorldOutput(ref)).ok).toBe(true);
      const action = await fixture.target.prepareTargetAction(ref, {
        actionKind: "teleport",
        actionPayload: {},
        resourceSummary: "teleport",
        reason: "target unsupported action",
        source: source(fixture, "system"),
        audit: audit("target unsupported action")
      });
      expect(action.ok).toBe(false);
      if (!action.ok) expect(action.error.code).toBe("target_action_rejected");
    });
  });
});

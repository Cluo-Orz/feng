import { describe, expect, test } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import {
  audit,
  buildTargetPackage,
  lockedContractSetup,
  makeTargetFixture,
  policy,
  registerGameWorld,
  registerTextArtifact,
  source
} from "./helpers.js";

describe("Target World Adapter envelopes and actions", () => {
  test("normalizes world input and runtime output without treating dialogue as default", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeTargetFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const target = await registerGameWorld(fixture);
      const pkg = await buildTargetPackage(fixture, setup.value);
      expect(target.ok && pkg.ok).toBe(true);
      if (!target.ok || !pkg.ok) throw new Error("target setup failed");
      const raw = await registerTextArtifact(fixture, { content: "private tick state" });
      expect(raw.ok).toBe(true);
      if (!raw.ok) throw new Error(raw.error.message);

      const input = await fixture.target.normalizeWorldInput({
        targetWorldRef: target.value.targetWorldRef,
        runtimeContractRef: setup.value.runtimeContractRef,
        hatchPackageRef: pkg.value,
        inputKind: "tick_state",
        rawInputArtifactRef: raw.value,
        normalizedInput: { tick: 1, bossHp: 100 },
        privacyClass: "workspace_private",
        correlationId: "tick-1",
        source: source(fixture, "system"),
        audit: audit("normalize input")
      });
      expect(input.ok).toBe(true);
      if (!input.ok) throw new Error(input.error.message);
      expect(input.value.rawInputArtifactRef?.id).toBe(raw.value.id);
      expect(input.value.normalizedInputRef.id).not.toBe(raw.value.id);

      const dialogue = await fixture.target.normalizeWorldInput({
        targetWorldRef: target.value.targetWorldRef,
        runtimeContractRef: setup.value.runtimeContractRef,
        hatchPackageRef: pkg.value,
        inputKind: "dialogue_turn",
        normalizedInput: { text: "hello" },
        privacyClass: "workspace_private",
        source: source(fixture, "system"),
        audit: audit("normalize dialogue")
      });
      expect(dialogue.ok).toBe(false);
      if (!dialogue.ok) expect(dialogue.error.code).toBe("contract_incompatible");

      const output = await fixture.target.normalizeRuntimeOutput({
        targetWorldRef: target.value.targetWorldRef,
        runtimeContractRef: setup.value.runtimeContractRef,
        hatchPackageRef: pkg.value,
        outputKind: "action_event",
        normalizedOutput: { action: "move", x: 1, y: 0 },
        privacyClass: "workspace_private",
        correlationId: "tick-1",
        source: source(fixture, "system"),
        audit: audit("normalize output")
      });
      expect(output.ok).toBe(true);
      if (!output.ok) throw new Error(output.error.message);
      const validation = await fixture.target.validateWorldOutput(output.value.worldOutputRef);
      expect(validation.ok).toBe(true);
      if (validation.ok) expect(validation.value.result).toBe("passed");
    });
  });

  test("prepares target actions but dispatches only after policy or external enforcement", async () => {
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
        normalizedOutput: { action: "attack" },
        privacyClass: "workspace_private",
        source: source(fixture, "system"),
        audit: audit("normalize action output")
      });
      expect(output.ok).toBe(true);
      if (!output.ok) throw new Error(output.error.message);

      const waiting = await fixture.target.prepareTargetAction(output.value.worldOutputRef, {
        actionKind: "attack",
        actionPayload: { target: "player" },
        resourceSummary: "attack player",
        reason: "needs policy",
        source: source(fixture, "system"),
        audit: audit("prepare waiting action")
      });
      expect(waiting.ok).toBe(true);
      if (!waiting.ok) throw new Error(waiting.error.message);
      expect(waiting.value.dispatchStatus).toBe("waiting_policy");
      const blockedDispatch = await fixture.target.dispatchTargetAction(waiting.value.targetActionRequestRef, "dispatch");
      expect(blockedDispatch.ok).toBe(false);
      if (!blockedDispatch.ok) expect(blockedDispatch.error.code).toBe("approval_required");

      const denied = await fixture.target.prepareTargetAction(output.value.worldOutputRef, {
        actionKind: "move",
        actionPayload: { x: 1, y: 0 },
        resourceSummary: "move boss",
        policyContext: policy([{ capability: "runtime.target_action", resource: "*", verdict: "deny" }]),
        reason: "deny action",
        source: source(fixture, "system"),
        audit: audit("prepare denied action")
      });
      expect(denied.ok).toBe(true);
      if (denied.ok) expect(denied.value.dispatchStatus).toBe("policy_blocked");
      if (!denied.ok) throw new Error(denied.error.message);
      const deniedDispatch = await fixture.target.dispatchTargetAction(denied.value.targetActionRequestRef, "dispatch denied");
      expect(deniedDispatch.ok).toBe(false);
      if (!deniedDispatch.ok) expect(deniedDispatch.error.code).toBe("policy_blocked");

      const allowed = await fixture.target.prepareTargetAction(output.value.worldOutputRef, {
        actionKind: "move",
        actionPayload: { x: 1, y: 0 },
        resourceSummary: "move boss",
        requiredCapabilities: ["runtime.target_action", "game.local_action"],
        policyContext: policy([{ capability: "runtime.target_action", resource: "*", verdict: "allow" }]),
        reason: "allow action",
        source: source(fixture, "system"),
        audit: audit("prepare allowed action")
      });
      expect(allowed.ok).toBe(true);
      if (!allowed.ok) throw new Error(allowed.error.message);
      expect(allowed.value.dispatchStatus).toBe("validated");
      expect(allowed.value.requiredCapabilities).toContain("game.local_action");
      const dispatched = await fixture.target.dispatchTargetAction(allowed.value.targetActionRequestRef, "dispatch action");
      expect(dispatched.ok).toBe(true);
      if (dispatched.ok) expect(dispatched.value.to).toBe("dispatched");

      const forbidden = await fixture.target.prepareTargetAction(output.value.worldOutputRef, {
        actionKind: "spawn_unbounded",
        actionPayload: {},
        resourceSummary: "forbidden spawn",
        reason: "forbidden",
        source: source(fixture, "system"),
        audit: audit("prepare forbidden action")
      });
      expect(forbidden.ok).toBe(false);
      if (!forbidden.ok) expect(forbidden.error.code).toBe("contract_incompatible");
    });
  });
});

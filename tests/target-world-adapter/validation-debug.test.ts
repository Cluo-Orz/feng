import { describe, expect, test } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import {
  audit,
  buildTargetPackage,
  lockedContractSetup,
  makeTargetFixture,
  policy,
  registerGameWorld,
  source,
  version
} from "./helpers.js";

describe("Target World Adapter validation and debug signals", () => {
  test("records failure mappings and validation reports as evidence candidates only", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeTargetFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const target = await registerGameWorld(fixture);
      const pkg = await buildTargetPackage(fixture, setup.value);
      expect(target.ok && pkg.ok).toBe(true);
      if (!target.ok || !pkg.ok) throw new Error("target setup failed");
      const failure = await fixture.target.mapTargetFailure({
        targetWorldRef: target.value.targetWorldRef,
        runtimeContractRef: setup.value.runtimeContractRef,
        targetFailureKind: "animation_blocked",
        normalizedFailureKind: "action_rejected",
        retryable: true,
        severity: "medium",
        attributionHint: "target_world_adapter",
        evidenceRefs: [],
        source: source(fixture, "system"),
        audit: audit("map failure")
      });
      expect(failure.ok).toBe(true);
      if (!failure.ok) throw new Error(failure.error.message);
      const report = await fixture.target.runTargetValidation({
        targetWorldRef: target.value.targetWorldRef,
        runtimeContractRef: setup.value.runtimeContractRef,
        hatchPackageRef: pkg.value,
        validationKind: "scenario_check",
        inputRefs: [],
        outputRefs: [],
        result: "failed",
        summary: "boss action rejected by scenario validation",
        failureMappingRefs: [failure.value.failureMappingRef],
        source: source(fixture, "system"),
        audit: audit("run validation")
      });
      expect(report.ok).toBe(true);
      if (!report.ok) throw new Error(report.error.message);
      expect(report.value.result).toBe("failed");
      expect(report.value.evidenceCandidateRef.id).toBe(report.value.artifactRef.id);
    });
  });

  test("records local debug signals and gates upload with policy", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeTargetFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const target = await registerGameWorld(fixture);
      const pkg = await buildTargetPackage(fixture, setup.value);
      expect(target.ok && pkg.ok).toBe(true);
      if (!target.ok || !pkg.ok) throw new Error("target setup failed");
      const local = await fixture.target.recordTargetDebugSignal({
        targetWorldRef: target.value.targetWorldRef,
        runtimeContractRef: setup.value.runtimeContractRef,
        hatchPackageRef: pkg.value,
        signalKind: "failure_trace",
        summary: "boss stopped moving after phase change",
        detail: { tick: 12 },
        privacyClass: "workspace_private",
        feedbackCandidateHint: "adapter may be dropping phase changes",
        source: source(fixture, "system"),
        audit: audit("record debug signal")
      });
      expect(local.ok).toBe(true);
      if (!local.ok) throw new Error(local.error.message);
      expect(local.value.uploadRequested).toBe(false);
      const plainLocal = await fixture.target.recordTargetDebugSignal({
        targetWorldRef: target.value.targetWorldRef,
        runtimeContractRef: setup.value.runtimeContractRef,
        hatchPackageRef: pkg.value,
        signalKind: "state_snapshot",
        summary: "plain local signal",
        privacyClass: "workspace_private",
        source: source(fixture, "system"),
        audit: audit("record plain debug signal")
      });
      expect(plainLocal.ok).toBe(true);
      if (plainLocal.ok) expect(plainLocal.value.feedbackCandidateHint).toBeUndefined();

      const denied = await fixture.target.recordTargetDebugSignal({
        targetWorldRef: target.value.targetWorldRef,
        runtimeContractRef: setup.value.runtimeContractRef,
        hatchPackageRef: pkg.value,
        signalKind: "failure_trace",
        summary: "upload denied",
        privacyClass: "workspace_private",
        uploadRequested: true,
        policyContext: policy([{ capability: "debug_trace.upload", resource: "*", verdict: "deny" }]),
        source: source(fixture, "system"),
        audit: audit("record denied debug upload")
      });
      expect(denied.ok).toBe(false);
      if (!denied.ok) expect(denied.error.code).toBe("debug_signal_blocked");

      const noPolicy = await fixture.target.recordTargetDebugSignal({
        targetWorldRef: target.value.targetWorldRef,
        runtimeContractRef: setup.value.runtimeContractRef,
        hatchPackageRef: pkg.value,
        signalKind: "failure_trace",
        summary: "upload without policy",
        privacyClass: "workspace_private",
        uploadRequested: true,
        source: source(fixture, "system"),
        audit: audit("record no-policy debug upload")
      });
      expect(noPolicy.ok).toBe(false);
      if (!noPolicy.ok) expect(noPolicy.error.code).toBe("debug_signal_blocked");

      const allowed = await fixture.target.recordTargetDebugSignal({
        targetWorldRef: target.value.targetWorldRef,
        runtimeContractRef: setup.value.runtimeContractRef,
        hatchPackageRef: pkg.value,
        signalKind: "state_snapshot",
        summary: "upload allowed",
        privacyClass: "workspace_private",
        feedbackCandidateHint: "state snapshot should become a local feedback candidate",
        correlationId: "debug-correlation-1",
        uploadRequested: true,
        policyContext: {
          caller: "target-test",
          environment: {
            hostSandboxAvailable: true,
            networkAvailable: true,
            externalEnforcementAvailable: true,
            secretStoreAvailable: false
          },
          runtimeContract: {
            runtimeContractRef: setup.value.runtimeContractRef,
            runtimeKernelType: "non_llm_runtime",
            version,
            inputSummary: "tick_state",
            outputSummary: "action_event",
            actionBoundarySummary: "move or attack"
          },
          targetWorldContract: {
            targetWorldId: target.value.targetWorldRef.id,
            kind: "game_engine",
            inputKinds: ["tick_state"],
            outputKinds: ["action_event"],
            privacyLevel: "workspace_private"
          },
          activeGrants: [],
          rules: [{ capability: "debug_trace.upload", resource: "*", verdict: "allow" }]
        },
        source: source(fixture, "system"),
        audit: audit("record allowed debug upload")
      });
      expect(allowed.ok).toBe(true);
      if (allowed.ok) {
        expect(allowed.value.uploadRequested).toBe(true);
        expect(allowed.value.policyDecisionId).toBeDefined();
        expect(allowed.value.feedbackCandidateHint).toContain("local feedback");
        expect(allowed.value.correlationId).toBe("debug-correlation-1");
      }
    });
  });
});

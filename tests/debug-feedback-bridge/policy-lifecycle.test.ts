import { describe, expect, it } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import { audit, evidence, makeBridgeFixture, makeGrow, observe, setupCorrelation, source, version, type CorrelationSetup } from "./helpers.js";
import type { PolicyContext } from "../../src/policy-boundary/index.js";

function richPolicy(setup: CorrelationSetup): PolicyContext {
  return {
    caller: "debug-bridge-test",
    environment: { hostSandboxAvailable: true, networkAvailable: true, externalEnforcementAvailable: true, secretStoreAvailable: false },
    runtimeContract: {
      runtimeContractRef: setup.runtimeContractRef,
      runtimeKernelType: "standard_agent_kernel",
      version,
      inputSummary: "tick_state",
      outputSummary: "action_event",
      actionBoundarySummary: "move or attack"
    },
    targetWorldContract: {
      targetWorldId: setup.targetWorldRef.id,
      kind: "game_engine",
      inputKinds: ["tick_state"],
      outputKinds: ["action_event"],
      privacyLevel: "workspace_private"
    },
    activeGrants: [],
    rules: [{ capability: "debug_trace.upload", resource: "*", verdict: "allow" }]
  };
}

describe("Debug Feedback Bridge policy context and lifecycle edges", () => {
  it("evaluates a bridge policy with a full runtime and target world context", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const decision = await fixture.bridge.evaluateBridgePolicy({
        debugCorrelationRef: setup.value.correlationRef,
        capability: "debug_trace.upload",
        resourceSummary: "runtime trace upload",
        operation: "upload_debug_trace",
        reason: "developer requested upload with full context",
        source: source(fixture, "system"),
        policyContext: richPolicy(setup.value)
      });
      expect(decision.ok).toBe(true);
      if (!decision.ok) throw new Error(decision.error.message);
      expect(decision.value.verdict).toBe("allow");
    });
  });

  it("opens a correlation with an explicit correlation id and without a target grow unit", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const origin = await makeGrow(fixture, "correlated-origin");
      if (!origin.ok) throw new Error(origin.error.message);
      const opened = await fixture.bridge.openDebugCorrelation({
        originGrowUnitRef: origin.value,
        hatchPackageRef: setup.value.hatchPackageRef,
        runtimeContractRef: setup.value.runtimeContractRef,
        mode: "replay_debug",
        privacyBoundary: "workspace_private",
        correlationId: "bridge-correlation-7",
        causationId: "cause-1",
        source: source(fixture, "system"),
        audit: audit("open correlated")
      });
      expect(opened.ok).toBe(true);
      if (!opened.ok) throw new Error(opened.error.message);
      const record = await fixture.bridge.getDebugCorrelation(opened.value);
      if (!record.ok) throw new Error(record.error.message);
      expect(record.value.correlationId).toBe("bridge-correlation-7");
      expect(record.value.targetGrowUnitRef).toBeUndefined();
    });
  });

  it("blocks linking and packet building after the correlation is closed", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const envelope = await observe(fixture, setup.value.correlationRef, { evidenceRefs: [await evidence(fixture, "ev")] });
      if (!envelope.ok) throw new Error(envelope.error.message);
      const closed = await fixture.bridge.closeDebugCorrelation(setup.value.correlationRef, "done");
      expect(closed.ok).toBe(true);
      const relinked = await fixture.bridge.linkRuntimeTrace(setup.value.correlationRef, { kind: "runtime_trace", id: "x" as never });
      expect(relinked.ok).toBe(false);
      if (relinked.ok) throw new Error("expected closed link rejection");
      expect(relinked.error.code).toBe("invalid_state");
      const packet = await fixture.bridge.buildFeedbackBridgePacket(setup.value.correlationRef, {
        envelopeRefs: [envelope.value],
        summary: "build after close",
        impact: "unknown",
        candidateTargetLayer: "current_project",
        intent: "local",
        source: source(fixture, "system"),
        audit: audit("late build")
      });
      expect(packet.ok).toBe(false);
      if (packet.ok) throw new Error("expected closed build rejection");
      expect(packet.error.code).toBe("invalid_state");
    });
  });

  it("filters bridge packets by status when listing", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const envelope = await observe(fixture, setup.value.correlationRef, { evidenceRefs: [await evidence(fixture, "ev")] });
      if (!envelope.ok) throw new Error(envelope.error.message);
      const packet = await fixture.bridge.buildFeedbackBridgePacket(setup.value.correlationRef, {
        envelopeRefs: [envelope.value],
        summary: "listed packet",
        impact: "context_gap",
        candidateTargetLayer: "current_project",
        intent: "local",
        source: source(fixture, "system"),
        audit: audit("listed packet")
      });
      if (!packet.ok) throw new Error(packet.error.message);
      const submittedFilter = await fixture.bridge.listBridgePackets(setup.value.correlationRef, { status: "submitted_local" });
      expect(submittedFilter.ok).toBe(true);
      if (!submittedFilter.ok) throw new Error(submittedFilter.error.message);
      expect(submittedFilter.value.total).toBe(0);
      const builtFilter = await fixture.bridge.listBridgePackets(setup.value.correlationRef, { status: "packet_built", limit: 5 });
      expect(builtFilter.ok).toBe(true);
      if (!builtFilter.ok) throw new Error(builtFilter.error.message);
      expect(builtFilter.value.total).toBe(1);
    });
  });
});

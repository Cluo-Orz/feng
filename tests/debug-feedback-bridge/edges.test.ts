import { describe, expect, it } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import {
  allowAll,
  audit,
  evidence,
  makeBridgeFixture,
  observe,
  openAnother,
  setupCorrelation,
  source
} from "./helpers.js";
import { bridgePrivacyGuard } from "../../src/debug-feedback-bridge/index.js";
import type { PrivacyFilterResult } from "../../src/debug-feedback-bridge/index.js";

function privacyRecord(overrides: Partial<PrivacyFilterResult>): PrivacyFilterResult {
  return {
    privacyFilterId: "pf" as PrivacyFilterResult["privacyFilterId"],
    privacyFilterRef: { kind: "privacy_filter_result", id: "pf" as PrivacyFilterResult["privacyFilterId"] },
    debugCorrelationRef: { kind: "debug_correlation", id: "c" as never },
    inputArtifactRefs: [],
    originalPrivacyClasses: [],
    resultPrivacyClass: "workspace_private",
    redactedEvidenceRefs: [],
    blockedRefs: [],
    decision: "pass_local",
    reason: "ok",
    source: source(makeBridgeFixtureStub(), "system"),
    audit: audit("privacy"),
    ...overrides
  } as PrivacyFilterResult;
}

function makeBridgeFixtureStub() {
  return { workspace: { id: "ws" } } as never;
}

describe("Debug Feedback Bridge edge cases", () => {
  it("guards privacy decisions for waiting, blocked, and redaction-required states", () => {
    expect(bridgePrivacyGuard(privacyRecord({ decision: "waiting_policy" }), "upstream").ok).toBe(false);
    expect(bridgePrivacyGuard(privacyRecord({ decision: "block_upstream" }), "upstream").ok).toBe(false);
    expect(bridgePrivacyGuard(privacyRecord({ decision: "redact_then_upstream_candidate" }), "upstream").ok).toBe(false);
    const withRedaction = privacyRecord({
      decision: "redact_then_upstream_candidate",
      redactedSummaryRef: { kind: "artifact", id: "a" as never }
    });
    expect(bridgePrivacyGuard(withRedaction, "upstream").ok).toBe(true);
    expect(bridgePrivacyGuard(privacyRecord({ decision: "pass_local" }), "local").ok).toBe(true);
  });

  it("rejects ingest of unavailable runtime traces and missing debug signals", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const trace = await fixture.bridge.ingestRuntimeTrace(setup.value.correlationRef, { kind: "runtime_trace", id: "missing" as never });
      expect(trace.ok).toBe(false);
      if (trace.ok) throw new Error("expected unavailable trace");
      expect(trace.error.code).toBe("runtime_trace_unavailable");
      const signal = await fixture.bridge.ingestTargetDebugSignal(setup.value.correlationRef, { kind: "target_debug_signal", id: "missing" as never });
      expect(signal.ok).toBe(false);
    });
  });

  it("rejects packets built from envelopes that belong to another correlation", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const other = await openAnother(fixture, setup.value);
      const foreign = await observe(fixture, other, { evidenceRefs: [await evidence(fixture, "foreign")] });
      if (!foreign.ok) throw new Error(foreign.error.message);
      const packet = await fixture.bridge.buildFeedbackBridgePacket(setup.value.correlationRef, {
        envelopeRefs: [foreign.value],
        summary: "cross correlation envelope",
        impact: "unknown",
        candidateTargetLayer: "current_project",
        intent: "local",
        source: source(fixture, "system"),
        audit: audit("cross packet")
      });
      expect(packet.ok).toBe(false);
      if (packet.ok) throw new Error("expected cross-correlation rejection");
      expect(packet.error.code).toBe("invalid_input");
    });
  });

  it("suggests target-agent routing and requires human review when policy is absent", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const local = await observe(fixture, setup.value.correlationRef, { evidenceRefs: [await evidence(fixture, "e")] });
      if (!local.ok) throw new Error(local.error.message);
      const targetPacket = await fixture.bridge.buildFeedbackBridgePacket(setup.value.correlationRef, {
        envelopeRefs: [local.value],
        summary: "route to the target agent project",
        impact: "adapter_gap",
        candidateTargetLayer: "target_agent_project",
        intent: "local",
        source: source(fixture, "system"),
        audit: audit("target packet")
      });
      if (!targetPacket.ok) throw new Error(targetPacket.error.message);
      const targetBuilt = await fixture.bridge.getFeedbackBridgePacket(targetPacket.value);
      if (!targetBuilt.ok) throw new Error(targetBuilt.error.message);
      expect(targetBuilt.value.suggestedAction).toBe("propose_to_target_agent");

      const refs = [];
      for (let index = 0; index < 2; index += 1) {
        const ref = await observe(fixture, setup.value.correlationRef, {
          summary: `strong report ${index}`,
          evidenceRefs: [await evidence(fixture, `s${index}`)]
        });
        if (!ref.ok) throw new Error(ref.error.message);
        refs.push(ref.value);
      }
      const noPolicy = await fixture.bridge.buildFeedbackBridgePacket(setup.value.correlationRef, {
        envelopeRefs: refs,
        summary: "eligible but no policy context provided",
        impact: "kernel_gap",
        candidateTargetLayer: "upstream_feng_project",
        confidenceHint: "high",
        intent: "upstream",
        source: source(fixture, "system"),
        audit: audit("no policy packet")
      });
      if (!noPolicy.ok) throw new Error(noPolicy.error.message);
      const noPolicyBuilt = await fixture.bridge.getFeedbackBridgePacket(noPolicy.value);
      if (!noPolicyBuilt.ok) throw new Error(noPolicyBuilt.error.message);
      expect(noPolicyBuilt.value.suggestedAction).toBe("request_human_review");
      expect(noPolicyBuilt.value.localOnlyReason).toContain("policy decision");
    });
  });

  it("requires a local submission before requesting an upstream proposal", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const refs = [];
      for (let index = 0; index < 2; index += 1) {
        const ref = await observe(fixture, setup.value.correlationRef, {
          summary: `report ${index}`,
          evidenceRefs: [await evidence(fixture, `r${index}`)]
        });
        if (!ref.ok) throw new Error(ref.error.message);
        refs.push(ref.value);
      }
      const packet = await fixture.bridge.buildFeedbackBridgePacket(setup.value.correlationRef, {
        envelopeRefs: refs,
        summary: "eligible packet awaiting submission",
        impact: "kernel_gap",
        candidateTargetLayer: "upstream_feng_project",
        confidenceHint: "high",
        intent: "upstream",
        policyContext: allowAll(),
        source: source(fixture, "system"),
        audit: audit("eligible packet")
      });
      if (!packet.ok) throw new Error(packet.error.message);
      const premature = await fixture.bridge.requestUpstreamProposal({
        bridgePacketRef: packet.value,
        toGrowUnitRef: setup.value.targetGrowUnitRef,
        reason: "too early",
        policyContext: allowAll(),
        source: source(fixture, "system"),
        audit: audit("premature upstream")
      });
      expect(premature.ok).toBe(false);
      if (premature.ok) throw new Error("expected submission requirement");
      expect(premature.error.code).toBe("invalid_state");
    });
  });

  it("requests more evidence when upstream intent has unknown attribution", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const report = await observe(fixture, setup.value.correlationRef, { evidenceRefs: [await evidence(fixture, "u")] });
      if (!report.ok) throw new Error(report.error.message);
      const packet = await fixture.bridge.buildFeedbackBridgePacket(setup.value.correlationRef, {
        envelopeRefs: [report.value],
        summary: "upstream intent but unknown attribution target",
        impact: "unknown",
        candidateTargetLayer: "unknown",
        intent: "upstream",
        policyContext: allowAll(),
        source: source(fixture, "system"),
        audit: audit("unknown upstream packet")
      });
      if (!packet.ok) throw new Error(packet.error.message);
      const built = await fixture.bridge.getFeedbackBridgePacket(packet.value);
      if (!built.ok) throw new Error(built.error.message);
      expect(built.value.suggestedAction).toBe("request_more_evidence");
      expect(built.value.localOnlyReason).toContain("unknown");
    });
  });

  it("reports not found for unknown correlations and packets", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const correlation = await fixture.bridge.getDebugCorrelation({ kind: "debug_correlation", id: "nope" as never });
      expect(correlation.ok).toBe(false);
      const packet = await fixture.bridge.getFeedbackBridgePacket({ kind: "feedback_bridge_packet", id: "nope" as never });
      expect(packet.ok).toBe(false);
    });
  });
});

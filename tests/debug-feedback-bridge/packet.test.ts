import { describe, expect, it } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import { allowAll, audit, evidence, makeBridgeFixture, observe, setupCorrelation, source } from "./helpers.js";
import type { RuntimeReportEnvelopeRef } from "../../src/debug-feedback-bridge/index.js";

async function envelopes(fixture: ReturnType<typeof makeBridgeFixture>, correlationRef: Parameters<typeof observe>[1], count: number) {
  const refs: RuntimeReportEnvelopeRef[] = [];
  for (let index = 0; index < count; index += 1) {
    const ref = await observe(fixture, correlationRef, {
      summary: `runtime report ${index} attributing a feng platform gap`,
      evidenceRefs: [await evidence(fixture, `evidence ${index}`)]
    });
    if (!ref.ok) throw new Error(ref.error.message);
    refs.push(ref.value);
  }
  return refs;
}

describe("Debug Feedback Bridge packet, submit, and upstream flow", () => {
  it("builds an upstream-eligible packet, submits locally, and proposes upstream through admission", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const envelopeRefs = await envelopes(fixture, setup.value.correlationRef, 2);
      const packet = await fixture.bridge.buildFeedbackBridgePacket(setup.value.correlationRef, {
        envelopeRefs,
        summary: "two correlated runtime reports attribute the gap to the upstream feng kernel",
        impact: "kernel_gap",
        candidateTargetLayer: "upstream_feng_project",
        confidenceHint: "high",
        intent: "upstream",
        policyContext: allowAll(),
        source: source(fixture, "system"),
        audit: audit("build bridge packet")
      });
      expect(packet.ok).toBe(true);
      if (!packet.ok) throw new Error(packet.error.message);

      const built = await fixture.bridge.getFeedbackBridgePacket(packet.value);
      if (!built.ok) throw new Error(built.error.message);
      expect(built.value.attribution.upstreamEligible).toBe(true);
      expect(built.value.suggestedAction).toBe("propose_to_upstream_feng");
      expect(built.value.privacyClass).toBe("redacted");
      expect(built.value.privacy.redactedSummaryRef).toBeDefined();

      const explanation = await fixture.bridge.explainFeedbackBridgePacket(packet.value);
      expect(explanation.ok).toBe(true);
      if (!explanation.ok) throw new Error(explanation.error.message);
      expect(explanation.value.excluded.some((line) => line.includes("redacted"))).toBe(true);

      const submitted = await fixture.bridge.submitFeedbackCandidate(packet.value);
      expect(submitted.ok).toBe(true);
      if (!submitted.ok) throw new Error(submitted.error.message);
      expect(submitted.value.status).toBe("submitted_local");
      expect(submitted.value.feedbackUnitRef).toBeDefined();

      const request = await fixture.bridge.requestUpstreamProposal({
        bridgePacketRef: packet.value,
        toGrowUnitRef: setup.value.targetGrowUnitRef,
        reason: "attribute kernel gap upstream",
        policyContext: allowAll(),
        source: source(fixture, "system"),
        audit: audit("request upstream proposal")
      });
      expect(request.ok).toBe(true);
      if (!request.ok) throw new Error(request.error.message);

      const result = await fixture.bridge.recordUpstreamBridgeResult(request.value, {
        result: "accepted_upstream",
        reason: "upstream feng accepted the proposal",
        source: source(fixture, "system"),
        audit: audit("record upstream result")
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.status).toBe("proposed_upstream");
    });
  });

  it("keeps a single weakly-evidenced downstream failure local instead of attributing upstream", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const envelopeRefs = await envelopes(fixture, setup.value.correlationRef, 1);
      const packet = await fixture.bridge.buildFeedbackBridgePacket(setup.value.correlationRef, {
        envelopeRefs,
        summary: "single downstream failure with weak evidence",
        impact: "runtime_failure",
        candidateTargetLayer: "upstream_feng_project",
        intent: "upstream",
        policyContext: allowAll(),
        source: source(fixture, "system"),
        audit: audit("build weak packet")
      });
      if (!packet.ok) throw new Error(packet.error.message);
      const built = await fixture.bridge.getFeedbackBridgePacket(packet.value);
      if (!built.ok) throw new Error(built.error.message);
      expect(built.value.attribution.upstreamEligible).toBe(false);
      expect(built.value.suggestedAction).toBe("request_more_evidence");
      expect(built.value.localOnlyReason).toBeDefined();

      const request = await fixture.bridge.requestUpstreamProposal({
        bridgePacketRef: packet.value,
        toGrowUnitRef: setup.value.targetGrowUnitRef,
        reason: "should be blocked",
        policyContext: allowAll(),
        source: source(fixture, "system"),
        audit: audit("invalid upstream")
      });
      expect(request.ok).toBe(false);
      if (request.ok) throw new Error("expected upstream proposal to be blocked");
    });
  });

  it("builds a local feedback candidate packet and lists packets for the correlation", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const envelopeRefs = await envelopes(fixture, setup.value.correlationRef, 1);
      const packet = await fixture.bridge.buildFeedbackBridgePacket(setup.value.correlationRef, {
        envelopeRefs,
        summary: "local feedback candidate within the current project",
        impact: "context_gap",
        candidateTargetLayer: "current_project",
        intent: "local",
        source: source(fixture, "system"),
        audit: audit("build local packet")
      });
      if (!packet.ok) throw new Error(packet.error.message);
      const built = await fixture.bridge.getFeedbackBridgePacket(packet.value);
      if (!built.ok) throw new Error(built.error.message);
      expect(built.value.suggestedAction).toBe("create_local_feedback_candidate");
      expect(built.value.privacyClass).toBe("workspace_private");

      const submitted = await fixture.bridge.submitFeedbackCandidate(packet.value);
      expect(submitted.ok).toBe(true);
      const again = await fixture.bridge.submitFeedbackCandidate(packet.value);
      expect(again.ok).toBe(false);

      const upstream = await fixture.bridge.requestUpstreamProposal({
        bridgePacketRef: packet.value,
        toGrowUnitRef: setup.value.targetGrowUnitRef,
        reason: "local packet cannot attribute upstream",
        policyContext: allowAll(),
        source: source(fixture, "system"),
        audit: audit("blocked local upstream")
      });
      expect(upstream.ok).toBe(false);
      if (upstream.ok) throw new Error("expected attribution-insufficient rejection");
      expect(upstream.error.code).toBe("invalid_state");

      const list = await fixture.bridge.listBridgePackets(setup.value.correlationRef);
      expect(list.ok).toBe(true);
      if (!list.ok) throw new Error(list.error.message);
      expect(list.value.total).toBe(1);
    });
  });

  it("blocks an upstream proposal when the submitted packet has no redacted summary", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const refs = [];
      for (let index = 0; index < 2; index += 1) {
        const ref = await observe(fixture, setup.value.correlationRef, {
          summary: `local-intent report ${index} attributing an upstream gap`,
          evidenceRefs: [await evidence(fixture, `l${index}`)]
        });
        if (!ref.ok) throw new Error(ref.error.message);
        refs.push(ref.value);
      }
      const packet = await fixture.bridge.buildFeedbackBridgePacket(setup.value.correlationRef, {
        envelopeRefs: refs,
        summary: "upstream-eligible attribution but local intent leaves content unredacted",
        impact: "kernel_gap",
        candidateTargetLayer: "upstream_feng_project",
        confidenceHint: "high",
        intent: "local",
        source: source(fixture, "system"),
        audit: audit("local intent packet")
      });
      if (!packet.ok) throw new Error(packet.error.message);
      const built = await fixture.bridge.getFeedbackBridgePacket(packet.value);
      if (!built.ok) throw new Error(built.error.message);
      expect(built.value.attribution.upstreamEligible).toBe(true);
      expect(built.value.privacy.redactedSummaryRef).toBeUndefined();

      const submitted = await fixture.bridge.submitFeedbackCandidate(packet.value);
      expect(submitted.ok).toBe(true);
      const upstream = await fixture.bridge.requestUpstreamProposal({
        bridgePacketRef: packet.value,
        toGrowUnitRef: setup.value.targetGrowUnitRef,
        reason: "upstream without redaction",
        policyContext: allowAll(),
        source: source(fixture, "system"),
        audit: audit("unredacted upstream")
      });
      expect(upstream.ok).toBe(false);
      if (upstream.ok) throw new Error("expected redaction requirement");
      expect(upstream.error.code).toBe("redaction_required");
    });
  });

  it("rejects building a packet with no envelopes", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const packet = await fixture.bridge.buildFeedbackBridgePacket(setup.value.correlationRef, {
        envelopeRefs: [],
        summary: "no envelopes",
        impact: "unknown",
        candidateTargetLayer: "current_project",
        intent: "local",
        source: source(fixture, "system"),
        audit: audit("empty packet")
      });
      expect(packet.ok).toBe(false);
      if (packet.ok) throw new Error("expected empty envelope rejection");
      expect(packet.error.code).toBe("invalid_input");
    });
  });
});

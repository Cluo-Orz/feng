import { describe, expect, it } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import { allowAll, audit, evidence, makeBridgeFixture, observe, policy, setupCorrelation, source } from "./helpers.js";

describe("Debug Feedback Bridge privacy and policy boundary", () => {
  it("evaluates privacy with redaction and produces a redacted summary carrier", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const evidenceRef = await evidence(fixture, "raw private trace", "project_private");
      const privacy = await fixture.bridge.evaluateBridgePrivacy(setup.value.correlationRef, {
        inputArtifactRefs: [evidenceRef],
        privacyClasses: ["project_private"],
        intent: "upstream",
        source: source(fixture, "system"),
        audit: audit("evaluate privacy")
      });
      expect(privacy.ok).toBe(true);

      const redacted = await fixture.bridge.buildRedactedBridgeSummary(
        setup.value.correlationRef,
        [evidenceRef],
        "redacted cross-layer summary",
        source(fixture, "system"),
        audit("build redacted summary")
      );
      expect(redacted.ok).toBe(true);
    });
  });

  it("blocks upstream proposal when policy denies feedback.upstream", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const refs = [];
      for (let index = 0; index < 2; index += 1) {
        const ref = await observe(fixture, setup.value.correlationRef, {
          summary: `report ${index}`,
          evidenceRefs: [await evidence(fixture, `e${index}`)]
        });
        if (!ref.ok) throw new Error(ref.error.message);
        refs.push(ref.value);
      }
      const packet = await fixture.bridge.buildFeedbackBridgePacket(setup.value.correlationRef, {
        envelopeRefs: refs,
        summary: "well evidenced but policy denies upstream",
        impact: "kernel_gap",
        candidateTargetLayer: "upstream_feng_project",
        confidenceHint: "high",
        intent: "upstream",
        policyContext: policy([{ capability: "feedback.upstream", resource: "*", verdict: "deny" }]),
        source: source(fixture, "system"),
        audit: audit("build denied packet")
      });
      expect(packet.ok).toBe(true);
      if (!packet.ok) throw new Error(packet.error.message);
      const built = await fixture.bridge.getFeedbackBridgePacket(packet.value);
      if (!built.ok) throw new Error(built.error.message);
      expect(built.value.suggestedAction).toBe("keep_local_observation");
      expect(built.value.localOnlyReason).toContain("policy verdict");
    });
  });

  it("evaluates an explicit bridge policy request", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const decision = await fixture.bridge.evaluateBridgePolicy({
        debugCorrelationRef: setup.value.correlationRef,
        capability: "debug_trace.upload",
        resourceSummary: "runtime trace upload",
        operation: "upload_debug_trace",
        reason: "developer requested upload",
        source: source(fixture, "system"),
        policyContext: allowAll()
      });
      expect(decision.ok).toBe(true);
      if (!decision.ok) throw new Error(decision.error.message);
      expect(decision.value.verdict === "allow" || decision.value.verdict === "allow_with_constraints").toBe(true);
    });
  });

  it("evaluates a bridge policy request without an explicit policy context", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const decision = await fixture.bridge.evaluateBridgePolicy({
        debugCorrelationRef: setup.value.correlationRef,
        capability: "debug_trace.upload",
        resourceSummary: "runtime trace read",
        operation: "read_debug_trace",
        reason: "default policy evaluation",
        source: source(fixture, "system")
      });
      expect(decision.ok).toBe(true);
    });
  });

  it("classifies sensitive-local and unknown privacy decisions", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const sensitive = await fixture.bridge.evaluateBridgePrivacy(setup.value.correlationRef, {
        inputArtifactRefs: [await evidence(fixture, "user content", "contains_user_content")],
        privacyClasses: ["contains_user_content"],
        intent: "local",
        source: source(fixture, "system"),
        audit: audit("sensitive local privacy")
      });
      expect(sensitive.ok).toBe(true);
      const unknown = await fixture.bridge.evaluateBridgePrivacy(setup.value.correlationRef, {
        inputArtifactRefs: [],
        privacyClasses: ["unknown"],
        intent: "upstream",
        source: source(fixture, "system"),
        audit: audit("unknown privacy")
      });
      expect(unknown.ok).toBe(true);
    });
  });
});

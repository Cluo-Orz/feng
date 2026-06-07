import { describe, expect, it } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import { allowAll, audit, evidence, makeBridgeFixture, observe, openAnother, setupCorrelation, source } from "./helpers.js";
import {
  attributionIndexPath,
  correlationIndexPath,
  correlationPath,
  envelopeIndexPath,
  envelopePath,
  packetIndexPath,
  packetPath,
  privacyIndexPath
} from "../../src/debug-feedback-bridge/index.js";

describe("Debug Feedback Bridge corrupted-state propagation", () => {
  it("propagates storage errors when the correlation record is unreadable", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const ref = setup.value.correlationRef;
      const evidenceRef = await evidence(fixture, "evidence for corrupted packet");
      await workspace.store.writeTextAtomic(workspace.workspace, correlationPath(ref.id), "{bad", {
        reason: "corrupt correlation",
        createParents: true
      });

      const packet = await fixture.bridge.buildFeedbackBridgePacket(ref, {
        envelopeRefs: [{ kind: "runtime_report_envelope", id: "e" as never }],
        summary: "packet over corrupt correlation",
        impact: "unknown",
        candidateTargetLayer: "current_project",
        intent: "local",
        source: source(fixture, "system"),
        audit: audit("corrupt packet")
      });
      expect(packet.ok).toBe(false);

      const privacy = await fixture.bridge.evaluateBridgePrivacy(ref, {
        inputArtifactRefs: [evidenceRef],
        privacyClasses: ["workspace_private"],
        intent: "local",
        source: source(fixture, "system"),
        audit: audit("corrupt privacy")
      });
      expect(privacy.ok).toBe(false);

      const policy = await fixture.bridge.evaluateBridgePolicy({
        debugCorrelationRef: ref,
        capability: "debug_trace.upload",
        resourceSummary: "trace upload",
        operation: "upload_debug_trace",
        reason: "corrupt policy",
        source: source(fixture, "system"),
        policyContext: allowAll()
      });
      expect(policy.ok).toBe(false);

      const observation = await fixture.bridge.ingestManualObservation(ref, {
        summary: "observation over corrupt correlation",
        privacyClass: "workspace_private",
        evidenceRefs: [],
        source: source(fixture, "user"),
        audit: audit("corrupt observation")
      });
      expect(observation.ok).toBe(false);

      const closed = await fixture.bridge.closeDebugCorrelation(ref, "close corrupt correlation");
      expect(closed.ok).toBe(false);

      const summary = await fixture.bridge.buildRedactedBridgeSummary(
        ref,
        [evidenceRef],
        "redacted summary over corrupt correlation",
        source(fixture, "system"),
        audit("corrupt summary")
      );
      expect(summary.ok).toBe(false);
    });
  });

  it("propagates storage errors when packets and envelopes are unreadable", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const report = await observe(fixture, setup.value.correlationRef, { evidenceRefs: [await evidence(fixture, "e")] });
      if (!report.ok) throw new Error(report.error.message);
      const packet = await fixture.bridge.buildFeedbackBridgePacket(setup.value.correlationRef, {
        envelopeRefs: [report.value],
        summary: "packet to be corrupted",
        impact: "context_gap",
        candidateTargetLayer: "current_project",
        intent: "local",
        source: source(fixture, "system"),
        audit: audit("packet")
      });
      if (!packet.ok) throw new Error(packet.error.message);

      await workspace.store.writeTextAtomic(workspace.workspace, packetPath(packet.value.id), "{bad", {
        reason: "corrupt packet",
        createParents: true
      });
      expect((await fixture.bridge.getFeedbackBridgePacket(packet.value)).ok).toBe(false);
      expect((await fixture.bridge.explainFeedbackBridgePacket(packet.value)).ok).toBe(false);
      expect((await fixture.bridge.submitFeedbackCandidate(packet.value)).ok).toBe(false);
      const upstream = await fixture.bridge.requestUpstreamProposal({
        bridgePacketRef: packet.value,
        toGrowUnitRef: setup.value.targetGrowUnitRef,
        reason: "corrupt upstream",
        policyContext: allowAll(),
        source: source(fixture, "system"),
        audit: audit("corrupt upstream")
      });
      expect(upstream.ok).toBe(false);

      await workspace.store.writeTextAtomic(workspace.workspace, envelopePath(report.value.id), "{bad", {
        reason: "corrupt envelope",
        createParents: true
      });
      const overEnvelope = await fixture.bridge.buildFeedbackBridgePacket(setup.value.correlationRef, {
        envelopeRefs: [report.value],
        summary: "packet over corrupt envelope",
        impact: "context_gap",
        candidateTargetLayer: "current_project",
        intent: "local",
        source: source(fixture, "system"),
        audit: audit("corrupt envelope packet")
      });
      expect(overEnvelope.ok).toBe(false);
    });
  });

  it("propagates index write failures when persisting a packet", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const report = await observe(fixture, setup.value.correlationRef, { evidenceRefs: [await evidence(fixture, "e")] });
      if (!report.ok) throw new Error(report.error.message);
      await workspace.store.writeTextAtomic(workspace.workspace, packetIndexPath, "{bad", {
        reason: "corrupt packet index",
        createParents: true
      });
      const packet = await fixture.bridge.buildFeedbackBridgePacket(setup.value.correlationRef, {
        envelopeRefs: [report.value],
        summary: "packet blocked by corrupt index",
        impact: "context_gap",
        candidateTargetLayer: "current_project",
        intent: "local",
        source: source(fixture, "system"),
        audit: audit("index packet")
      });
      expect(packet.ok).toBe(false);
    });
  });

  it("propagates index write failures when persisting a privacy filter result", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      await workspace.store.writeTextAtomic(workspace.workspace, privacyIndexPath, "{bad", {
        reason: "corrupt privacy index",
        createParents: true
      });
      const privacy = await fixture.bridge.evaluateBridgePrivacy(setup.value.correlationRef, {
        inputArtifactRefs: [await evidence(fixture, "private evidence")],
        privacyClasses: ["workspace_private"],
        intent: "local",
        source: source(fixture, "system"),
        audit: audit("privacy index failure")
      });
      expect(privacy.ok).toBe(false);
    });
  });

  it("propagates index write failures when persisting correlations and envelopes", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      await workspace.store.writeTextAtomic(workspace.workspace, envelopeIndexPath, "{bad", {
        reason: "corrupt envelope index",
        createParents: true
      });
      const observation = await observe(fixture, setup.value.correlationRef, { evidenceRefs: [await evidence(fixture, "e")] });
      expect(observation.ok).toBe(false);

      await workspace.store.writeTextAtomic(workspace.workspace, correlationIndexPath, "{bad", {
        reason: "corrupt correlation index",
        createParents: true
      });
      await expect(openAnother(fixture, setup.value)).rejects.toThrow();
    });
  });

  it("propagates index write failures when persisting attribution", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const report = await observe(fixture, setup.value.correlationRef, { evidenceRefs: [await evidence(fixture, "e")] });
      if (!report.ok) throw new Error(report.error.message);
      await workspace.store.writeTextAtomic(workspace.workspace, attributionIndexPath, "{bad", {
        reason: "corrupt attribution index",
        createParents: true
      });
      const packet = await fixture.bridge.buildFeedbackBridgePacket(setup.value.correlationRef, {
        envelopeRefs: [report.value],
        summary: "packet blocked by corrupt attribution index",
        impact: "context_gap",
        candidateTargetLayer: "current_project",
        intent: "local",
        source: source(fixture, "system"),
        audit: audit("attribution index packet")
      });
      expect(packet.ok).toBe(false);
    });
  });
});

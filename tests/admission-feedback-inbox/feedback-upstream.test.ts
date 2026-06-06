import { describe, expect, test } from "vitest";
import { feedbackRecordPath } from "../../src/admission-feedback-inbox/paths.js";
import { withWorkspace } from "../file-store/helpers.js";
import {
  allowUpstreamPolicy,
  audit,
  createGrow,
  makeAdmissionFixture,
  policyId,
  receiveInput,
  source,
  textArtifactInput
} from "./helpers.js";

describe("Admission Feedback Inbox - feedback and upstream", () => {
  test("creates feedback as a candidate and enforces explicit status transitions", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAdmissionFixture(workspace);
      const grow = await createGrow(fixture);
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);
      const evidence = await fixture.artifacts.registerArtifact(textArtifactInput(fixture, "first trace"));
      expect(evidence.ok).toBe(true);
      if (!evidence.ok) throw new Error(evidence.error.message);

      const feedback = await fixture.admission.createFeedbackUnit({
        growUnitRef: grow.value,
        originLayer: "external_runtime",
        targetLayer: "target_agent_project",
        summary: "Boss turns too late after the player changes lane.",
        detail: receiveInput(fixture, "runtime reported late turn"),
        evidenceRefs: [evidence.value],
        attribution: "debug runtime",
        impact: "boss feels unresponsive",
        suggestedAction: "tighten lane-change reaction contract",
        privacyClass: "workspace_private",
        source: source(fixture, "runtime"),
        audit: audit("create feedback")
      });
      expect(feedback.ok).toBe(true);
      if (!feedback.ok) throw new Error(feedback.error.message);

      const listed = await fixture.admission.listFeedback(grow.value);
      expect(listed.ok).toBe(true);
      if (listed.ok) {
        expect(listed.value.records[0]?.status).toBe("candidate");
        expect(listed.value.records[0]?.detailRef?.kind).toBe("artifact");
      }

      const invalidUpstream = await fixture.admission.transitionFeedback(feedback.value, {
        to: "accepted_upstream",
        reason: "cannot skip proposal",
        source: source(fixture, "system"),
        audit: audit("invalid upstream")
      });
      expect(invalidUpstream.ok).toBe(false);
      if (!invalidUpstream.ok) expect(invalidUpstream.error.code).toBe("invalid_input");

      const accepted = await fixture.admission.transitionFeedback(feedback.value, {
        to: "accepted_local",
        reason: "valid local issue",
        source: source(fixture, "system"),
        audit: audit("accept local")
      });
      expect(accepted.ok).toBe(true);
      if (accepted.ok) expect(accepted.value.to).toBe("accepted_local");

      const moreEvidence = await fixture.artifacts.registerArtifact(textArtifactInput(fixture, "second trace"));
      expect(moreEvidence.ok).toBe(true);
      if (!moreEvidence.ok) throw new Error(moreEvidence.error.message);
      const linked = await fixture.admission.linkFeedbackEvidence(feedback.value, [moreEvidence.value], "add trace");
      expect(linked.ok).toBe(true);
      if (linked.ok) expect(linked.value.to).toBe("accepted_local");

      const redacted = await fixture.admission.redactFeedback(feedback.value, policyId("policy-redact"));
      expect(redacted.ok).toBe(true);
      if (redacted.ok) expect(redacted.value.to).toBe("redacted");
    });
  });

  test("creates upstream proposals only through redacted summary and policy, then records upstream result", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAdmissionFixture(workspace);
      const child = await createGrow(fixture, "xiaoshuo-agent");
      const parent = await createGrow(fixture, "feng");
      expect(child.ok).toBe(true);
      expect(parent.ok).toBe(true);
      if (!child.ok || !parent.ok) throw new Error("grow create failed");

      const feedback = await fixture.admission.createFeedbackUnit({
        growUnitRef: child.value,
        originLayer: "target_agent_project",
        targetLayer: "upstream_feng_project",
        summary: "Novel runtime needs reusable upstream feedback routing.",
        attribution: "xiaoshuo grow",
        impact: "same routing issue can repeat in future agents",
        suggestedAction: "generalize child-to-parent feedback proposal skill",
        privacyClass: "workspace_private",
        source: source(fixture, "system"),
        audit: audit("create upstream feedback")
      });
      expect(feedback.ok).toBe(true);
      if (!feedback.ok) throw new Error(feedback.error.message);
      const redactedSummary = await fixture.artifacts.registerArtifact(textArtifactInput(fixture, "redacted routing summary"));
      expect(redactedSummary.ok).toBe(true);
      if (!redactedSummary.ok) throw new Error(redactedSummary.error.message);

      const blocked = await fixture.admission.createUpstreamProposal({
        feedbackUnitRefs: [feedback.value],
        targetGrowUnitRef: parent.value,
        summary: "Reusable routing issue",
        redactedSummaryRef: redactedSummary.value,
        attribution: "child grow",
        privacyBoundary: "redacted child summary only",
        reason: "default policy asks for upstream movement",
        source: source(fixture, "system"),
        audit: audit("blocked proposal")
      });
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.error.code).toBe("upstream_policy_required");

      const stillCandidate = await fixture.admission.listFeedback(child.value, { status: "candidate" });
      expect(stillCandidate.ok).toBe(true);
      if (stillCandidate.ok) expect(stillCandidate.value.total).toBe(1);

      const proposal = await fixture.admission.createUpstreamProposal({
        feedbackUnitRefs: [feedback.value],
        targetGrowUnitRef: parent.value,
        summary: "Reusable routing issue",
        redactedSummaryRef: redactedSummary.value,
        attribution: "child grow",
        privacyBoundary: "redacted child summary only",
        reason: "explicitly allowed upstream proposal",
        source: source(fixture, "system"),
        audit: audit("create proposal"),
        policyContext: allowUpstreamPolicy()
      });
      expect(proposal.ok).toBe(true);
      if (!proposal.ok) throw new Error(proposal.error.message);

      const proposed = await fixture.admission.listFeedback(child.value, { status: "proposed_upstream" });
      expect(proposed.ok).toBe(true);
      if (proposed.ok) expect(proposed.value.total).toBe(1);
      const acceptedBeforeResult = await fixture.admission.listFeedback(child.value, { status: "accepted_upstream" });
      expect(acceptedBeforeResult.ok).toBe(true);
      if (acceptedBeforeResult.ok) expect(acceptedBeforeResult.value.total).toBe(0);

      const result = await fixture.admission.recordUpstreamResult(proposal.value, {
        result: "accepted_upstream",
        reason: "parent accepted reusable skill improvement",
        source: source(fixture, "system"),
        audit: audit("accept upstream")
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value[0]?.to).toBe("accepted_upstream");
    });
  });

  test("blocks unknown privacy upstream and rebuilds feedback records from the event stream", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAdmissionFixture(workspace);
      const child = await createGrow(fixture, "libai-agent");
      const parent = await createGrow(fixture, "xiaoshuo-agent");
      expect(child.ok).toBe(true);
      expect(parent.ok).toBe(true);
      if (!child.ok || !parent.ok) throw new Error("grow create failed");
      const feedback = await fixture.admission.createFeedbackUnit({
        growUnitRef: child.value,
        originLayer: "external_runtime",
        targetLayer: "target_agent_project",
        summary: "Chapter output drifted from the target voice.",
        attribution: "libai runtime",
        impact: "style consistency regression",
        suggestedAction: "add voice-consistency validation",
        privacyClass: "workspace_private",
        source: source(fixture, "runtime"),
        audit: audit("create recoverable feedback")
      });
      expect(feedback.ok).toBe(true);
      if (!feedback.ok) throw new Error(feedback.error.message);

      const unknownSummary = await fixture.artifacts.registerArtifact(textArtifactInput(fixture, "unknown privacy summary", {
        privacyClass: "unknown"
      }));
      expect(unknownSummary.ok).toBe(true);
      if (!unknownSummary.ok) throw new Error(unknownSummary.error.message);
      const blocked = await fixture.admission.createUpstreamProposal({
        feedbackUnitRefs: [feedback.value],
        targetGrowUnitRef: parent.value,
        summary: "Unknown privacy should not move upstream",
        redactedSummaryRef: unknownSummary.value,
        attribution: "privacy test",
        privacyBoundary: "unknown",
        reason: "privacy unknown",
        source: source(fixture, "system"),
        audit: audit("unknown upstream"),
        policyContext: allowUpstreamPolicy()
      });
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.error.code).toBe("privacy_blocked");

      const accepted = await fixture.admission.transitionFeedback(feedback.value, {
        to: "accepted_local",
        reason: "local issue accepted",
        source: source(fixture, "system"),
        audit: audit("accept before rebuild")
      });
      expect(accepted.ok).toBe(true);
      const removed = await fixture.store.removeFile(fixture.workspace, feedbackRecordPath(feedback.value.id), {
        reason: "remove feedback projection"
      });
      expect(removed.ok).toBe(true);

      const explained = await fixture.admission.explainAdmissionDecision(feedback.value);
      expect(explained.ok).toBe(true);
      if (explained.ok) expect(explained.value.facts).toContain("status=accepted_local");
    });
  });
});

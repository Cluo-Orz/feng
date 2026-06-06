import { describe, expect, test } from "vitest";
import { admissionEventTypes } from "../../src/admission-feedback-inbox/events.js";
import { feedbackStream } from "../../src/admission-feedback-inbox/index.js";
import { artifactPolicySummary, requirePolicyDecisionId } from "../../src/admission-feedback-inbox/policy.js";
import { projectFeedbackEvents } from "../../src/admission-feedback-inbox/projection.js";
import { makeArtifactId, makePolicyDecisionId, makeRef, type GrowUnitRef } from "../../src/domain/index.js";
import type { EventEnvelope } from "../../src/event-ledger/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import {
  type AdmissionFixture,
  allowUpstreamPolicy,
  audit,
  createGrow,
  makeAdmissionFixture,
  source,
  textArtifactInput
} from "./helpers.js";

describe("Admission Feedback Inbox - upstream edge coverage", () => {
  test("covers upstream validation, policy helpers, proposal explain, and projection errors", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAdmissionFixture(workspace);
      const child = await createGrow(fixture, "child");
      const other = await createGrow(fixture, "other");
      const parent = await createGrow(fixture, "parent");
      expect(child.ok && other.ok && parent.ok).toBe(true);
      if (!child.ok || !other.ok || !parent.ok) throw new Error("grow create failed");

      const empty = await fixture.admission.createUpstreamProposal({
        feedbackUnitRefs: [],
        targetGrowUnitRef: parent.value,
        summary: "empty",
        redactedSummaryRef: makeRef("artifact", makeArtifactId("artifact-none")),
        attribution: "test",
        privacyBoundary: "none",
        reason: "empty",
        source: source(fixture, "system"),
        audit: audit("empty proposal")
      });
      expect(empty.ok).toBe(false);

      const f1 = await createFeedback(fixture, child.value, "f1");
      const f2 = await createFeedback(fixture, other.value, "f2");
      const summary = await fixture.artifacts.registerArtifact(textArtifactInput(fixture, "safe upstream"));
      expect(f1.ok && f2.ok && summary.ok).toBe(true);
      if (!f1.ok || !f2.ok || !summary.ok) throw new Error("seed failed");

      const mixed = await fixture.admission.createUpstreamProposal({
        feedbackUnitRefs: [f1.value, f2.value],
        targetGrowUnitRef: parent.value,
        summary: "mixed",
        redactedSummaryRef: summary.value,
        attribution: "test",
        privacyBoundary: "safe",
        reason: "mixed grow",
        source: source(fixture, "system"),
        audit: audit("mixed"),
        policyContext: allowUpstreamPolicy()
      });
      expect(mixed.ok).toBe(false);

      const secretSummary = await fixture.artifacts.registerArtifact(textArtifactInput(fixture, "secret upstream", {
        privacyClass: "contains_secret"
      }));
      expect(secretSummary.ok).toBe(true);
      if (!secretSummary.ok) throw new Error(secretSummary.error.message);
      const secretBlocked = await fixture.admission.createUpstreamProposal({
        feedbackUnitRefs: [f1.value],
        targetGrowUnitRef: parent.value,
        summary: "secret blocked",
        redactedSummaryRef: secretSummary.value,
        attribution: "test",
        privacyBoundary: "secret",
        reason: "secret",
        source: source(fixture, "system"),
        audit: audit("secret proposal"),
        policyContext: allowUpstreamPolicy()
      });
      expect(secretBlocked.ok).toBe(false);
      if (!secretBlocked.ok) expect(secretBlocked.error.code).toBe("policy_blocked");

      const proposal = await fixture.admission.createUpstreamProposal({
        feedbackUnitRefs: [f1.value],
        targetGrowUnitRef: parent.value,
        summary: "safe proposal",
        redactedSummaryRef: summary.value,
        attribution: "test",
        privacyBoundary: "safe",
        reason: "safe",
        source: source(fixture, "system"),
        audit: audit("safe proposal"),
        policyContext: allowUpstreamPolicy()
      });
      expect(proposal.ok).toBe(true);
      if (!proposal.ok) throw new Error(proposal.error.message);
      const explained = await fixture.admission.explainAdmissionDecision(proposal.value);
      expect(explained.ok).toBe(true);
      if (explained.ok) expect(explained.value.facts).toContain("feedbackRefs=1");
      const rejected = await fixture.admission.recordUpstreamResult(proposal.value, {
        result: "rejected",
        reason: "parent rejected",
        source: source(fixture, "system"),
        audit: audit("reject upstream")
      });
      expect(rejected.ok).toBe(true);

      await expectUpstreamWaitResult(fixture, child.value, parent.value, "waiting_evidence");
      await expectUpstreamWaitResult(fixture, child.value, parent.value, "waiting_human");

      const fakeArtifact = makeRef("artifact", makeArtifactId("artifact-missing-policy"));
      const missingPolicySummary = await artifactPolicySummary(fixture.artifacts, fakeArtifact);
      expect(missingPolicySummary.ok).toBe(false);
      expect(requirePolicyDecisionId(undefined).ok).toBe(false);
      expect(requirePolicyDecisionId(makePolicyDecisionId("policy-existing")).ok).toBe(true);

      const noEvents = projectFeedbackEvents([]);
      expect(noEvents.ok).toBe(false);
      const malformedCreate = projectFeedbackEvents([event(admissionEventTypes.feedbackUnitCreated, {})]);
      expect(malformedCreate.ok).toBe(false);
      const record = await fixture.admission.listFeedback(child.value, { status: "rejected" });
      expect(record.ok).toBe(true);
      if (!record.ok || record.value.records[0] === undefined) throw new Error("missing rejected record");
      const invalidStatus = projectFeedbackEvents([
        event(admissionEventTypes.feedbackUnitCreated, { record: record.value.records[0] }),
        event(admissionEventTypes.feedbackStatusChanged, { to: "bad-status" })
      ]);
      expect(invalidStatus.ok).toBe(false);
      const replay = await fixture.ledger.replayStream(feedbackStream(f2.value), { reason: "edge replay" });
      expect(replay.ok).toBe(true);
    });
  });
});

async function createFeedback(fixture: AdmissionFixture, growUnitRef: GrowUnitRef, summary: string) {
  return fixture.admission.createFeedbackUnit({
    growUnitRef,
    originLayer: "external_runtime",
    targetLayer: "target_agent_project",
    summary,
    attribution: "runtime",
    impact: "medium",
    suggestedAction: "fix",
    privacyClass: "workspace_private",
    source: source(fixture, "runtime"),
    audit: audit(`create ${summary}`)
  });
}

async function expectUpstreamWaitResult(
  fixture: AdmissionFixture,
  child: GrowUnitRef,
  parent: GrowUnitRef,
  result: "waiting_evidence" | "waiting_human"
) {
  const feedback = await createFeedback(fixture, child, `${result} feedback`);
  const summary = await fixture.artifacts.registerArtifact(textArtifactInput(fixture, `${result} summary`));
  expect(feedback.ok && summary.ok).toBe(true);
  if (!feedback.ok || !summary.ok) throw new Error(`${result} seed failed`);
  const proposal = await fixture.admission.createUpstreamProposal({
    feedbackUnitRefs: [feedback.value],
    targetGrowUnitRef: parent,
    summary: `${result} proposal`,
    redactedSummaryRef: summary.value,
    attribution: "test",
    privacyBoundary: "safe",
    reason: `${result} proposal`,
    source: source(fixture, "system"),
    audit: audit(`${result} proposal`),
    policyContext: allowUpstreamPolicy()
  });
  expect(proposal.ok).toBe(true);
  if (!proposal.ok) throw new Error(proposal.error.message);
  const recorded = await fixture.admission.recordUpstreamResult(proposal.value, {
    result,
    reason: `${result} result`,
    source: source(fixture, "system"),
    audit: audit(`${result} result`)
  });
  expect(recorded.ok).toBe(true);
}

function event(eventType: string, payload: Record<string, unknown>): EventEnvelope {
  return { eventType, payload } as unknown as EventEnvelope;
}

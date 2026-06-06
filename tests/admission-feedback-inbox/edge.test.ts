import { describe, expect, test } from "vitest";
import { makeArtifactId, makeRef, type FeedbackUnitRef } from "../../src/domain/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import {
  audit,
  createGrow,
  makeAdmissionFixture,
  receiveInput,
  source,
  textArtifactInput
} from "./helpers.js";

describe("Admission Feedback Inbox - edge coverage", () => {
  test("covers receive variants, repeated normalization, waiting decisions, reject, and local-only", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAdmissionFixture(workspace);
      const grow = await createGrow(fixture);
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);
      const invalid = await fixture.admission.receiveUserInput(grow.value, {
        privacyClass: "workspace_private",
        version: { schemaVersion: "1" },
        source: source(fixture, "user"),
        audit: audit("invalid receive")
      });
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) expect(invalid.error.code).toBe("invalid_input");

      const existing = await fixture.artifacts.registerArtifact(textArtifactInput(fixture, "existing file material"));
      expect(existing.ok).toBe(true);
      if (!existing.ok) throw new Error(existing.error.message);
      const material = await fixture.admission.receiveMaterial(grow.value, {
        existingArtifactRef: existing.value,
        privacyClass: "workspace_private",
        version: { schemaVersion: "1" },
        source: source(fixture, "user"),
        audit: audit("receive existing")
      });
      expect(material.ok).toBe(true);
      if (!material.ok) throw new Error(material.error.message);
      const normalized = await fixture.admission.normalizeInboxItem(material.value);
      expect(normalized.ok).toBe(true);
      const normalizedAgain = await fixture.admission.normalizeInboxItem(material.value);
      expect(normalizedAgain.ok).toBe(true);

      const runtime = await fixture.admission.receiveRuntimeReport(grow.value, receiveInput(fixture, "runtime crashed"));
      expect(runtime.ok).toBe(true);
      if (runtime.ok) {
        const classified = await fixture.admission.classifyInboxItem(runtime.value);
        expect(classified.ok).toBe(true);
        if (classified.ok) expect(classified.value.suggestedDecision).toBe("admit_as_feedback_candidate");
      }
      const external = await fixture.admission.receiveExternalEvent(grow.value, receiveInput(fixture, "plain reference material"));
      expect(external.ok).toBe(true);
      if (external.ok) {
        const classified = await fixture.admission.classifyInboxItem(external.value);
        expect(classified.ok).toBe(true);
        if (classified.ok) expect(classified.value.suggestedDecision).toBe("admit_as_material");
      }

      const waiting = await fixture.admission.decideAdmission(material.value, {
        decision: "wait_for_evidence",
        reason: "needs trace",
        source: source(fixture, "system"),
        audit: audit("wait evidence")
      });
      expect(waiting.ok).toBe(true);
      const localOnlyWrongState = await fixture.admission.decideAdmission(material.value, {
        decision: "local_only",
        reason: "wrong state",
        source: source(fixture, "system"),
        audit: audit("wrong local only")
      });
      expect(localOnlyWrongState.ok).toBe(false);
      if (!localOnlyWrongState.ok) expect(localOnlyWrongState.error.code).toBe("admission_conflict");

      const redacted = await fixture.artifacts.registerArtifact(textArtifactInput(fixture, "redacted safe summary"));
      expect(redacted.ok).toBe(true);
      if (!redacted.ok) throw new Error(redacted.error.message);
      const upstreamInbox = await fixture.admission.receiveMaterial(grow.value, receiveInput(fixture, "upstream candidate"));
      expect(upstreamInbox.ok).toBe(true);
      if (!upstreamInbox.ok) throw new Error(upstreamInbox.error.message);
      await fixture.admission.decideAdmission(upstreamInbox.value, {
        decision: "propose_upstream",
        reason: "policy later",
        redactedArtifactRef: redacted.value,
        source: source(fixture, "system"),
        audit: audit("waiting policy")
      });
      const localOnly = await fixture.admission.decideAdmission(upstreamInbox.value, {
        decision: "local_only",
        reason: "keep local",
        source: source(fixture, "system"),
        audit: audit("local only")
      });
      expect(localOnly.ok).toBe(true);

      const rejectedRef = await fixture.admission.receiveUserInput(grow.value, receiveInput(fixture, "irrelevant"));
      expect(rejectedRef.ok).toBe(true);
      if (!rejectedRef.ok) throw new Error(rejectedRef.error.message);
      const rejected = await fixture.admission.decideAdmission(rejectedRef.value, {
        decision: "reject",
        reason: "out of boundary",
        source: source(fixture, "system"),
        audit: audit("reject")
      });
      expect(rejected.ok).toBe(true);
      const finalRewrite = await fixture.admission.decideAdmission(rejectedRef.value, {
        decision: "wait_for_human",
        reason: "should not rewrite",
        source: source(fixture, "system"),
        audit: audit("rewrite rejected")
      });
      expect(finalRewrite.ok).toBe(false);
    });
  });

  test("covers feedback validation, missing artifacts, invalid transitions, and missing replay", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAdmissionFixture(workspace);
      const grow = await createGrow(fixture);
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);
      const emptySummary = await fixture.admission.createFeedbackUnit({
        growUnitRef: grow.value,
        originLayer: "external_runtime",
        targetLayer: "target_agent_project",
        summary: " ",
        attribution: "runtime",
        impact: "none",
        suggestedAction: "none",
        privacyClass: "workspace_private",
        source: source(fixture, "runtime"),
        audit: audit("empty summary")
      });
      expect(emptySummary.ok).toBe(false);

      const missingRef = makeRef("artifact", makeArtifactId("artifact-missing"));
      const missingEvidence = await fixture.admission.createFeedbackUnit({
        growUnitRef: grow.value,
        originLayer: "external_runtime",
        targetLayer: "target_agent_project",
        summary: "has missing evidence",
        evidenceRefs: [missingRef],
        attribution: "runtime",
        impact: "bad",
        suggestedAction: "fix",
        privacyClass: "workspace_private",
        source: source(fixture, "runtime"),
        audit: audit("missing evidence")
      });
      expect(missingEvidence.ok).toBe(false);

      const missingAttribution = await fixture.admission.createFeedbackUnit({
        growUnitRef: grow.value,
        originLayer: "external_runtime",
        targetLayer: "target_agent_project",
        summary: "missing attribution",
        attribution: " ",
        impact: "bad",
        suggestedAction: "fix",
        privacyClass: "workspace_private",
        source: source(fixture, "runtime"),
        audit: audit("missing attribution")
      });
      expect(missingAttribution.ok).toBe(false);

      const detailRef = await fixture.artifacts.registerArtifact(textArtifactInput(fixture, "detail ref"));
      expect(detailRef.ok).toBe(true);
      if (!detailRef.ok) throw new Error(detailRef.error.message);
      const detailRefOnly = await fixture.admission.createFeedbackUnit({
        growUnitRef: grow.value,
        originLayer: "external_runtime",
        targetLayer: "target_agent_project",
        summary: "detail ref only",
        detailRef: detailRef.value,
        attribution: "runtime",
        impact: "medium",
        suggestedAction: "fix",
        privacyClass: "workspace_private",
        source: source(fixture, "runtime"),
        audit: audit("detail ref only")
      });
      expect(detailRefOnly.ok).toBe(true);
      const bothDetail = await fixture.admission.createFeedbackUnit({
        growUnitRef: grow.value,
        originLayer: "external_runtime",
        targetLayer: "target_agent_project",
        summary: "bad detail input",
        detail: receiveInput(fixture, "detail"),
        detailRef: detailRef.value,
        attribution: "runtime",
        impact: "bad",
        suggestedAction: "fix",
        privacyClass: "workspace_private",
        source: source(fixture, "runtime"),
        audit: audit("both detail")
      });
      expect(bothDetail.ok).toBe(false);

      const feedback = await fixture.admission.createFeedbackUnit({
        growUnitRef: grow.value,
        originLayer: "external_runtime",
        targetLayer: "target_agent_project",
        summary: "ignorable feedback",
        attribution: "runtime",
        impact: "low",
        suggestedAction: "ignore",
        privacyClass: "workspace_private",
        source: source(fixture, "runtime"),
        audit: audit("create ignored")
      });
      expect(feedback.ok).toBe(true);
      if (!feedback.ok) throw new Error(feedback.error.message);
      const ignored = await fixture.admission.transitionFeedback(feedback.value, {
        to: "ignored",
        reason: "not useful",
        source: source(fixture, "system"),
        audit: audit("ignore")
      });
      expect(ignored.ok).toBe(true);
      const invalidTransition = await fixture.admission.transitionFeedback(feedback.value, {
        to: "accepted_local",
        reason: "cannot reopen ignored",
        source: source(fixture, "system"),
        audit: audit("invalid transition")
      });
      expect(invalidTransition.ok).toBe(false);
      const feedbackPage = await fixture.admission.listFeedback(grow.value, { limit: 1 });
      expect(feedbackPage.ok).toBe(true);
      if (feedbackPage.ok) expect(feedbackPage.value.nextCursor).toBe("1");

      const fakeFeedback = makeRef("feedback_unit", "feedback-missing" as FeedbackUnitRef["id"]);
      const missingExplain = await fixture.admission.explainAdmissionDecision(fakeFeedback);
      expect(missingExplain.ok).toBe(false);
    });
  });

  test("refuses admission writes after grow unit archival", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAdmissionFixture(workspace);
      const grow = await createGrow(fixture, "archived-grow");
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);
      const archived = await fixture.grow.archiveGrowUnit(grow.value, {
        reason: "archive for admission edge",
        source: source(fixture, "system"),
        audit: audit("archive"),
        policyContext: {
          caller: "grow-unit-manager",
          environment: {
            hostSandboxAvailable: false,
            networkAvailable: false,
            externalEnforcementAvailable: false,
            secretStoreAvailable: false
          },
          rules: [{ capability: "file.delete", resource: "grow-unit:*", verdict: "allow" }]
        }
      });
      expect(archived.ok).toBe(true);
      const received = await fixture.admission.receiveUserInput(grow.value, receiveInput(fixture, "too late"));
      expect(received.ok).toBe(false);
      if (!received.ok) expect(received.error.code).toBe("grow_unit_archived");
    });
  });
});

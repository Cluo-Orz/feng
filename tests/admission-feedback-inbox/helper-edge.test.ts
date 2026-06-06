import { describe, expect, test } from "vitest";
import { registerInboxPayload, resolvePayloadRef } from "../../src/admission-feedback-inbox/artifacts.js";
import { admissionEventTypes } from "../../src/admission-feedback-inbox/events.js";
import { projectFeedbackEvents } from "../../src/admission-feedback-inbox/projection.js";
import { createAdmissionRuntime } from "../../src/admission-feedback-inbox/runtime.js";
import { makeUpstreamProposalRef } from "../../src/admission-feedback-inbox/refs.js";
import { makeUpstreamProposalId } from "../../src/admission-feedback-inbox/brand.js";
import { makeArtifactId, makeRef, type ArtifactRef } from "../../src/domain/index.js";
import type { EventEnvelope } from "../../src/event-ledger/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import { audit, createGrow, makeAdmissionFixture, receiveInput, source, textArtifactInput, version } from "./helpers.js";

describe("Admission Feedback Inbox - helper edges", () => {
  test("maps payload source kinds, binary defaults, override summaries, and missing existing refs", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAdmissionFixture(workspace);
      const runtime = createAdmissionRuntime(fixture.store, {
        workspace: fixture.workspace,
        ledger: fixture.ledger,
        artifactRegistry: fixture.artifacts,
        policyBoundary: fixture.policy,
        skillRegistry: fixture.skills,
        growUnitManager: fixture.grow,
        producer: "admission-test"
      });

      const toolPayload = await resolvePayloadRef(runtime, "tool_result_reference", {
        content: new Uint8Array([1, 2, 3]),
        privacyClass: "workspace_private",
        version,
        source: source(fixture, "tool"),
        audit: audit("tool payload")
      });
      expect(toolPayload.ok).toBe(true);
      if (!toolPayload.ok) throw new Error(toolPayload.error.message);
      const toolRecord = await fixture.artifacts.resolveArtifact(toolPayload.value);
      expect(toolRecord.ok).toBe(true);
      if (toolRecord.ok) {
        expect(toolRecord.value.kind).toBe("tool_result");
        expect(toolRecord.value.encoding).toBe("binary");
        expect(toolRecord.value.retentionClass).toBe("attempt_scoped");
        expect(toolRecord.value.producerModule).toBe("tool-runtime");
      }

      const manual = await registerInboxPayload(runtime, "manual_review", {
        content: "manual review body",
        normalizedSummary: " override summary ",
        privacyClass: "workspace_private",
        version,
        source: source(fixture, "user"),
        audit: audit("manual review"),
        correlationId: "corr-1"
      });
      expect(manual.ok).toBe(true);
      if (manual.ok) expect(manual.value.normalizedSummary).toBe("override summary");

      const debugTrace = await resolvePayloadRef(runtime, "debug_trace", receiveInput(fixture, "debug trace"));
      expect(debugTrace.ok).toBe(true);
      if (debugTrace.ok) {
        const record = await fixture.artifacts.resolveArtifact(debugTrace.value);
        expect(record.ok).toBe(true);
        if (record.ok) expect(record.value.retentionClass).toBe("runtime_scoped");
      }

      const missing = await resolvePayloadRef(runtime, "file_change", {
        existingArtifactRef: makeRef("artifact", makeArtifactId("artifact-missing-helper")),
        privacyClass: "workspace_private",
        version,
        source: source(fixture, "system"),
        audit: audit("missing existing")
      });
      expect(missing.ok).toBe(false);
    });
  });

  test("covers pagination, classification context, long summaries, and projection evidence branches", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAdmissionFixture(workspace);
      const grow = await createGrow(fixture);
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);

      const first = await fixture.admission.receiveUserInput(grow.value, receiveInput(fixture, "first agent goal", {
        normalizedSummary: "x".repeat(1_100),
        correlationId: "corr-page",
        causationId: "cause-page"
      }));
      const second = await fixture.admission.receiveUserInput(grow.value, receiveInput(fixture, "second bug failure"));
      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) throw new Error("inbox seed failed");
      const classified = await fixture.admission.classifyInboxItem(first.value, {
        growStateSummary: "growing",
        defaultFeedbackRouterSummary: "route as feedback if regression"
      });
      expect(classified.ok).toBe(true);
      if (classified.ok) expect(classified.value.reason).toContain("grow state supplied");
      const page = await fixture.admission.listPendingInbox(grow.value, { limit: 1 });
      expect(page.ok).toBe(true);
      if (page.ok) expect(page.value.nextCursor).toBe("1");

      const evidence = await fixture.artifacts.registerArtifact(textArtifactInput(fixture, "projection evidence"));
      expect(evidence.ok).toBe(true);
      if (!evidence.ok) throw new Error(evidence.error.message);
      const feedback = await fixture.admission.createFeedbackUnit({
        growUnitRef: grow.value,
        originLayer: "external_runtime",
        targetLayer: "target_agent_project",
        summary: "projection feedback",
        runtimeTraceRefs: [evidence.value],
        attribution: "runtime",
        impact: "medium",
        suggestedAction: "fix",
        privacyClass: "workspace_private",
        source: source(fixture, "runtime"),
        audit: audit("projection feedback")
      });
      expect(feedback.ok).toBe(true);
      if (!feedback.ok) throw new Error(feedback.error.message);
      const feedbackPage = await fixture.admission.listFeedback(grow.value, { limit: 1 });
      expect(feedbackPage.ok).toBe(true);
      if (feedbackPage.ok) expect(feedbackPage.value.records[0]?.runtimeTraceRefs).toHaveLength(1);

      const record = feedbackPage.ok ? feedbackPage.value.records[0] : undefined;
      if (record === undefined) throw new Error("missing feedback record");
      const proposalRef = makeUpstreamProposalRef(makeUpstreamProposalId("proposal-projection"));
      const projected = projectFeedbackEvents([
        event(admissionEventTypes.feedbackStatusChanged, { to: "accepted_local" }),
        event(admissionEventTypes.feedbackUnitCreated, { record }),
        event(admissionEventTypes.feedbackEvidenceLinked, { evidenceRefs: [evidence.value, { kind: "not_artifact" }] }),
        event(admissionEventTypes.feedbackStatusChanged, {
          to: "proposed_upstream",
          policyDecisionId: "policy-projection",
          upstreamProposalRef: proposalRef
        })
      ]);
      expect(projected.ok).toBe(true);
      if (projected.ok) {
        expect(projected.value.evidenceRefs.map((ref: ArtifactRef) => ref.id)).toContain(evidence.value.id);
        expect(projected.value.upstreamProposalRef?.id).toBe(proposalRef.id);
      }
    });
  });
});

function event(eventType: string, payload: Record<string, unknown>): EventEnvelope {
  return { eventType, payload } as unknown as EventEnvelope;
}

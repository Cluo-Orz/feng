import { describe, expect, test } from "vitest";
import { admissionEventTypes, admissionGrowStream } from "../../src/admission-feedback-inbox/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import {
  activateDefaultRouter,
  audit,
  createGrow,
  makeAdmissionFixture,
  receiveInput,
  source,
  textArtifactInput
} from "./helpers.js";

describe("Admission Feedback Inbox - inbox admission", () => {
  test("receives, normalizes, classifies, and admits without exposing message-list semantics", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAdmissionFixture(workspace);
      const router = await activateDefaultRouter(fixture);
      expect(router.ok).toBe(true);
      const grow = await createGrow(fixture);
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);

      const inboxRef = await fixture.admission.receiveUserInput(
        grow.value,
        receiveInput(fixture, "I want to make a boss agent that reacts to world state.")
      );
      expect(inboxRef.ok).toBe(true);
      if (!inboxRef.ok) throw new Error(inboxRef.error.message);

      const pending = await fixture.admission.listPendingInbox(grow.value);
      expect(pending.ok).toBe(true);
      if (pending.ok) {
        expect(pending.value.total).toBe(1);
        expect(pending.value.items[0]?.status).toBe("received");
      }

      const replay = await fixture.ledger.replayStream(admissionGrowStream(grow.value), { reason: "inbox replay" });
      expect(replay.ok).toBe(true);
      if (replay.ok) {
        expect(replay.value.events.some((event) => event.eventType === admissionEventTypes.inboxItemReceived)).toBe(true);
      }

      const normalized = await fixture.admission.normalizeInboxItem(inboxRef.value);
      expect(normalized.ok).toBe(true);
      if (normalized.ok) expect(normalized.value.normalizedSummary).toContain("boss agent");

      const classified = await fixture.admission.classifyInboxItem(inboxRef.value);
      expect(classified.ok).toBe(true);
      if (classified.ok) {
        expect(classified.value.suggestedDecision).toBe("admit_as_goal_signal");
        expect(classified.value.routerSkillRefs).toHaveLength(1);
        expect(JSON.stringify(classified.value)).not.toContain("Never inline this body");
      }

      const admitted = await fixture.admission.decideAdmission(inboxRef.value, {
        decision: "admit_as_goal_signal",
        reason: "goal signal for grow",
        source: source(fixture, "system"),
        audit: audit("admit goal")
      });
      expect(admitted.ok).toBe(true);
      if (admitted.ok) expect(admitted.value.to).toBe("admitted");

      const defaultPending = await fixture.admission.listPendingInbox(grow.value);
      expect(defaultPending.ok).toBe(true);
      if (defaultPending.ok) expect(defaultPending.value.total).toBe(0);
      const admittedItems = await fixture.admission.listPendingInbox(grow.value, { status: "admitted" });
      expect(admittedItems.ok).toBe(true);
      if (admittedItems.ok) expect(admittedItems.value.total).toBe(1);

      const explained = await fixture.admission.explainAdmissionDecision(inboxRef.value);
      expect(explained.ok).toBe(true);
      if (explained.ok) {
        expect(explained.value.facts).toContain("decision=admit_as_goal_signal");
        expect(JSON.stringify(explained.value)).not.toMatch(/message_list|session/i);
      }
    });
  });

  test("keeps secret and upstream-bound items behind explicit redaction and final statuses", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAdmissionFixture(workspace);
      const grow = await createGrow(fixture);
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);

      const inboxRef = await fixture.admission.receiveUserInput(
        grow.value,
        receiveInput(fixture, "contains a token-like secret", { privacyClass: "contains_secret" })
      );
      expect(inboxRef.ok).toBe(true);
      if (!inboxRef.ok) throw new Error(inboxRef.error.message);

      const classified = await fixture.admission.classifyInboxItem(inboxRef.value);
      expect(classified.ok).toBe(true);
      if (classified.ok) expect(classified.value.suggestedDecision).toBe("quarantine");

      const missingRedaction = await fixture.admission.decideAdmission(inboxRef.value, {
        decision: "redact_then_admit",
        reason: "needs redaction first",
        source: source(fixture, "system"),
        audit: audit("redaction required")
      });
      expect(missingRedaction.ok).toBe(false);
      if (!missingRedaction.ok) expect(missingRedaction.error.code).toBe("redaction_required");

      const quarantined = await fixture.admission.decideAdmission(inboxRef.value, {
        decision: "quarantine",
        reason: "secret cannot enter grow material",
        source: source(fixture, "system"),
        audit: audit("quarantine secret")
      });
      expect(quarantined.ok).toBe(true);
      const explained = await fixture.admission.explainAdmissionDecision(inboxRef.value);
      expect(explained.ok).toBe(true);
      if (explained.ok) expect(explained.value.summary).toBe("content withheld by privacy metadata");

      const rewrite = await fixture.admission.decideAdmission(inboxRef.value, {
        decision: "admit_as_material",
        reason: "should not rewrite final status",
        source: source(fixture, "system"),
        audit: audit("rewrite final")
      });
      expect(rewrite.ok).toBe(false);
      if (!rewrite.ok) expect(rewrite.error.code).toBe("admission_conflict");
    });
  });

  test("marks upstream intent as waiting policy without creating an upstream proposal", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAdmissionFixture(workspace);
      const grow = await createGrow(fixture);
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);
      const redacted = await fixture.artifacts.registerArtifact(textArtifactInput(fixture, "safe summary"));
      expect(redacted.ok).toBe(true);
      if (!redacted.ok) throw new Error(redacted.error.message);

      const inboxRef = await fixture.admission.receiveMaterial(grow.value, receiveInput(fixture, "runtime issue summary"));
      expect(inboxRef.ok).toBe(true);
      if (!inboxRef.ok) throw new Error(inboxRef.error.message);
      const waiting = await fixture.admission.decideAdmission(inboxRef.value, {
        decision: "propose_upstream",
        reason: "candidate upstream learning",
        redactedArtifactRef: redacted.value,
        source: source(fixture, "system"),
        audit: audit("mark waiting policy")
      });
      expect(waiting.ok).toBe(true);
      if (waiting.ok) expect(waiting.value.to).toBe("waiting_policy");

      const summary = await fixture.admission.buildAdmissionSummary(grow.value);
      expect(summary.ok).toBe(true);
      if (summary.ok) {
        expect(summary.value.pendingInboxCount).toBe(1);
        expect(summary.value.proposedUpstreamCount).toBe(0);
      }
    });
  });
});

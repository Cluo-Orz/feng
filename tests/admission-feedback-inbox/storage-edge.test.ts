import { describe, expect, test } from "vitest";
import { AdmissionStorage } from "../../src/admission-feedback-inbox/storage.js";
import { makeInboxItemId, makeUpstreamProposalId } from "../../src/admission-feedback-inbox/brand.js";
import { makeFeedbackUnitRef, makeInboxItemRef, makeUpstreamProposalRef } from "../../src/admission-feedback-inbox/refs.js";
import {
  feedbackIndexPath,
  feedbackRecordPath,
  inboxIndexPath,
  inboxRecordPath,
  proposalIndexPath,
  proposalRecordPath
} from "../../src/admission-feedback-inbox/paths.js";
import { makeFeedbackUnitId } from "../../src/domain/index.js";
import { withWorkspace } from "../file-store/helpers.js";

describe("Admission Feedback Inbox - file storage edges", () => {
  test("skips missing indexed records and keeps duplicate refs idempotent", async () => {
    await withWorkspace(async (workspace) => {
      const storage = new AdmissionStorage(workspace.store, workspace.workspace);
      const inboxRef = makeInboxItemRef(makeInboxItemId("inbox-missing"));
      const feedbackRef = makeFeedbackUnitRef(makeFeedbackUnitId("feedback-missing"));
      const proposalRef = makeUpstreamProposalRef(makeUpstreamProposalId("proposal-missing"));

      expect((await storage.addInbox(inboxRef)).ok).toBe(true);
      expect((await storage.addInbox(inboxRef)).ok).toBe(true);
      const inbox = await storage.readAllInbox();
      expect(inbox.ok).toBe(true);
      if (inbox.ok) expect(inbox.value).toHaveLength(0);

      expect((await storage.addFeedback(feedbackRef)).ok).toBe(true);
      expect((await storage.addFeedback(feedbackRef)).ok).toBe(true);
      const feedback = await storage.readAllFeedback();
      expect(feedback.ok).toBe(true);
      if (feedback.ok) expect(feedback.value).toHaveLength(0);

      expect((await storage.addProposal(proposalRef)).ok).toBe(true);
      expect((await storage.addProposal(proposalRef)).ok).toBe(true);
      const proposals = await storage.readAllProposals();
      expect(proposals.ok).toBe(true);
      if (proposals.ok) expect(proposals.value).toHaveLength(0);
    });
  });

  test("reports invalid indexes and invalid records as schema errors", async () => {
    await withWorkspace(async (workspace) => {
      const storage = new AdmissionStorage(workspace.store, workspace.workspace);
      await workspace.store.writeTextAtomic(workspace.workspace, inboxIndexPath, "not-json", {
        reason: "bad inbox index",
        createParents: true
      });
      const badInboxIndex = await storage.readAllInbox();
      expect(badInboxIndex.ok).toBe(false);
      if (!badInboxIndex.ok) expect(badInboxIndex.error.code).toBe("schema_incompatible");
    });

    await withWorkspace(async (workspace) => {
      const storage = new AdmissionStorage(workspace.store, workspace.workspace);
      await workspace.store.writeTextAtomic(workspace.workspace, feedbackIndexPath, "not-json", {
        reason: "bad feedback index",
        createParents: true
      });
      const badFeedbackIndex = await storage.readAllFeedback();
      expect(badFeedbackIndex.ok).toBe(false);
      if (!badFeedbackIndex.ok) expect(badFeedbackIndex.error.code).toBe("schema_incompatible");
    });

    await withWorkspace(async (workspace) => {
      const storage = new AdmissionStorage(workspace.store, workspace.workspace);
      await workspace.store.writeTextAtomic(workspace.workspace, proposalIndexPath, "not-json", {
        reason: "bad proposal index",
        createParents: true
      });
      const badProposalIndex = await storage.readAllProposals();
      expect(badProposalIndex.ok).toBe(false);
      if (!badProposalIndex.ok) expect(badProposalIndex.error.code).toBe("schema_incompatible");
    });
  });

  test("reports malformed record JSON for each record kind", async () => {
    await withWorkspace(async (workspace) => {
      const storage = new AdmissionStorage(workspace.store, workspace.workspace);
      const inboxRef = makeInboxItemRef(makeInboxItemId("inbox-bad"));
      await workspace.store.writeTextAtomic(workspace.workspace, inboxRecordPath(inboxRef.id), "{", {
        reason: "bad inbox record",
        createParents: true
      });
      const bad = await storage.readInbox(inboxRef);
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.error.code).toBe("schema_incompatible");
    });

    await withWorkspace(async (workspace) => {
      const storage = new AdmissionStorage(workspace.store, workspace.workspace);
      const feedbackRef = makeFeedbackUnitRef(makeFeedbackUnitId("feedback-bad"));
      await workspace.store.writeTextAtomic(workspace.workspace, feedbackRecordPath(feedbackRef.id), "{", {
        reason: "bad feedback record",
        createParents: true
      });
      const bad = await storage.readFeedback(feedbackRef);
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.error.code).toBe("schema_incompatible");
    });

    await withWorkspace(async (workspace) => {
      const storage = new AdmissionStorage(workspace.store, workspace.workspace);
      const proposalRef = makeUpstreamProposalRef(makeUpstreamProposalId("proposal-bad"));
      await workspace.store.writeTextAtomic(workspace.workspace, proposalRecordPath(proposalRef.id), "{", {
        reason: "bad proposal record",
        createParents: true
      });
      const bad = await storage.readProposal(proposalRef);
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.error.code).toBe("schema_incompatible");
    });
  });
});

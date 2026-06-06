import { describe, expect, it } from "vitest";
import { makeMessageListId, makeRef } from "../../src/domain/index.js";
import {
  compilePlanIndexPath,
  compilePlanRecordPath,
  invalidationIndexPath,
  makeContextCompilePlanId,
  makeContextCompilePlanRef,
  makeMessageListInvalidationId,
  messageListIndexPath,
  messageListRecordPath
} from "../../src/context-message-compiler/index.js";
import { ContextStorage, parseJson } from "../../src/context-message-compiler/storage.js";
import { withWorkspace } from "../file-store/helpers.js";

describe("Context message compiler storage edges", () => {
  it("handles missing, duplicate, and invalid indexes deterministically", async () => {
    await withWorkspace(async ({ store, workspace }) => {
      const storage = new ContextStorage(store, workspace);
      const planRef = makeContextCompilePlanRef(makeContextCompilePlanId("plan-edge"));
      expect((await storage.addCompilePlan(planRef)).ok).toBe(true);
      expect((await storage.addCompilePlan(planRef)).ok).toBe(true);
      const badPlanIndex = await store.writeTextAtomic(
        workspace,
        compilePlanIndexPath,
        "{bad plan index",
        { reason: "write bad plan index", createParents: true }
      );
      expect(badPlanIndex.ok).toBe(true);
      const addBadPlan = await storage.addCompilePlan(planRef);
      expect(addBadPlan.ok).toBe(false);
      if (!addBadPlan.ok) expect(addBadPlan.error.code).toBe("schema_incompatible");

      const messageListRef = makeRef("message_list", makeMessageListId("message-list-edge"));
      expect((await storage.addMessageList(messageListRef)).ok).toBe(true);
      const badMessageIndex = await store.writeTextAtomic(
        workspace,
        messageListIndexPath,
        "{bad message index",
        { reason: "write bad message index", createParents: true }
      );
      expect(badMessageIndex.ok).toBe(true);
      expect((await storage.addMessageList(messageListRef)).ok).toBe(false);

      const invalidationId = makeMessageListInvalidationId("invalidation-edge");
      expect((await storage.addInvalidation(invalidationId)).ok).toBe(true);
      expect((await storage.addInvalidation(invalidationId)).ok).toBe(true);
      const badInvalidationIndex = await store.writeTextAtomic(
        workspace,
        invalidationIndexPath,
        "{bad invalidation index",
        { reason: "write bad invalidation index", createParents: true }
      );
      expect(badInvalidationIndex.ok).toBe(true);
      expect((await storage.addInvalidation(invalidationId)).ok).toBe(false);
    });
  });

  it("surfaces invalid and missing records without hiding file errors", async () => {
    await withWorkspace(async ({ store, workspace }) => {
      const storage = new ContextStorage(store, workspace);
      const planRef = makeContextCompilePlanRef(makeContextCompilePlanId("bad-plan-record"));
      const badPlan = await store.writeTextAtomic(
        workspace,
        compilePlanRecordPath(planRef.id),
        "{bad plan record",
        { reason: "write bad plan record", createParents: true }
      );
      expect(badPlan.ok).toBe(true);
      const plan = await storage.readCompilePlan(planRef);
      expect(plan.ok).toBe(false);
      if (!plan.ok) expect(plan.error.code).toBe("schema_incompatible");
      const messageListRef = makeRef("message_list", makeMessageListId("missing-message-record"));
      const missing = await storage.readMessageList(messageListRef);
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.error.code).toBe("not_found");
      const badMessage = await store.writeTextAtomic(
        workspace,
        messageListRecordPath(messageListRef.id),
        "{bad message record",
        { reason: "write bad message record", createParents: true }
      );
      expect(badMessage.ok).toBe(true);
      const invalid = await storage.readMessageList(messageListRef);
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) expect(invalid.error.code).toBe("schema_incompatible");
      const parsed = parseJson("{", "bad context json");
      expect(parsed.ok).toBe(false);
    });
  });
});

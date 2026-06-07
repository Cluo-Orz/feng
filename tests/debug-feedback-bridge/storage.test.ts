import { describe, expect, it } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import {
  DebugBridgeStorage,
  correlationIndexPath,
  correlationPath,
  makeDebugCorrelationId,
  makeFeedbackBridgePacketId,
  packetPath
} from "../../src/debug-feedback-bridge/index.js";
import type { DebugCorrelationRef, FeedbackBridgePacketRef } from "../../src/debug-feedback-bridge/index.js";

function packetRef(id: string): FeedbackBridgePacketRef {
  return { kind: "feedback_bridge_packet", id: makeFeedbackBridgePacketId(id) };
}

function correlationRef(id: string): DebugCorrelationRef {
  return { kind: "debug_correlation", id: makeDebugCorrelationId(id) };
}

describe("Debug Feedback Bridge storage", () => {
  it("reports schema-incompatible records and indexes", async () => {
    await withWorkspace(async (workspace) => {
      const storage = new DebugBridgeStorage(workspace.store, workspace.workspace);
      await workspace.store.writeTextAtomic(workspace.workspace, correlationPath(makeDebugCorrelationId("bad")), "{bad", {
        reason: "bad correlation json",
        createParents: true
      });
      await workspace.store.writeTextAtomic(workspace.workspace, correlationIndexPath, "{bad", {
        reason: "bad correlation index",
        createParents: true
      });
      expect((await storage.readCorrelation(correlationRef("bad"))).ok).toBe(false);
      expect((await storage.addCorrelation(correlationRef("bad"))).ok).toBe(false);
    });
  });

  it("keeps the packet index idempotent and skips missing indexed packets", async () => {
    await withWorkspace(async (workspace) => {
      const storage = new DebugBridgeStorage(workspace.store, workspace.workspace);
      const known = correlationRef("c1");
      const missing = packetRef("missing-packet");
      const first = await storage.addPacket(missing);
      expect(first.ok).toBe(true);
      const duplicate = await storage.addPacket(missing);
      expect(duplicate.ok).toBe(true);
      const skipped = await storage.readPacketsForCorrelation(known);
      expect(skipped.ok).toBe(true);
      if (!skipped.ok) throw new Error(skipped.error.message);
      expect(skipped.value).toHaveLength(0);
    });
  });

  it("propagates non-not-found errors while listing packets", async () => {
    await withWorkspace(async (workspace) => {
      const storage = new DebugBridgeStorage(workspace.store, workspace.workspace);
      const corrupt = packetRef("corrupt-packet");
      await workspace.store.writeTextAtomic(workspace.workspace, packetPath(makeFeedbackBridgePacketId("corrupt-packet")), "{bad", {
        reason: "bad packet json",
        createParents: true
      });
      const indexed = await storage.addPacket(corrupt);
      expect(indexed.ok).toBe(true);
      const listed = await storage.readPacketsForCorrelation(correlationRef("c1"));
      expect(listed.ok).toBe(false);
    });
  });
});

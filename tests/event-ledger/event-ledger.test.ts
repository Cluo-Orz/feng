import { describe, expect, test } from "vitest";
import { makeEventId } from "../../src/domain/index.js";
import { createEventLedger, makeIdempotencyKey } from "../../src/event-ledger/index.js";
import { streamPath } from "../../src/event-ledger/paths.js";
import { stableStringify } from "../../src/event-ledger/stable-json.js";
import { withWorkspace } from "../file-store/helpers.js";
import { audit, eventInput, idem, makeLedgerFixture, projectionKey, projectionName, source } from "./helpers.js";

describe("Event Ledger & Projection", () => {
  test("stable stringify preserves array order and object key stability", () => {
    expect(stableStringify([{ b: 2, a: 1 }, 3])).toBe('[{"a":1,"b":2},3]');
  });

  test("appends events with stream-local monotonic sequence and reads pages", async () => {
    await withWorkspace(async (workspace) => {
      const { ledger, stream } = makeLedgerFixture(workspace);
      const first = await ledger.appendEvent(stream, eventInput(workspace.workspace, 1));
      expect(first.ok).toBe(true);
      if (first.ok) {
        expect(first.value.appendedEvents[0]?.sequence).toBe(1);
        expect(first.value.firstSequence).toBe(1);
        expect(first.value.lastSequence).toBe(1);
        expect(first.value.appendReceipt).toBeDefined();
      }

      const second = await ledger.appendBatch(stream, [
        eventInput(workspace.workspace, 2),
        eventInput(workspace.workspace, 3)
      ]);
      expect(second.ok).toBe(true);
      if (second.ok) expect(second.value.appendedEvents.map((event) => event.sequence)).toEqual([2, 3]);

      const page = await ledger.readStream(stream, { reason: "page", fromSequence: 2, limit: 1 });
      expect(page.ok).toBe(true);
      if (page.ok) {
        expect(page.value.events.map((event) => event.sequence)).toEqual([2]);
        expect(page.value.truncated).toBe(true);
        expect(page.value.toSequence).toBe(2);
      }

      const replay = await ledger.replayStream(stream, { reason: "replay" });
      expect(replay.ok).toBe(true);
      if (replay.ok) expect(replay.value.events.length).toBe(3);
    });
  });

  test("handles idempotency and event id conflicts explicitly", async () => {
    await withWorkspace(async (workspace) => {
      const { ledger, stream } = makeLedgerFixture(workspace);
      const key = idem("same-work");
      const first = await ledger.appendEvent(stream, eventInput(workspace.workspace, 1, { idempotencyKey: key }));
      expect(first.ok).toBe(true);

      const repeated = await ledger.appendEvent(stream, eventInput(workspace.workspace, 1, { idempotencyKey: key }));
      expect(repeated.ok).toBe(true);
      if (repeated.ok) {
        expect(repeated.value.appendedEvents).toEqual([]);
        expect(repeated.value.reusedEvents[0]?.sequence).toBe(1);
      }

      const conflict = await ledger.appendEvent(stream, eventInput(workspace.workspace, 2, { idempotencyKey: key }));
      expect(conflict.ok).toBe(false);
      if (!conflict.ok) expect(conflict.error.code).toBe("idempotency_conflict");

      const eventId = makeEventId("event-fixed");
      const byId = await ledger.appendEvent(stream, eventInput(workspace.workspace, 3, { eventId }));
      expect(byId.ok).toBe(true);
      const idConflict = await ledger.appendEvent(stream, eventInput(workspace.workspace, 4, { eventId }));
      expect(idConflict.ok).toBe(false);
      if (!idConflict.ok) expect(idConflict.error.code).toBe("append_conflict");
    });
  });

  test("deduplicates repeated idempotency keys inside a batch", async () => {
    await withWorkspace(async (workspace) => {
      const { ledger, stream } = makeLedgerFixture(workspace);
      const key = makeIdempotencyKey("batch-key");
      const receipt = await ledger.appendBatch(stream, [
        eventInput(workspace.workspace, 1, { idempotencyKey: key }),
        eventInput(workspace.workspace, 1, { idempotencyKey: key })
      ]);
      expect(receipt.ok).toBe(true);
      if (receipt.ok) {
        expect(receipt.value.appendedEvents.length).toBe(1);
        expect(receipt.value.reusedEvents.length).toBe(1);
      }
    });
  });

  test("rejects invalid append inputs and unsupported versions", async () => {
    await withWorkspace(async (workspace) => {
      const { ledger, stream } = makeLedgerFixture(workspace);
      const emptyBatch = await ledger.appendBatch(stream, []);
      expect(emptyBatch.ok).toBe(false);
      if (!emptyBatch.ok) expect(emptyBatch.error.code).toBe("invalid_input");

      const badType = await ledger.appendEvent(stream, eventInput(workspace.workspace, 1, { eventType: " " }));
      expect(badType.ok).toBe(false);
      if (!badType.ok) expect(badType.error.code).toBe("invalid_input");

      const badVersion = await ledger.appendEvent(stream, eventInput(workspace.workspace, 1, { eventVersion: "99" }));
      expect(badVersion.ok).toBe(false);
      if (!badVersion.ok) expect(badVersion.error.code).toBe("version_unsupported");

      const smallLedger = createEventLedger(workspace.store, {
        workspace: workspace.workspace,
        producer: "small-ledger",
        maxInlinePayloadBytes: 8
      });
      const tooLarge = await smallLedger.appendEvent(stream, eventInput(workspace.workspace, 1, {
        payload: { text: "this payload is too large" }
      }));
      expect(tooLarge.ok).toBe(false);
      if (!tooLarge.ok) expect(tooLarge.error.code).toBe("invalid_input");
    });
  });

  test("detects read-time version and sequence incompatibility", async () => {
    await withWorkspace(async (workspace) => {
      const { ledger, stream } = makeLedgerFixture(workspace);
      const appended = await ledger.appendEvent(stream, eventInput(workspace.workspace, 1));
      expect(appended.ok).toBe(true);

      const incompatibleLedger = createEventLedger(workspace.store, {
        workspace: workspace.workspace,
        producer: "reader",
        supportedEventVersions: ["2"]
      });
      const unsupported = await incompatibleLedger.readStream(stream, { reason: "read" });
      expect(unsupported.ok).toBe(false);
      if (!unsupported.ok) expect(unsupported.error.code).toBe("version_unsupported");

      if (!appended.ok) throw new Error(appended.error.message);
      const broken = { ...appended.value.appendedEvents[0]!, sequence: 3 };
      const write = await workspace.store.writeTextAtomic(
        workspace.workspace,
        streamPath(stream),
        `${JSON.stringify(broken)}\n`,
        { reason: "corrupt-sequence", createParents: true }
      );
      expect(write.ok).toBe(true);
      const sequenceConflict = await ledger.readStream(stream, { reason: "read-broken" });
      expect(sequenceConflict.ok).toBe(false);
      if (!sequenceConflict.ok) expect(sequenceConflict.error.code).toBe("sequence_conflict");
    });
  });

  test("builds, reads, rebuilds, invalidates, and detects stale projections", async () => {
    await withWorkspace(async (workspace) => {
      const { ledger, stream } = makeLedgerFixture(workspace);
      await ledger.appendBatch(stream, [
        eventInput(workspace.workspace, 1),
        eventInput(workspace.workspace, 2),
        eventInput(workspace.workspace, 3)
      ]);

      const definition = {
        name: projectionName,
        key: projectionKey,
        projectionVersion: "1",
        selector: { streams: [stream] },
        initialState: { total: 0 },
        reduce: (state: { total: number }, event: { payload: unknown }) => {
          const payload = event.payload as { n: number };
          return { total: state.total + payload.n };
        }
      };

      const built = await ledger.buildProjection(definition);
      expect(built.ok).toBe(true);
      if (built.ok) {
        expect(built.value.state).toEqual({ total: 6 });
        expect(built.value.checkpoints[0]?.lastSequence).toBe(3);
      }

      const read = await ledger.readProjection<{ total: number }>(projectionName, projectionKey, {
        reason: "read-projection",
        expectedVersion: "1"
      });
      expect(read.ok).toBe(true);
      if (read.ok) expect(read.value.state.total).toBe(6);

      const incompatible = await ledger.readProjection(projectionName, projectionKey, {
        reason: "read-projection",
        expectedVersion: "2"
      });
      expect(incompatible.ok).toBe(false);
      if (!incompatible.ok) expect(incompatible.error.code).toBe("projection_incompatible");

      const rewrite = await workspace.store.writeTextAtomic(workspace.workspace, streamPath(stream), "", {
        reason: "make-stale",
        createParents: true
      });
      expect(rewrite.ok).toBe(true);
      const stale = await ledger.readProjection(projectionName, projectionKey, { reason: "stale" });
      expect(stale.ok).toBe(false);
      if (!stale.ok) expect(stale.error.code).toBe("projection_stale");

      const rebuilt = await ledger.rebuildProjection(definition);
      expect(rebuilt.ok).toBe(true);
      if (rebuilt.ok) expect(rebuilt.value.writeReceipt.operation).toBe("write");

      const invalidated = await ledger.invalidateProjection(projectionName, projectionKey, "invalidate");
      expect(invalidated.ok).toBe(true);
      if (invalidated.ok) expect(invalidated.value.deleted).toBe(true);
      const missing = await ledger.readProjection(projectionName, projectionKey, { reason: "missing" });
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.error.code).toBe("not_found");
    });
  });

  test("rejects malformed event and projection JSON", async () => {
    await withWorkspace(async (workspace) => {
      const { ledger, stream } = makeLedgerFixture(workspace);
      await workspace.store.writeTextAtomic(workspace.workspace, streamPath(stream), "{bad json}\n", {
        reason: "bad-json",
        createParents: true
      });
      const streamRead = await ledger.readStream(stream, { reason: "read-bad" });
      expect(streamRead.ok).toBe(false);
      if (!streamRead.ok) expect(streamRead.error.code).toBe("schema_incompatible");

      await workspace.store.writeTextAtomic(
        workspace.workspace,
        ".feng/ledger/projections/count/grow-1.json",
        "{bad projection}",
        { reason: "bad-projection", createParents: true }
      );
      const projectionRead = await ledger.readProjection(projectionName, projectionKey, { reason: "read-bad" });
      expect(projectionRead.ok).toBe(false);
      if (!projectionRead.ok) expect(projectionRead.error.code).toBe("schema_incompatible");
    });
  });

  test("preserves source and audit metadata without owning business semantics", async () => {
    await withWorkspace(async (workspace) => {
      const { ledger, stream } = makeLedgerFixture(workspace);
      const appended = await ledger.appendEvent(stream, {
        eventType: "grow.lifecycle.changed",
        eventVersion: "1",
        payload: { from: "planning", to: "growing" },
        source: source(workspace.workspace),
        audit: audit("business module emitted event"),
        correlationId: "corr-1"
      });
      expect(appended.ok).toBe(true);
      if (appended.ok) {
        const event = appended.value.appendedEvents[0]!;
        expect(event.correlationId).toBe("corr-1");
        expect(event.audit.reason).toBe("business module emitted event");
        expect(event.payload).toEqual({ from: "planning", to: "growing" });
      }
    });
  });
});

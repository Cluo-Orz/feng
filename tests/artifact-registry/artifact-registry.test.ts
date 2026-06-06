import { describe, expect, test } from "vitest";
import { makeArtifactId, makeRef } from "../../src/domain/index.js";
import { artifactRecordPath } from "../../src/artifact-registry/paths.js";
import { withWorkspace } from "../file-store/helpers.js";
import { audit, source } from "../event-ledger/helpers.js";
import { makeArtifactFixture, textArtifact, version } from "./helpers.js";

describe("Artifact Registry", () => {
  test("registers, resolves, and materializes managed text artifacts", async () => {
    await withWorkspace(async (workspace) => {
      const { registry } = makeArtifactFixture(workspace);
      const ref = await registry.registerArtifact(textArtifact(workspace));
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);

      const record = await registry.resolveArtifact(ref.value);
      expect(record.ok).toBe(true);
      if (record.ok) {
        expect(record.value.kind).toBe("source_material");
        expect(record.value.lifecycle).toBe("active");
        expect(record.value.contentHash?.algorithm).toBe("sha256");
      }

      const materialized = await registry.materializeArtifact(ref.value, { reason: "read" });
      expect(materialized.ok).toBe(true);
      if (materialized.ok) {
        expect(materialized.value.status).toBe("available");
        expect(materialized.value.content).toBe("hello artifact");
        expect(materialized.value.readReceipt).toBeDefined();
      }

      const implicitEncoding = await registry.registerArtifact({
        ...textArtifact(workspace, "implicit"),
        encoding: undefined as unknown as "utf8"
      });
      expect(implicitEncoding.ok).toBe(true);
    });
  });

  test("registers derived artifacts and previews without replacing original content", async () => {
    await withWorkspace(async (workspace) => {
      const { registry } = makeArtifactFixture(workspace);
      const sourceRef = await registry.registerArtifact(textArtifact(workspace, "abcdefghijklmnopqrstuvwxyz"));
      expect(sourceRef.ok).toBe(true);
      if (!sourceRef.ok) throw new Error(sourceRef.error.message);

      const missingParents = await registry.registerDerivedArtifact({
        ...textArtifact(workspace, "summary"),
        kind: "summary",
        parentRefs: []
      });
      expect(missingParents.ok).toBe(false);
      if (!missingParents.ok) expect(missingParents.error.code).toBe("invalid_input");

      const derived = await registry.registerDerivedArtifact({
        ...textArtifact(workspace, "summary"),
        kind: "summary",
        parentRefs: [sourceRef.value]
      });
      expect(derived.ok).toBe(true);

      const previewRef = await registry.generatePreview(sourceRef.value, "preview");
      expect(previewRef.ok).toBe(true);
      if (!previewRef.ok) throw new Error(previewRef.error.message);

      const preview = await registry.readArtifactPreview(sourceRef.value, { reason: "read-preview" });
      expect(preview.ok).toBe(true);
      if (preview.ok) {
        expect(preview.value.content).toBe("abcdefghijkl");
        expect(preview.value.artifactRef).toEqual(sourceRef.value);
        expect(preview.value.previewRef).toEqual(previewRef.value);
      }

      const original = await registry.materializeArtifact(sourceRef.value, { reason: "read-original" });
      expect(original.ok).toBe(true);
      if (original.ok) expect(original.value.content).toBe("abcdefghijklmnopqrstuvwxyz");
    });
  });

  test("enforces producer ownership for special artifact kinds", async () => {
    await withWorkspace(async (workspace) => {
      const { registry } = makeArtifactFixture(workspace);
      const blocked = await registry.registerArtifact({
        ...textArtifact(workspace, "messages"),
        kind: "compiled_message_list",
        producerModule: "human"
      });
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.error.code).toBe("invalid_state");

      const allowed = await registry.registerArtifact({
        ...textArtifact(workspace, "messages"),
        kind: "compiled_message_list",
        producerModule: "context-message-compiler"
      });
      expect(allowed.ok).toBe(true);
    });
  });

  test("registers external handles as explicit handle materializations", async () => {
    await withWorkspace(async (workspace) => {
      const { registry } = makeArtifactFixture(workspace);
      const blank = await registry.registerExternalHandle({
        kind: "source_material",
        handle: " ",
        mediaType: "text/plain",
        source: source(workspace.workspace),
        version,
        audit: audit("external"),
        privacyClass: "workspace_private",
        retentionClass: "archive",
        producerModule: "importer"
      });
      expect(blank.ok).toBe(false);
      if (!blank.ok) expect(blank.error.code).toBe("invalid_input");

      const ref = await registry.registerExternalHandle({
        kind: "source_material",
        handle: "s3://bucket/key",
        mediaType: "text/plain",
        source: source(workspace.workspace),
        version,
        audit: audit("external"),
        privacyClass: "workspace_private",
        retentionClass: "archive",
        producerModule: "importer",
        trusted: true,
        size: 12,
        contentHash: { algorithm: "sha256", value: "external-hash" },
        parentRefs: [],
        correlationId: "corr-external"
      });
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);

      const record = await registry.resolveArtifact(ref.value);
      expect(record.ok).toBe(true);
      if (record.ok) {
        expect(record.value.size).toBe(12);
        expect(record.value.contentHash?.value).toBe("external-hash");
        expect(record.value.correlationId).toBe("corr-external");
      }

      const materialized = await registry.materializeArtifact(ref.value, { reason: "read-external" });
      expect(materialized.ok).toBe(true);
      if (materialized.ok) {
        expect(materialized.value.status).toBe("available");
        expect(materialized.value.contentHandle).toBe("s3://bucket/key");
        expect(materialized.value.content).toBeUndefined();
      }

      const deleted = await registry.deleteArtifactContent(ref.value, "delete-external");
      expect(deleted.ok).toBe(true);
      if (deleted.ok) expect(deleted.value.contentDeleteReceipt).toBeUndefined();

      const minimal = await registry.registerExternalHandle({
        kind: "source_material",
        handle: "https://example.test/doc",
        mediaType: "text/plain",
        source: source(workspace.workspace),
        version,
        audit: audit("external-minimal"),
        privacyClass: "workspace_private",
        retentionClass: "archive",
        producerModule: "importer"
      });
      expect(minimal.ok).toBe(true);
      if (!minimal.ok) throw new Error(minimal.error.message);
      const minimalRecord = await registry.resolveArtifact(minimal.value);
      expect(minimalRecord.ok).toBe(true);
      if (minimalRecord.ok) {
        expect(minimalRecord.value.contentHash).toBeUndefined();
        expect(minimalRecord.value.size).toBeUndefined();
        expect(minimalRecord.value.parentRefs).toEqual([]);
      }
      const preview = await registry.generatePreview(minimal.value, "preview-external");
      expect(preview.ok).toBe(true);
    });
  });

  test("applies lifecycle states without deleting audit records", async () => {
    await withWorkspace(async (workspace) => {
      const { registry } = makeArtifactFixture(workspace);
      const ref = await registry.registerArtifact(textArtifact(workspace));
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);
      const existingPreview = await registry.generatePreview(ref.value, "preview-before-redact");
      expect(existingPreview.ok).toBe(true);

      const archived = await registry.archiveArtifact(ref.value, "archive");
      expect(archived.ok).toBe(true);
      const archivedPreview = await registry.readArtifactPreview(ref.value, { reason: "read-preview-archived" });
      expect(archivedPreview.ok).toBe(false);
      if (!archivedPreview.ok) expect(archivedPreview.error.code).toBe("invalid_state");
      const blocked = await registry.materializeArtifact(ref.value, { reason: "read-archived" });
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.error.code).toBe("invalid_state");

      const archivedRead = await registry.materializeArtifact(ref.value, {
        reason: "read-archived",
        allowArchived: true
      });
      expect(archivedRead.ok).toBe(true);

      const redacted = await registry.redactArtifact(ref.value, "redact");
      expect(redacted.ok).toBe(true);
      const blockedPreview = await registry.generatePreview(ref.value, "preview-redacted");
      expect(blockedPreview.ok).toBe(false);
      if (!blockedPreview.ok) expect(blockedPreview.error.code).toBe("privacy_blocked");
      const readBlockedPreview = await registry.readArtifactPreview(ref.value, {
        reason: "read-preview-redacted",
        allowArchived: true
      });
      expect(readBlockedPreview.ok).toBe(false);
      if (!readBlockedPreview.ok) expect(readBlockedPreview.error.code).toBe("privacy_blocked");
      const redactedRead = await registry.materializeArtifact(ref.value, { reason: "redacted", allowArchived: true });
      expect(redactedRead.ok).toBe(true);
      if (redactedRead.ok) {
        expect(redactedRead.value.status).toBe("redacted");
        expect(redactedRead.value.redacted).toBe(true);
        expect(redactedRead.value.content).toBeUndefined();
      }

      const conflict = await registry.redactArtifact(ref.value, "redact-again");
      expect(conflict.ok).toBe(false);
      if (!conflict.ok) expect(conflict.error.code).toBe("lifecycle_conflict");

      const deleted = await registry.deleteArtifactContent(ref.value, "delete");
      expect(deleted.ok).toBe(true);
      const record = await registry.resolveArtifact(ref.value);
      expect(record.ok).toBe(true);
      if (record.ok) expect(record.value.lifecycle).toBe("deleted");
    });
  });

  test("marks unavailable and retracted artifacts as explicit materialization statuses", async () => {
    await withWorkspace(async (workspace) => {
      const { registry } = makeArtifactFixture(workspace);
      const unavailableRef = await registry.registerArtifact(textArtifact(workspace, "temporary"));
      expect(unavailableRef.ok).toBe(true);
      if (!unavailableRef.ok) throw new Error(unavailableRef.error.message);

      const unavailable = await registry.markUnavailable(unavailableRef.value, "unavailable");
      expect(unavailable.ok).toBe(true);
      const unavailableRead = await registry.materializeArtifact(unavailableRef.value, { reason: "read" });
      expect(unavailableRead.ok).toBe(true);
      if (unavailableRead.ok) expect(unavailableRead.value.status).toBe("unavailable");

      const retractedRef = await registry.registerArtifact(textArtifact(workspace, "bad candidate"));
      expect(retractedRef.ok).toBe(true);
      if (!retractedRef.ok) throw new Error(retractedRef.error.message);
      const retracted = await registry.retractArtifact(retractedRef.value, "retract");
      expect(retracted.ok).toBe(true);
      const retractedRead = await registry.materializeArtifact(retractedRef.value, { reason: "read" });
      expect(retractedRead.ok).toBe(true);
      if (retractedRead.ok) expect(retractedRead.value.status).toBe("retracted");
    });
  });

  test("supports range reads and detects content hash mismatch", async () => {
    await withWorkspace(async (workspace) => {
      const { registry } = makeArtifactFixture(workspace);
      const ref = await registry.registerArtifact(textArtifact(workspace, "a\nb\nc\n"));
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);

      const range = await registry.readArtifactRange(ref.value, { offset: 2, limit: 1 }, { reason: "range" });
      expect(range.ok).toBe(true);
      if (range.ok) {
        expect(range.value.content).toBe("b");
        expect(range.value.range).toEqual({ offset: 2, limit: 1 });
      }

      const tooLarge = await registry.materializeArtifact(ref.value, { reason: "too-large", maxBytes: 1 });
      expect(tooLarge.ok).toBe(false);
      if (!tooLarge.ok) expect(tooLarge.error.code).toBe("file_too_large");

      const record = await registry.resolveArtifact(ref.value);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);
      if (record.value.contentLocation.kind !== "managed") throw new Error("expected managed content");
      await workspace.store.writeTextAtomic(workspace.workspace, record.value.contentLocation.logicalPath, "corrupt", {
        reason: "corrupt"
      });

      const materialized = await registry.materializeArtifact(ref.value, { reason: "hash-check" });
      expect(materialized.ok).toBe(false);
      if (!materialized.ok) expect(materialized.error.code).toBe("content_hash_mismatch");
    });
  });

  test("handles binary artifacts without pretending they are text", async () => {
    await withWorkspace(async (workspace) => {
      const { registry } = makeArtifactFixture(workspace);
      const ref = await registry.registerArtifact({
        kind: "tool_result",
        content: Uint8Array.from([1, 2, 3]),
        mediaType: "application/octet-stream",
        source: source(workspace.workspace),
        version,
        audit: audit("binary"),
        privacyClass: "workspace_private",
        retentionClass: "attempt_scoped",
        producerModule: "tool-runtime"
      });
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);

      const materialized = await registry.materializeArtifact(ref.value, { reason: "binary" });
      expect(materialized.ok).toBe(true);
      if (materialized.ok) expect([...materialized.value.content as Uint8Array]).toEqual([1, 2, 3]);

      const range = await registry.readArtifactRange(ref.value, { offset: 1, limit: 1 }, { reason: "range" });
      expect(range.ok).toBe(false);
      if (!range.ok) expect(range.error.code).toBe("unsupported_encoding");

      const preview = await registry.generatePreview(ref.value, "binary-preview");
      expect(preview.ok).toBe(true);
      if (preview.ok) {
        const read = await registry.readArtifactPreview(ref.value, { reason: "read-preview" });
        expect(read.ok).toBe(true);
        if (read.ok) expect(read.value.content.startsWith("<binary")).toBe(true);
      }
    });
  });

  test("does not materialize missing artifacts or missing previews silently", async () => {
    await withWorkspace(async (workspace) => {
      const { registry } = makeArtifactFixture(workspace);
      const missingRef = makeRef("artifact", makeArtifactId("artifact-missing"));
      const missing = await registry.resolveArtifact(missingRef);
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.error.code).toBe("not_found");

      const ref = await registry.registerArtifact(textArtifact(workspace));
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);

      const preview = await registry.readArtifactPreview(ref.value, { reason: "preview" });
      expect(preview.ok).toBe(false);
      if (!preview.ok) expect(preview.error.code).toBe("not_found");

      await workspace.store.writeTextAtomic(workspace.workspace, artifactRecordPath(ref.value.id), "{bad json}", {
        reason: "corrupt-record"
      });
      const corrupt = await registry.resolveArtifact(ref.value);
      expect(corrupt.ok).toBe(false);
      if (!corrupt.ok) expect(corrupt.error.code).toBe("schema_incompatible");

      const otherId = makeArtifactId("artifact-other");
      await workspace.store.writeTextAtomic(
        workspace.workspace,
        artifactRecordPath(ref.value.id),
        JSON.stringify({ artifactId: otherId }),
        { reason: "wrong-id" }
      );
      const mismatch = await registry.resolveArtifact(ref.value);
      expect(mismatch.ok).toBe(false);
      if (!mismatch.ok) expect(mismatch.error.code).toBe("schema_incompatible");
    });
  });
});

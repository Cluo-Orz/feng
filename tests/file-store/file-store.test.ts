import path from "node:path";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { withWorkspace } from "./helpers.js";

describe("File-Native Store operations", () => {
  test("writes and reads text atomically with receipts and content hashes", async () => {
    await withWorkspace(async ({ store, workspace, root }) => {
      const written = await store.writeTextAtomic(workspace, "notes/a.md", "hello", {
        reason: "unit-write",
        correlationId: "corr-1",
        createParents: true
      });
      expect(written.ok).toBe(true);
      if (written.ok) {
        expect(written.value.operation).toBe("write");
        expect(written.value.bytesWritten).toBe(5);
        expect(written.value.contentHashAfter.algorithm).toBe("sha256");
        expect(written.value.correlationId).toBe("corr-1");
      }
      expect(await readFile(path.join(root, "notes", "a.md"), "utf8")).toBe("hello");

      const read = await store.readText(workspace, "notes/a.md", { reason: "unit-read" });
      expect(read.ok).toBe(true);
      if (read.ok) {
        expect(read.value.content).toBe("hello");
        expect(read.value.receipt.bytesRead).toBe(5);
        expect(read.value.stat.contentHashAvailable).toBe(true);
      }

      const stat = await store.stat(workspace, "notes/a.md");
      expect(stat.ok).toBe(true);
      if (stat.ok) {
        expect(stat.value.kind).toBe("file");
        expect(stat.value.contentHashAvailable).toBe(true);
      }

      const overwritten = await store.writeTextAtomic(workspace, "notes/a.md", "hello again", {
        reason: "overwrite"
      });
      expect(overwritten.ok).toBe(true);
      if (overwritten.ok) expect(overwritten.value.contentHashBefore).toBeDefined();

      const missingStat = await store.stat(workspace, "missing.txt");
      expect(missingStat.ok).toBe(false);
      if (!missingStat.ok) expect(missingStat.error.code).toBe("not_found");

      const [firstConcurrent, secondConcurrent] = await Promise.all([
        store.writeTextAtomic(workspace, "notes/concurrent.md", "first", { reason: "concurrent", createParents: true }),
        store.writeTextAtomic(workspace, "notes/concurrent.md", "second", { reason: "concurrent", createParents: true })
      ]);
      expect(firstConcurrent.ok).toBe(true);
      expect(secondConcurrent.ok).toBe(true);
    });
  });

  test("does not create parents implicitly and rejects directories as file targets", async () => {
    await withWorkspace(async ({ store, workspace }) => {
      const missingParent = await store.writeTextAtomic(workspace, "missing/child.txt", "x", { reason: "write" });
      expect(missingParent.ok).toBe(false);
      if (!missingParent.ok) expect(missingParent.error.code).toBe("not_found");

      const directory = await store.ensureDirectory(workspace, "folder", { reason: "dir" });
      expect(directory.ok).toBe(true);

      const existingFile = await store.writeTextAtomic(workspace, "file.txt", "x", { reason: "file" });
      expect(existingFile.ok).toBe(true);
      const directoryOverFile = await store.ensureDirectory(workspace, "file.txt", { reason: "dir-over-file" });
      expect(directoryOverFile.ok).toBe(false);
      if (!directoryOverFile.ok) expect(directoryOverFile.error.code).toBe("io_failed");

      const overwriteDirectory = await store.writeTextAtomic(workspace, "folder", "x", { reason: "bad-write" });
      expect(overwriteDirectory.ok).toBe(false);
      if (!overwriteDirectory.ok) expect(overwriteDirectory.error.code).toBe("invalid_input");

      const removeDirectory = await store.removeFile(workspace, "folder", { reason: "bad-remove" });
      expect(removeDirectory.ok).toBe(false);
      if (!removeDirectory.ok) expect(removeDirectory.error.code).toBe("invalid_input");
    });
  });

  test("reads binary files and rejects unsupported text read options", async () => {
    await withWorkspace(async ({ store, workspace }) => {
      const bytes = Uint8Array.from([1, 2, 3]);
      const written = await store.writeBinaryAtomic(workspace, "bytes.dat", bytes, { reason: "write-bytes" });
      expect(written.ok).toBe(true);

      const binary = await store.readBinary(workspace, "bytes.dat", { reason: "read-bytes" });
      expect(binary.ok).toBe(true);
      if (binary.ok) expect([...binary.value.content]).toEqual([1, 2, 3]);

      const badEncoding = await store.readText(workspace, "bytes.dat", {
        reason: "bad-encoding",
        encoding: "utf16" as "utf8"
      });
      expect(badEncoding.ok).toBe(false);
      if (!badEncoding.ok) expect(badEncoding.error.code).toBe("unsupported_encoding");
    });
  });

  test("appends records with one record boundary per append", async () => {
    await withWorkspace(async ({ store, workspace, root }) => {
      const first = await store.appendRecordAtomic(workspace, "ledger/events.ndjson", "{\"n\":1}", {
        reason: "append",
        createParents: true
      });
      const second = await store.appendRecordAtomic(workspace, "ledger/events.ndjson", "{\"n\":2}", {
        reason: "append"
      });
      const third = await store.appendRecordAtomic(
        workspace,
        "ledger/events.ndjson",
        Uint8Array.from(Buffer.from("{\"n\":3}")),
        {
          reason: "append-binary",
          recordSeparator: "\r\n"
        }
      );
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(third.ok).toBe(true);
      if (second.ok) {
        expect(second.value.operation).toBe("append");
        expect(second.value.bytesAppended).toBe(Buffer.byteLength("{\"n\":2}\n"));
        expect(second.value.contentHashBefore).toBeDefined();
      }
      expect(await readFile(path.join(root, "ledger", "events.ndjson"), "utf8")).toBe(
        "{\"n\":1}\n{\"n\":2}\n{\"n\":3}\r\n"
      );
    });
  });

  test("supports guarded full reads and line range reads", async () => {
    await withWorkspace(async ({ store, workspace, root }) => {
      await writeFile(path.join(root, "big.txt"), "a\nb\nc\nd\ne\n");
      const tooLarge = await store.readText(workspace, "big.txt", { reason: "guard", maxBytes: 4 });
      expect(tooLarge.ok).toBe(false);
      if (!tooLarge.ok) expect(tooLarge.error.code).toBe("file_too_large");

      const range = await store.readTextRange(workspace, "big.txt", { offset: 2, limit: 3 }, {
        reason: "range",
        maxBytes: 12
      });
      expect(range.ok).toBe(true);
      if (range.ok) {
        expect(range.value.content).toBe("b\nc\nd");
        expect(range.value.range).toEqual({ offset: 2, limit: 3 });
        expect(range.value.receipt.bytesRead).toBe(5);
      }

      const invalidRange = await store.readTextRange(workspace, "big.txt", { offset: 0, limit: 1 }, {
        reason: "bad-range"
      });
      expect(invalidRange.ok).toBe(false);
      if (!invalidRange.ok) expect(invalidRange.error.code).toBe("invalid_input");

      const rangeTooLarge = await store.readTextRange(workspace, "big.txt", { offset: 5, limit: 1 }, {
        reason: "range-too-large",
        maxBytes: 2
      });
      expect(rangeTooLarge.ok).toBe(false);
      if (!rangeTooLarge.ok) expect(rangeTooLarge.error.code).toBe("file_too_large");

      const rangeBadEncoding = await store.readTextRange(workspace, "big.txt", { offset: 1, limit: 1 }, {
        reason: "bad-encoding",
        encoding: "utf16" as "utf8"
      });
      expect(rangeBadEncoding.ok).toBe(false);
      if (!rangeBadEncoding.ok) expect(rangeBadEncoding.error.code).toBe("unsupported_encoding");

      const directoryRange = await store.readTextRange(workspace, ".", { offset: 1, limit: 1 }, {
        reason: "dir-range"
      });
      expect(directoryRange.ok).toBe(false);
      if (!directoryRange.ok) expect(directoryRange.error.code).toBe("invalid_input");
    });
  });

  test("rejects invalid utf8 when reading text", async () => {
    await withWorkspace(async ({ store, workspace }) => {
      const written = await store.writeBinaryAtomic(workspace, "bytes.bin", Uint8Array.from([0xff, 0xfe]), {
        reason: "write-bytes"
      });
      expect(written.ok).toBe(true);
      const text = await store.readText(workspace, "bytes.bin", { reason: "decode" });
      expect(text.ok).toBe(false);
      if (!text.ok) expect(text.error.code).toBe("unsupported_encoding");

      const range = await store.readTextRange(workspace, "bytes.bin", { offset: 1, limit: 1 }, {
        reason: "decode-range"
      });
      expect(range.ok).toBe(false);
      if (!range.ok) expect(range.error.code).toBe("unsupported_encoding");
    });
  });

  test("lists directories with explicit recursive bounds", async () => {
    await withWorkspace(async ({ store, workspace, root }) => {
      await mkdir(path.join(root, "a", "b"), { recursive: true });
      await writeFile(path.join(root, "a", "one.txt"), "1");
      await writeFile(path.join(root, "a", "b", "two.txt"), "2");

      const shallow = await store.listDirectory(workspace, "a", { reason: "list" });
      expect(shallow.ok).toBe(true);
      if (shallow.ok) {
        expect(shallow.value.entries.map((entry) => entry.logicalPath)).toEqual(["a/b", "a/one.txt"]);
        expect(shallow.value.truncated).toBe(false);
      }

      const notDirectory = await store.listDirectory(workspace, "a/one.txt", { reason: "not-dir" });
      expect(notDirectory.ok).toBe(false);
      if (!notDirectory.ok) expect(notDirectory.error.code).toBe("invalid_input");

      const badLimit = await store.listDirectory(workspace, "a", { reason: "bad-limit", maxEntries: 0 });
      expect(badLimit.ok).toBe(false);
      if (!badLimit.ok) expect(badLimit.error.code).toBe("invalid_input");

      const unbounded = await store.listDirectory(workspace, "a", { reason: "bad-recursive", recursive: true });
      expect(unbounded.ok).toBe(false);
      if (!unbounded.ok) expect(unbounded.error.code).toBe("invalid_input");

      const bounded = await store.listDirectory(workspace, "a", {
        reason: "recursive",
        recursive: true,
        maxDepth: 2,
        maxEntries: 2
      });
      expect(bounded.ok).toBe(true);
      if (bounded.ok) {
        expect(bounded.value.entries.length).toBe(2);
        expect(bounded.value.truncated).toBe(true);
        expect(bounded.value.receipt.entriesRead).toBe(2);
      }

      const withHashes = await store.listDirectory(workspace, "a", {
        reason: "hash-list",
        includeContentHash: true
      });
      expect(withHashes.ok).toBe(true);
      if (withHashes.ok) {
        const file = withHashes.value.entries.find((entry) => entry.logicalPath === "a/one.txt");
        expect(file?.contentHashAvailable).toBe(true);
      }
    });
  });

  test("lists symlinks as symlink entries without following them", async () => {
    await withWorkspace(async ({ store, workspace, root }) => {
      await writeFile(path.join(root, "inside.txt"), "inside");
      try {
        await symlink(path.join(root, "inside.txt"), path.join(root, "inside-link.txt"), "file");
      } catch {
        return;
      }

      const listing = await store.listDirectory(workspace, ".", { reason: "list-symlink" });
      expect(listing.ok).toBe(true);
      if (listing.ok) {
        const link = listing.value.entries.find((entry) => entry.logicalPath === "inside-link.txt");
        expect(link?.kind).toBe("symlink");
        expect(link?.contentHashAvailable).toBe(false);
      }
    });
  });

  test("moves and removes paths only within the workspace", async () => {
    await withWorkspace(async ({ store, workspace, root }) => {
      const write = await store.writeTextAtomic(workspace, "draft.txt", "draft", { reason: "write" });
      expect(write.ok).toBe(true);
      const moved = await store.moveWithinWorkspace(workspace, "draft.txt", "done/final.txt", {
        reason: "move",
        createParents: true
      });
      expect(moved.ok).toBe(true);
      if (moved.ok) {
        expect(moved.value.fromLogicalPath).toBe("draft.txt");
        expect(moved.value.toLogicalPath).toBe("done/final.txt");
      }
      expect(await readFile(path.join(root, "done", "final.txt"), "utf8")).toBe("draft");

      const blockedMove = await store.moveWithinWorkspace(workspace, "done/final.txt", "done/existing.txt", {
        reason: "move",
        createParents: true
      });
      expect(blockedMove.ok).toBe(true);
      if (!blockedMove.ok) throw new Error(blockedMove.error.message);
      await writeFile(path.join(root, "done", "source.txt"), "source");
      const targetExists = await store.moveWithinWorkspace(workspace, "done/source.txt", "done/existing.txt", {
        reason: "target-exists"
      });
      expect(targetExists.ok).toBe(false);
      if (!targetExists.ok) expect(targetExists.error.code).toBe("invalid_input");

      const removed = await store.removeFile(workspace, "done/existing.txt", { reason: "remove" });
      expect(removed.ok).toBe(true);
      if (removed.ok) expect(removed.value.bytesDeleted).toBe(5);

      const missing = await store.readBinary(workspace, "done/existing.txt", { reason: "missing" });
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.error.code).toBe("not_found");
    });
  });

  test("cleans only recognized file-store temp files", async () => {
    await withWorkspace(async ({ store, workspace, root }) => {
      await mkdir(path.join(root, "nested"), { recursive: true });
      await writeFile(path.join(root, ".feng-tmp-root"), "temp");
      await writeFile(path.join(root, "nested", ".feng-tmp-child"), "temp");
      await writeFile(path.join(root, "nested", "keep.txt"), "keep");

      const cleaned = await store.cleanupTemps(workspace, { reason: "cleanup", maxDepth: 2, maxEntries: 10 });
      expect(cleaned.ok).toBe(true);
      if (cleaned.ok) {
        expect([...cleaned.value.removed].sort()).toEqual([".feng-tmp-root", "nested/.feng-tmp-child"]);
        expect(cleaned.value.failed).toEqual([]);
      }
      expect(await readFile(path.join(root, "nested", "keep.txt"), "utf8")).toBe("keep");

      await writeFile(path.join(root, ".feng-tmp-late"), "temp");
      const shallow = await store.cleanupTemps(workspace, { reason: "cleanup", maxDepth: 0, maxEntries: 10 });
      expect(shallow.ok).toBe(true);
      if (shallow.ok) expect(shallow.value.removed).toEqual([]);
    });
  });
});

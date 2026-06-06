import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { createNodeFileNativeStore } from "../../src/file-store/index.js";
import { withWorkspace } from "./helpers.js";

describe("File-Native Store workspace and path safety", () => {
  test("rejects invalid workspace roots", async () => {
    const store = createNodeFileNativeStore();
    const blank = await store.openWorkspace({ root: "   " });
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.error.code).toBe("invalid_input");

    const missing = await store.openWorkspace({ root: path.join(tmpdir(), "feng-missing-workspace") });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe("not_found");

    const root = await mkdtemp(path.join(tmpdir(), "feng-file-store-root-file-"));
    try {
      const filePath = path.join(root, "file.txt");
      await writeFile(filePath, "not a directory");
      const fileRoot = await store.openWorkspace({ root: filePath });
      expect(fileRoot.ok).toBe(false);
      if (!fileRoot.ok) expect(fileRoot.error.code).toBe("invalid_input");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("opens workspaces, describes them, and resolves normalized contained paths", async () => {
    await withWorkspace(async ({ store, workspace }) => {
      const described = await store.describeWorkspace(workspace);
      expect(described.ok).toBe(true);
      if (described.ok) {
        expect(described.value.id).toBe(workspace.id);
        expect(described.value.kind).toBe("directory");
      }

      const resolved = await store.resolvePath(workspace, "notes\\idea.md", { allowMissing: true });
      expect(resolved.ok).toBe(true);
      if (resolved.ok) expect(resolved.value.logicalPath).toBe("notes/idea.md");

      const traversal = await store.resolvePath(workspace, "../outside.md", { allowMissing: true });
      expect(traversal.ok).toBe(false);
      if (!traversal.ok) expect(traversal.error.code).toBe("path_escape_rejected");

      const absolute = await store.resolvePath(workspace, path.join(workspace.root, "x.md"), { allowMissing: true });
      expect(absolute.ok).toBe(false);
      if (!absolute.ok) expect(absolute.error.message).toContain("absolute");

      const allowedAbsolute = await store.resolvePath(workspace, path.join(workspace.root, "x.md"), {
        allowAbsolute: true,
        allowMissing: true
      });
      expect(allowedAbsolute.ok).toBe(true);
      if (allowedAbsolute.ok) expect(allowedAbsolute.value.logicalPath).toBe("x.md");

      const escapingAbsolute = await store.resolvePath(workspace, path.join(tmpdir(), "outside.md"), {
        allowAbsolute: true,
        allowMissing: true
      });
      expect(escapingAbsolute.ok).toBe(false);
      if (!escapingAbsolute.ok) expect(escapingAbsolute.error.code).toBe("path_escape_rejected");

      const rootPath = await store.resolvePath(workspace, ".");
      expect(rootPath.ok).toBe(true);
      if (rootPath.ok) expect(rootPath.value.logicalPath).toBe(".");

      const uncheckedMissing = await store.resolvePath(workspace, "unchecked.txt", {
        allowMissing: true,
        rejectSymlinkEscape: false
      });
      expect(uncheckedMissing.ok).toBe(true);

      const blank = await store.resolvePath(workspace, "  ");
      expect(blank.ok).toBe(false);
      if (!blank.ok) expect(blank.error.code).toBe("invalid_input");

      const nullByte = await store.resolvePath(workspace, "bad\0path");
      expect(nullByte.ok).toBe(false);
      if (!nullByte.ok) expect(nullByte.error.code).toBe("invalid_input");
    });
  });

  test("reports when an opened workspace disappears", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "feng-file-store-disappears-"));
    const store = createNodeFileNativeStore();
    const opened = await store.openWorkspace({ root });
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error(opened.error.message);
    await rm(root, { recursive: true, force: true });
    const described = await store.describeWorkspace(opened.value);
    expect(described.ok).toBe(false);
    if (!described.ok) expect(described.error.code).toBe("not_found");
  });

  test("rejects handles whose root no longer points at a directory", async () => {
    await withWorkspace(async ({ store, workspace, root }) => {
      const filePath = path.join(root, "not-dir.txt");
      await writeFile(filePath, "x");
      const described = await store.describeWorkspace({ ...workspace, root: filePath as typeof workspace.root });
      expect(described.ok).toBe(false);
      if (!described.ok) expect(described.error.code).toBe("invalid_input");
    });
  });

  test("rejects symlink escapes when the platform allows the test symlink", async () => {
    await withWorkspace(async ({ store, workspace, root }) => {
      const externalRoot = await mkdtemp(path.join(tmpdir(), "feng-file-store-external-"));
      try {
        const externalFile = path.join(externalRoot, "secret.txt");
        await writeFile(externalFile, "secret");
        const linkPath = path.join(root, "secret-link.txt");
        try {
          await symlink(externalFile, linkPath, "file");
        } catch {
          return;
        }

        const resolved = await store.resolvePath(workspace, "secret-link.txt");
        expect(resolved.ok).toBe(false);
        if (!resolved.ok) expect(resolved.error.code).toBe("symlink_escape_rejected");

        const unchecked = await store.resolvePath(workspace, "secret-link.txt", { rejectSymlinkEscape: false });
        expect(unchecked.ok).toBe(true);
      } finally {
        await rm(externalRoot, { recursive: true, force: true });
      }
    });
  });
});

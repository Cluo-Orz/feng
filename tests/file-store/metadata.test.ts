import path from "node:path";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { directoryEntry, fileStat, receipt } from "../../src/file-store/metadata.js";
import type {
  ResolvedWorkspacePath,
  WorkspaceAbsolutePath,
  WorkspaceHandle,
  WorkspaceRelativePath
} from "../../src/file-store/index.js";
import { withWorkspace } from "./helpers.js";

describe("file-store metadata helpers", () => {
  it("stats files and directories with optional content hashes", async () => {
    await withWorkspace(async ({ root, workspace }) => {
      const filePath = path.join(root, "note.txt");
      await writeFile(filePath, "hello", "utf8");
      const file = await fileStat(workspace, resolved(workspace, filePath, "note.txt", true), true);
      expect(file.ok).toBe(true);
      if (!file.ok) throw new Error(file.error.message);
      expect(file.value.kind).toBe("file");
      expect(file.value.contentHashAvailable).toBe(true);
      expect(file.value.contentHash?.algorithm).toBe("sha256");
      const noHash = await fileStat(workspace, resolved(workspace, filePath, "note.txt", true), false);
      expect(noHash.ok).toBe(true);
      if (!noHash.ok) throw new Error(noHash.error.message);
      expect(noHash.value.contentHashAvailable).toBe(false);
      const dir = await fileStat(workspace, resolved(workspace, root, ".", true), true);
      expect(dir.ok).toBe(true);
      if (!dir.ok) throw new Error(dir.error.message);
      expect(dir.value.kind).toBe("directory");
      expect(dir.value.contentHashAvailable).toBe(false);
    });
  });

  it("reads directory entries for files, directories, symlinks, and missing children", async () => {
    await withWorkspace(async ({ root, workspace }) => {
      await mkdir(path.join(root, "folder"));
      await writeFile(path.join(root, "folder", "child.txt"), "child", "utf8");
      const child = await directoryEntry(workspace, "folder" as WorkspaceRelativePath, path.join(root, "folder"), "child.txt", true);
      expect(child.ok).toBe(true);
      if (!child.ok) throw new Error(child.error.message);
      expect(child.value.logicalPath).toBe("folder/child.txt");
      expect(child.value.contentHashAvailable).toBe(true);
      const folder = await directoryEntry(workspace, "." as WorkspaceRelativePath, root, "folder", true);
      expect(folder.ok).toBe(true);
      if (!folder.ok) throw new Error(folder.error.message);
      expect(folder.value.kind).toBe("directory");
      const linkPath = path.join(root, "child-link.txt");
      try {
        await symlink(path.join(root, "folder", "child.txt"), linkPath);
        const link = await directoryEntry(workspace, "." as WorkspaceRelativePath, root, "child-link.txt", true);
        expect(link.ok).toBe(true);
        if (link.ok) {
          expect(link.value.kind).toBe("symlink");
          expect("size" in link.value).toBe(false);
        }
      } catch {
        // Windows without developer-mode symlink privileges still covers the other branches.
      }
      const missing = await directoryEntry(workspace, "." as WorkspaceRelativePath, root, "missing.txt", false);
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.error.code).toBe("not_found");
    });
  });

  it("records receipt correlation only when supplied and reports missing stat paths", async () => {
    await withWorkspace(async ({ root, workspace }) => {
      const missing = await fileStat(workspace, resolved(workspace, path.join(root, "missing.txt"), "missing.txt", false), false);
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.error.code).toBe("not_found");
      expect(receipt(workspace, "a.txt" as WorkspaceRelativePath, "read", { reason: "read" }).correlationId).toBeUndefined();
      expect(receipt(workspace, "a.txt" as WorkspaceRelativePath, "write", {
        reason: "write",
        correlationId: "corr-1"
      }).correlationId).toBe("corr-1");
    });
  });
});

function resolved(
  workspace: WorkspaceHandle,
  absolutePath: string,
  logicalPath: string,
  exists: boolean
): ResolvedWorkspacePath {
  return {
    workspaceId: workspace.id,
    absolutePath: absolutePath as WorkspaceAbsolutePath,
    logicalPath: logicalPath as WorkspaceRelativePath,
    exists
  };
}

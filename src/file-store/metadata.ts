import path from "node:path";
import { readFile, stat as nodeStat, lstat as nodeLstat } from "node:fs/promises";
import { ok, type Result } from "../domain/result.js";
import { fileStoreErr, ioErr, isNodeNotFound } from "./errors.js";
import { sha256Content } from "./hash.js";
import type {
  BaseReceipt,
  ContentHash,
  DirectoryEntry,
  FileKind,
  FileStat,
  ReceiptInput,
  ResolvedWorkspacePath,
  WorkspaceHandle,
  WorkspaceRelativePath
} from "./types.js";

export async function fileStat(
  workspace: WorkspaceHandle,
  resolved: ResolvedWorkspacePath,
  includeContentHash: boolean
): Promise<Result<FileStat>> {
  try {
    const info = await nodeStat(resolved.absolutePath);
    const kind = toFileKind(info);
    const contentHash = includeContentHash && kind === "file" ? await hashFile(resolved.absolutePath) : undefined;
    return ok({
      workspaceId: workspace.id,
      logicalPath: resolved.logicalPath,
      kind,
      size: info.size,
      mtime: info.mtime.toISOString(),
      contentHashAvailable: contentHash !== undefined,
      ...(contentHash === undefined ? {} : { contentHash })
    });
  } catch (error) {
    if (isNodeNotFound(error)) {
      return fileStoreErr({ code: "not_found", message: `path does not exist: ${resolved.logicalPath}` });
    }
    return ioErr("failed to stat path", error);
  }
}

export async function directoryEntry(
  workspace: WorkspaceHandle,
  parentLogicalPath: WorkspaceRelativePath,
  parentAbsolutePath: string,
  name: string,
  includeContentHash: boolean
): Promise<Result<DirectoryEntry>> {
  const absolute = path.join(parentAbsolutePath, name);
  const logicalPath = childPath(parentLogicalPath, name);
  try {
    const info = await nodeLstat(absolute);
    const kind = toFileKind(info);
    const contentHash = includeContentHash && kind === "file" ? await hashFile(absolute) : undefined;
    return ok({
      name,
      logicalPath,
      kind,
      contentHashAvailable: contentHash !== undefined,
      ...(kind === "symlink" ? {} : { size: info.size, mtime: info.mtime.toISOString() }),
      ...(contentHash === undefined ? {} : { contentHash })
    });
  } catch (error) {
    if (isNodeNotFound(error)) {
      return fileStoreErr({ code: "not_found", message: `directory entry disappeared: ${name}` });
    }
    return ioErr("failed to read directory entry metadata", error);
  }
}

export async function hashFile(absolutePath: string): Promise<ContentHash> {
  return sha256Content(await readFile(absolutePath));
}

export function receipt<T extends BaseReceipt["operation"]>(
  workspace: WorkspaceHandle,
  logicalPath: WorkspaceRelativePath,
  operation: T,
  input: ReceiptInput
): BaseReceipt & { readonly operation: T } {
  return {
    workspaceId: workspace.id,
    logicalPath,
    operation,
    timestamp: new Date().toISOString(),
    reason: input.reason,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId })
  };
}

function childPath(parent: WorkspaceRelativePath, childName: string): WorkspaceRelativePath {
  return (parent === "." ? childName : `${parent}/${childName}`) as WorkspaceRelativePath;
}

function toFileKind(info: {
  readonly isFile: () => boolean;
  readonly isDirectory: () => boolean;
  readonly isSymbolicLink: () => boolean;
}): FileKind {
  if (info.isFile()) return "file";
  if (info.isDirectory()) return "directory";
  if (info.isSymbolicLink()) return "symlink";
  return "other";
}

import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat as nodeStat, writeFile } from "node:fs/promises";
import { ok, type Result } from "../domain/result.js";
import { fileStoreErr, ioErr, isNodeNotFound } from "./errors.js";
import { sha256Content } from "./hash.js";
import { PathLocks } from "./locks.js";
import { hashFile, receipt } from "./metadata.js";
import { asWorkspaceRelativePath, resolveWorkspacePath } from "./path.js";
import type {
  AppendOptions,
  AppendReceipt,
  CleanupOptions,
  CleanupReport,
  ContentHash,
  DeleteReceipt,
  DirectoryReceipt,
  MoveOptions,
  MoveReceipt,
  ReceiptInput,
  RemoveOptions,
  ResolvedWorkspacePath,
  WorkspaceHandle,
  WriteOptions,
  WriteReceipt
} from "./types.js";

const tempPrefix = ".feng-tmp-";

export class MutationOps {
  constructor(private readonly locks: PathLocks) {}

  async writeTextAtomic(
    workspace: WorkspaceHandle,
    logicalPath: string,
    content: string,
    options: WriteOptions
  ): Promise<Result<WriteReceipt>> {
    return this.writeBytesAtomic(workspace, logicalPath, Buffer.from(content, "utf8"), options);
  }

  async writeBinaryAtomic(
    workspace: WorkspaceHandle,
    logicalPath: string,
    content: Uint8Array,
    options: WriteOptions
  ): Promise<Result<WriteReceipt>> {
    return this.writeBytesAtomic(workspace, logicalPath, Buffer.from(content), options);
  }

  async appendRecordAtomic(
    workspace: WorkspaceHandle,
    logicalPath: string,
    record: string | Uint8Array,
    options: AppendOptions
  ): Promise<Result<AppendReceipt>> {
    const resolved = await resolveWorkspacePath(workspace, logicalPath, { allowMissing: true });
    if (!resolved.ok) return resolved;
    return this.locks.withLock(resolved.value.absolutePath, async () => {
      const current = await readExistingFileBytes(resolved.value, true);
      if (!current.ok) return current;
      const recordBytes = typeof record === "string" ? Buffer.from(record, "utf8") : Buffer.from(record);
      const appended = Buffer.concat([recordBytes, Buffer.from(options.recordSeparator ?? "\n", "utf8")]);
      const next = Buffer.concat([current.value.bytes, appended]);
      const write = await commitAtomic(resolved.value, next, options);
      if (!write.ok) return write;
      return ok({
        ...receipt(workspace, resolved.value.logicalPath, "append", options),
        ...(current.value.hash === undefined ? {} : { contentHashBefore: current.value.hash }),
        contentHashAfter: sha256Content(next),
        bytesAppended: appended.length
      });
    });
  }

  async ensureDirectory(
    workspace: WorkspaceHandle,
    logicalPath: string,
    options: ReceiptInput
  ): Promise<Result<DirectoryReceipt>> {
    const resolved = await resolveWorkspacePath(workspace, logicalPath, { allowMissing: true });
    if (!resolved.ok) return resolved;
    try {
      await mkdir(resolved.value.absolutePath, { recursive: true });
      return ok(receipt(workspace, resolved.value.logicalPath, "ensure_directory", options));
    } catch (error) {
      return ioErr("failed to ensure directory", error);
    }
  }

  async removeFile(
    workspace: WorkspaceHandle,
    logicalPath: string,
    options: RemoveOptions
  ): Promise<Result<DeleteReceipt>> {
    const resolved = await resolveWorkspacePath(workspace, logicalPath);
    if (!resolved.ok) return resolved;
    return this.locks.withLock(resolved.value.absolutePath, async () => {
      const current = await readExistingFileBytes(resolved.value);
      if (!current.ok) return current;
      try {
        await rm(resolved.value.absolutePath);
      } catch (error) {
        return ioErr("failed to remove file", error);
      }
      return ok({
        ...receipt(workspace, resolved.value.logicalPath, "delete", options),
        ...(current.value.hash === undefined ? {} : { contentHashBefore: current.value.hash }),
        bytesDeleted: current.value.bytes.length
      });
    });
  }

  async moveWithinWorkspace(
    workspace: WorkspaceHandle,
    from: string,
    to: string,
    options: MoveOptions
  ): Promise<Result<MoveReceipt>> {
    const source = await resolveWorkspacePath(workspace, from);
    if (!source.ok) return source;
    const target = await resolveWorkspacePath(workspace, to, { allowMissing: true });
    if (!target.ok) return target;
    return this.locks.withLock(source.value.absolutePath, async () => {
      if (target.value.exists) return fileStoreErr({ code: "invalid_input", message: "move target already exists" });
      const parentReady = await ensureParent(target.value, options.createParents ?? false);
      if (!parentReady.ok) return parentReady;
      try {
        await rename(source.value.absolutePath, target.value.absolutePath);
      } catch (error) {
        return ioErr("failed to move path", error);
      }
      return ok({
        ...receipt(workspace, target.value.logicalPath, "move", options),
        fromLogicalPath: source.value.logicalPath,
        toLogicalPath: target.value.logicalPath
      });
    });
  }

  async cleanupTemps(workspace: WorkspaceHandle, options: CleanupOptions): Promise<Result<CleanupReport>> {
    const removed: CleanupReport["removed"][number][] = [];
    const failed: CleanupReport["failed"][number][] = [];
    const scan = await walkTemps(workspace.root, ".", options.maxDepth ?? 8, options.maxEntries ?? 5_000, removed, failed);
    if (!scan.ok) return scan;
    return ok({
      workspaceId: workspace.id,
      removed,
      failed,
      receipt: receipt(workspace, asWorkspaceRelativePath("."), "cleanup_temps", options)
    });
  }

  private async writeBytesAtomic(
    workspace: WorkspaceHandle,
    logicalPath: string,
    content: Buffer,
    options: WriteOptions
  ): Promise<Result<WriteReceipt>> {
    const resolved = await resolveWorkspacePath(workspace, logicalPath, { allowMissing: true });
    if (!resolved.ok) return resolved;
    return this.locks.withLock(resolved.value.absolutePath, async () => {
      const before = await readExistingFileBytes(resolved.value, true);
      if (!before.ok) return before;
      const write = await commitAtomic(resolved.value, content, options);
      if (!write.ok) return write;
      return ok({
        ...receipt(workspace, resolved.value.logicalPath, "write", options),
        ...(before.value.hash === undefined ? {} : { contentHashBefore: before.value.hash }),
        contentHashAfter: sha256Content(content),
        bytesWritten: content.length
      });
    });
  }
}

async function commitAtomic(
  resolved: ResolvedWorkspacePath,
  content: Buffer,
  options: WriteOptions
): Promise<Result<void>> {
  const parentReady = await ensureParent(resolved, options.createParents ?? false);
  if (!parentReady.ok) return parentReady;
  const parent = path.dirname(resolved.absolutePath);
  const temp = path.join(parent, `${tempPrefix}${path.basename(resolved.absolutePath)}-${process.pid}-${randomUUID()}`);
  try {
    await writeFile(temp, content, { flag: "wx" });
    await rename(temp, resolved.absolutePath);
    return ok(undefined);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    return fileStoreErr({
      code: "atomic_write_failed",
      message: "failed to commit atomic write",
      retryable: true,
      cause: error
    });
  }
}

async function ensureParent(resolved: ResolvedWorkspacePath, createParents: boolean): Promise<Result<void>> {
  const parent = path.dirname(resolved.absolutePath);
  try {
    const info = await nodeStat(parent);
    if (!info.isDirectory()) return fileStoreErr({ code: "invalid_input", message: "parent is not a directory" });
    return ok(undefined);
  } catch (error) {
    if (!isNodeNotFound(error)) return ioErr("failed to inspect parent directory", error);
    if (!createParents) return fileStoreErr({ code: "not_found", message: "parent directory does not exist" });
    await mkdir(parent, { recursive: true });
    return ok(undefined);
  }
}

async function readExistingFileBytes(
  resolved: ResolvedWorkspacePath,
  allowMissing = false
): Promise<Result<{ readonly bytes: Buffer; readonly hash?: ContentHash }>> {
  try {
    const info = await nodeStat(resolved.absolutePath);
    if (!info.isFile()) return fileStoreErr({ code: "invalid_input", message: "path is not a file" });
    const bytes = await readFile(resolved.absolutePath);
    return ok({ bytes, hash: await hashFile(resolved.absolutePath) });
  } catch (error) {
    if (isNodeNotFound(error) && allowMissing) return ok({ bytes: Buffer.alloc(0) });
    if (isNodeNotFound(error)) return fileStoreErr({ code: "not_found", message: "file does not exist" });
    return ioErr("failed to read existing file", error);
  }
}

async function walkTemps(
  absolute: string,
  logical: string,
  maxDepth: number,
  maxEntries: number,
  removed: CleanupReport["removed"][number][],
  failed: CleanupReport["failed"][number][],
  state = { visited: 0 }
): Promise<Result<void>> {
  if (state.visited >= maxEntries || maxDepth < 1) return ok(undefined);
  try {
    const names = await readdir(absolute);
    for (const name of names) {
      if (state.visited++ >= maxEntries) break;
      const childAbsolute = path.join(absolute, name);
      const childLogical = logical === "." ? name : `${logical}/${name}`;
      const info = await nodeStat(childAbsolute).catch(() => undefined);
      if (!info) continue;
      if (info.isDirectory()) {
        const child = await walkTemps(childAbsolute, childLogical, maxDepth - 1, maxEntries, removed, failed, state);
        if (!child.ok) return child;
      } else if (name.startsWith(tempPrefix)) {
        try {
          await rm(childAbsolute, { force: true });
          removed.push(asWorkspaceRelativePath(childLogical));
        } catch {
          failed.push(asWorkspaceRelativePath(childLogical));
        }
      }
    }
  } catch (error) {
    return ioErr("failed to scan temp files", error);
  }
  return ok(undefined);
}

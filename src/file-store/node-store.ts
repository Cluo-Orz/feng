import { stat as nodeStat } from "node:fs/promises";
import { ok, type Result } from "../domain/result.js";
import { fileStoreErr, ioErr, isNodeNotFound } from "./errors.js";
import { listDirectory } from "./list.js";
import { PathLocks } from "./locks.js";
import { MutationOps } from "./mutation.js";
import { fileStat } from "./metadata.js";
import { openWorkspaceHandle, resolveWorkspacePath } from "./path.js";
import { readBinary, readText, readTextRange } from "./read.js";
import type {
  AppendOptions,
  AppendReceipt,
  BinaryRead,
  CleanupOptions,
  CleanupReport,
  DeleteReceipt,
  DirectoryListing,
  DirectoryReceipt,
  FileNativeStore,
  FileStat,
  LineRange,
  ListDirectoryOptions,
  MoveOptions,
  MoveReceipt,
  OpenWorkspaceInput,
  ReadOptions,
  ReceiptInput,
  RemoveOptions,
  ResolvePathOptions,
  ResolvedWorkspacePath,
  TextRead,
  TextReadOptions,
  WorkspaceDescriptor,
  WorkspaceHandle,
  WriteOptions,
  WriteReceipt
} from "./types.js";

export interface NodeFileNativeStoreOptions {
  readonly defaultMaxReadBytes?: number;
}

export function createNodeFileNativeStore(options: NodeFileNativeStoreOptions = {}): FileNativeStore {
  return new NodeFileNativeStore(options);
}

class NodeFileNativeStore implements FileNativeStore {
  private readonly defaultMaxReadBytes: number;
  private readonly mutation: MutationOps;

  constructor(options: NodeFileNativeStoreOptions) {
    this.defaultMaxReadBytes = options.defaultMaxReadBytes ?? 10 * 1024 * 1024;
    this.mutation = new MutationOps(new PathLocks());
  }

  async openWorkspace(input: OpenWorkspaceInput): Promise<Result<WorkspaceHandle>> {
    return openWorkspaceHandle(input);
  }

  async describeWorkspace(workspace: WorkspaceHandle): Promise<Result<WorkspaceDescriptor>> {
    try {
      const info = await nodeStat(workspace.root);
      if (!info.isDirectory()) {
        return fileStoreErr({ code: "invalid_input", message: "workspace root is no longer a directory" });
      }
      return ok({
        id: workspace.id,
        root: workspace.root,
        exists: true,
        kind: "directory",
        openedAt: workspace.openedAt,
        describedAt: new Date().toISOString()
      });
    } catch (error) {
      if (isNodeNotFound(error)) {
        return fileStoreErr({ code: "not_found", message: "workspace root no longer exists", cause: error });
      }
      return ioErr("failed to describe workspace", error);
    }
  }

  async resolvePath(
    workspace: WorkspaceHandle,
    logicalPath: string,
    options?: ResolvePathOptions
  ): Promise<Result<ResolvedWorkspacePath>> {
    return resolveWorkspacePath(workspace, logicalPath, options);
  }

  async stat(workspace: WorkspaceHandle, logicalPath: string): Promise<Result<FileStat>> {
    const resolved = await resolveWorkspacePath(workspace, logicalPath);
    if (!resolved.ok) return resolved;
    return fileStat(workspace, resolved.value, true);
  }

  async readText(
    workspace: WorkspaceHandle,
    logicalPath: string,
    options: TextReadOptions
  ): Promise<Result<TextRead>> {
    return readText(workspace, logicalPath, options, this.defaultMaxReadBytes);
  }

  async readTextRange(
    workspace: WorkspaceHandle,
    logicalPath: string,
    range: LineRange,
    options: TextReadOptions
  ): Promise<Result<TextRead>> {
    return readTextRange(workspace, logicalPath, range, options, this.defaultMaxReadBytes);
  }

  async readBinary(
    workspace: WorkspaceHandle,
    logicalPath: string,
    options: ReadOptions
  ): Promise<Result<BinaryRead>> {
    return readBinary(workspace, logicalPath, options, this.defaultMaxReadBytes);
  }

  async listDirectory(
    workspace: WorkspaceHandle,
    logicalPath: string,
    options: ListDirectoryOptions
  ): Promise<Result<DirectoryListing>> {
    return listDirectory(workspace, logicalPath, options);
  }

  async writeTextAtomic(
    workspace: WorkspaceHandle,
    logicalPath: string,
    content: string,
    options: WriteOptions
  ): Promise<Result<WriteReceipt>> {
    return this.mutation.writeTextAtomic(workspace, logicalPath, content, options);
  }

  async writeBinaryAtomic(
    workspace: WorkspaceHandle,
    logicalPath: string,
    content: Uint8Array,
    options: WriteOptions
  ): Promise<Result<WriteReceipt>> {
    return this.mutation.writeBinaryAtomic(workspace, logicalPath, content, options);
  }

  async appendRecordAtomic(
    workspace: WorkspaceHandle,
    logicalPath: string,
    record: string | Uint8Array,
    options: AppendOptions
  ): Promise<Result<AppendReceipt>> {
    return this.mutation.appendRecordAtomic(workspace, logicalPath, record, options);
  }

  async ensureDirectory(
    workspace: WorkspaceHandle,
    logicalPath: string,
    options: ReceiptInput
  ): Promise<Result<DirectoryReceipt>> {
    return this.mutation.ensureDirectory(workspace, logicalPath, options);
  }

  async removeFile(
    workspace: WorkspaceHandle,
    logicalPath: string,
    options: RemoveOptions
  ): Promise<Result<DeleteReceipt>> {
    return this.mutation.removeFile(workspace, logicalPath, options);
  }

  async moveWithinWorkspace(
    workspace: WorkspaceHandle,
    from: string,
    to: string,
    options: MoveOptions
  ): Promise<Result<MoveReceipt>> {
    return this.mutation.moveWithinWorkspace(workspace, from, to, options);
  }

  async cleanupTemps(workspace: WorkspaceHandle, options: CleanupOptions): Promise<Result<CleanupReport>> {
    return this.mutation.cleanupTemps(workspace, options);
  }
}

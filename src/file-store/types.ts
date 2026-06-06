import type { BrandedString } from "../domain/brand.js";
import type { WorkspaceId } from "../domain/ids.js";
import type { Result } from "../domain/result.js";

export type WorkspaceRoot = BrandedString<"WorkspaceRoot">;
export type WorkspaceRelativePath = BrandedString<"WorkspaceRelativePath">;
export type WorkspaceAbsolutePath = BrandedString<"WorkspaceAbsolutePath">;

export interface WorkspaceHandle {
  readonly id: WorkspaceId;
  readonly root: WorkspaceRoot;
  readonly openedAt: string;
}

export interface WorkspaceDescriptor {
  readonly id: WorkspaceId;
  readonly root: WorkspaceRoot;
  readonly exists: true;
  readonly kind: "directory";
  readonly openedAt: string;
  readonly describedAt: string;
}

export interface OpenWorkspaceInput {
  readonly root: string;
  readonly id?: WorkspaceId;
}

export interface ResolvedWorkspacePath {
  readonly workspaceId: WorkspaceId;
  readonly logicalPath: WorkspaceRelativePath;
  readonly absolutePath: WorkspaceAbsolutePath;
  readonly exists: boolean;
}

export interface ResolvePathOptions {
  readonly allowAbsolute?: boolean;
  readonly allowMissing?: boolean;
  readonly rejectSymlinkEscape?: boolean;
}

export const fileKinds = ["file", "directory", "symlink", "other"] as const;
export type FileKind = (typeof fileKinds)[number];

export interface ContentHash {
  readonly algorithm: "sha256";
  readonly value: string;
}

export type Encoding = "utf8";

export interface ByteRange {
  readonly offset: number;
  readonly length: number;
}

export interface LineRange {
  readonly offset: number;
  readonly limit: number;
}

export interface FileStat {
  readonly workspaceId: WorkspaceId;
  readonly logicalPath: WorkspaceRelativePath;
  readonly kind: FileKind;
  readonly size: number;
  readonly mtime: string;
  readonly contentHash?: ContentHash;
  readonly contentHashAvailable: boolean;
}

export interface DirectoryEntry {
  readonly name: string;
  readonly logicalPath: WorkspaceRelativePath;
  readonly kind: FileKind;
  readonly size?: number;
  readonly mtime?: string;
  readonly contentHash?: ContentHash;
  readonly contentHashAvailable: boolean;
}

export interface ReceiptInput {
  readonly reason: string;
  readonly correlationId?: string;
}

export interface BaseReceipt {
  readonly workspaceId: WorkspaceId;
  readonly logicalPath: WorkspaceRelativePath;
  readonly operation:
    | "read"
    | "write"
    | "append"
    | "delete"
    | "list_directory"
    | "ensure_directory"
    | "move"
    | "cleanup_temps";
  readonly timestamp: string;
  readonly reason: string;
  readonly correlationId?: string;
}

export interface ReadReceipt extends BaseReceipt {
  readonly operation: "read";
  readonly contentHash: ContentHash;
  readonly bytesRead: number;
}

export interface WriteReceipt extends BaseReceipt {
  readonly operation: "write";
  readonly contentHashBefore?: ContentHash;
  readonly contentHashAfter: ContentHash;
  readonly bytesWritten: number;
}

export interface AppendReceipt extends BaseReceipt {
  readonly operation: "append";
  readonly contentHashBefore?: ContentHash;
  readonly contentHashAfter: ContentHash;
  readonly bytesAppended: number;
}

export interface DeleteReceipt extends BaseReceipt {
  readonly operation: "delete";
  readonly contentHashBefore?: ContentHash;
  readonly bytesDeleted: number;
}

export interface DirectoryListReceipt extends BaseReceipt {
  readonly operation: "list_directory";
  readonly entriesRead: number;
  readonly truncated: boolean;
}

export interface DirectoryReceipt extends BaseReceipt {
  readonly operation: "ensure_directory";
}

export interface MoveReceipt extends BaseReceipt {
  readonly operation: "move";
  readonly fromLogicalPath: WorkspaceRelativePath;
  readonly toLogicalPath: WorkspaceRelativePath;
}

export interface CleanupReport {
  readonly workspaceId: WorkspaceId;
  readonly removed: readonly WorkspaceRelativePath[];
  readonly failed: readonly WorkspaceRelativePath[];
  readonly receipt: BaseReceipt & { readonly operation: "cleanup_temps" };
}

export interface TextRead {
  readonly logicalPath: WorkspaceRelativePath;
  readonly content: string;
  readonly encoding: Encoding;
  readonly range?: LineRange;
  readonly stat: FileStat;
  readonly receipt: ReadReceipt;
}

export interface BinaryRead {
  readonly logicalPath: WorkspaceRelativePath;
  readonly content: Uint8Array;
  readonly stat: FileStat;
  readonly receipt: ReadReceipt;
}

export interface DirectoryListing {
  readonly logicalPath: WorkspaceRelativePath;
  readonly entries: readonly DirectoryEntry[];
  readonly truncated: boolean;
  readonly receipt: DirectoryListReceipt;
}

export interface ReadOptions extends ReceiptInput {
  readonly maxBytes?: number;
}

export interface TextReadOptions extends ReadOptions {
  readonly encoding?: Encoding;
}

export interface WriteOptions extends ReceiptInput {
  readonly createParents?: boolean;
}

export interface AppendOptions extends WriteOptions {
  readonly recordSeparator?: string;
}

export interface ListDirectoryOptions extends ReceiptInput {
  readonly recursive?: boolean;
  readonly maxDepth?: number;
  readonly maxEntries?: number;
  readonly includeContentHash?: boolean;
}

export interface RemoveOptions extends ReceiptInput {}
export interface MoveOptions extends ReceiptInput {
  readonly createParents?: boolean;
}

export interface CleanupOptions extends ReceiptInput {
  readonly maxDepth?: number;
  readonly maxEntries?: number;
}

export interface FileNativeStore {
  readonly openWorkspace: (input: OpenWorkspaceInput) => Promise<Result<WorkspaceHandle>>;
  readonly describeWorkspace: (workspace: WorkspaceHandle) => Promise<Result<WorkspaceDescriptor>>;
  readonly resolvePath: (
    workspace: WorkspaceHandle,
    logicalPath: string,
    options?: ResolvePathOptions
  ) => Promise<Result<ResolvedWorkspacePath>>;
  readonly stat: (workspace: WorkspaceHandle, logicalPath: string) => Promise<Result<FileStat>>;
  readonly readText: (
    workspace: WorkspaceHandle,
    logicalPath: string,
    options: TextReadOptions
  ) => Promise<Result<TextRead>>;
  readonly readTextRange: (
    workspace: WorkspaceHandle,
    logicalPath: string,
    range: LineRange,
    options: TextReadOptions
  ) => Promise<Result<TextRead>>;
  readonly readBinary: (
    workspace: WorkspaceHandle,
    logicalPath: string,
    options: ReadOptions
  ) => Promise<Result<BinaryRead>>;
  readonly listDirectory: (
    workspace: WorkspaceHandle,
    logicalPath: string,
    options: ListDirectoryOptions
  ) => Promise<Result<DirectoryListing>>;
  readonly writeTextAtomic: (
    workspace: WorkspaceHandle,
    logicalPath: string,
    content: string,
    options: WriteOptions
  ) => Promise<Result<WriteReceipt>>;
  readonly writeBinaryAtomic: (
    workspace: WorkspaceHandle,
    logicalPath: string,
    content: Uint8Array,
    options: WriteOptions
  ) => Promise<Result<WriteReceipt>>;
  readonly appendRecordAtomic: (
    workspace: WorkspaceHandle,
    logicalPath: string,
    record: string | Uint8Array,
    options: AppendOptions
  ) => Promise<Result<AppendReceipt>>;
  readonly ensureDirectory: (
    workspace: WorkspaceHandle,
    logicalPath: string,
    options: ReceiptInput
  ) => Promise<Result<DirectoryReceipt>>;
  readonly removeFile: (
    workspace: WorkspaceHandle,
    logicalPath: string,
    options: RemoveOptions
  ) => Promise<Result<DeleteReceipt>>;
  readonly moveWithinWorkspace: (
    workspace: WorkspaceHandle,
    from: string,
    to: string,
    options: MoveOptions
  ) => Promise<Result<MoveReceipt>>;
  readonly cleanupTemps: (
    workspace: WorkspaceHandle,
    options: CleanupOptions
  ) => Promise<Result<CleanupReport>>;
}

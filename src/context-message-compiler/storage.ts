import { ok, type Result } from "../domain/result.js";
import type { FileNativeStore, WorkspaceHandle, WriteReceipt } from "../file-store/index.js";
import { contextErr } from "./errors.js";
import {
  compilePlanIndexPath,
  compilePlanRecordPath,
  invalidationIndexPath,
  invalidationRecordPath,
  messageListIndexPath,
  messageListRecordPath
} from "./paths.js";
import type {
  CompilePlanIndex,
  CompiledMessageListRecord,
  ContextCompilePlan,
  ContextCompilePlanRef,
  InvalidationIndex,
  MessageListIndex,
  MessageListInvalidationRecord,
  MessageListInvalidationId
} from "./types.js";
import type { MessageListRef } from "../domain/index.js";

export class ContextStorage {
  constructor(
    private readonly store: FileNativeStore,
    private readonly workspace: WorkspaceHandle
  ) {}

  async readCompilePlan(ref: ContextCompilePlanRef): Promise<Result<ContextCompilePlan>> {
    return this.readRecord(compilePlanRecordPath(ref.id), "compile plan is invalid", "compile plan not found");
  }

  async writeCompilePlan(record: ContextCompilePlan, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(compilePlanRecordPath(record.compilePlanId), record, reason);
  }

  async addCompilePlan(ref: ContextCompilePlanRef): Promise<Result<WriteReceipt>> {
    const index = await this.readCompilePlanIndex();
    return index.ok
      ? this.writeIndex(compilePlanIndexPath, { compilePlanRefs: uniqueRefs(index.value.compilePlanRefs, ref) })
      : index;
  }

  async readMessageList(ref: MessageListRef): Promise<Result<CompiledMessageListRecord>> {
    return this.readRecord(messageListRecordPath(ref.id), "message list record is invalid", "message list not found");
  }

  async writeMessageList(record: CompiledMessageListRecord, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(messageListRecordPath(record.messageListId), record, reason);
  }

  async addMessageList(ref: MessageListRef): Promise<Result<WriteReceipt>> {
    const index = await this.readMessageListIndex();
    return index.ok
      ? this.writeIndex(messageListIndexPath, { messageListRefs: uniqueRefs(index.value.messageListRefs, ref) })
      : index;
  }

  async writeInvalidation(record: MessageListInvalidationRecord, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(invalidationRecordPath(record.invalidationId), record, reason);
  }

  async addInvalidation(id: MessageListInvalidationId): Promise<Result<WriteReceipt>> {
    const index = await this.readInvalidationIndex();
    return index.ok
      ? this.writeIndex(invalidationIndexPath, { invalidationIds: uniqueIds(index.value.invalidationIds, id) })
      : index;
  }

  private async readCompilePlanIndex(): Promise<Result<CompilePlanIndex>> {
    return this.readIndex(compilePlanIndexPath, { compilePlanRefs: [] });
  }

  private async readMessageListIndex(): Promise<Result<MessageListIndex>> {
    return this.readIndex(messageListIndexPath, { messageListRefs: [] });
  }

  private async readInvalidationIndex(): Promise<Result<InvalidationIndex>> {
    return this.readIndex(invalidationIndexPath, { invalidationIds: [] });
  }

  private async readRecord<T>(path: string, invalid: string, missing: string): Promise<Result<T>> {
    const read = await this.store.readText(this.workspace, path, { reason: `read ${path}`, maxBytes: 1024 * 1024 });
    if (!read.ok) return read.error.code === "not_found" ? contextErr({ code: "not_found", message: missing }) : read;
    return parseJson<T>(read.value.content, invalid);
  }

  private async writeRecord(path: string, record: unknown, reason: string): Promise<Result<WriteReceipt>> {
    return this.store.writeTextAtomic(this.workspace, path, JSON.stringify(record, null, 2), {
      reason,
      createParents: true
    });
  }

  private async readIndex<T>(path: string, fallback: T): Promise<Result<T>> {
    const read = await this.store.readText(this.workspace, path, { reason: `read ${path}`, maxBytes: 512 * 1024 });
    if (!read.ok) return read.error.code === "not_found" ? ok(fallback) : read;
    return parseJson<T>(read.value.content, `${path} is invalid`);
  }

  private async writeIndex(path: string, index: unknown): Promise<Result<WriteReceipt>> {
    return this.store.writeTextAtomic(this.workspace, path, JSON.stringify(index, null, 2), {
      reason: `write ${path}`,
      createParents: true
    });
  }
}

export function parseJson<T>(content: string, message: string): Result<T> {
  try {
    return ok(JSON.parse(content) as T);
  } catch (cause) {
    return contextErr({ code: "schema_incompatible", message, cause });
  }
}

function uniqueRefs<T extends { readonly id: string }>(existing: readonly T[], ref: T): readonly T[] {
  return existing.some((item) => item.id === ref.id) ? existing : [...existing, ref];
}

function uniqueIds<T extends string>(existing: readonly T[], id: T): readonly T[] {
  return existing.includes(id) ? existing : [...existing, id];
}

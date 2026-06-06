import { ok, type Result } from "../domain/result.js";
import type { FileNativeStore, WorkspaceHandle, WriteReceipt } from "../file-store/index.js";
import type { MessageListRef } from "../domain/index.js";
import { runtimeErr } from "./errors.js";
import {
  feedbackHintIndexPath,
  feedbackHintPath,
  invocationIndexPath,
  invocationPath,
  memoryReadIndexPath,
  memoryReadPath,
  messageListIndexPath,
  messageListPath,
  outputIndexPath,
  outputPath,
  shortTermContextIndexPath,
  shortTermContextPath,
  traceIndexPath,
  tracePath,
  turnIndexPath,
  turnPath
} from "./paths.js";
import type {
  LongTermMemoryRead,
  MessageListIndex,
  RefIndex,
  RuntimeFeedbackCandidateHint,
  RuntimeInvocation,
  RuntimeMessageListRecord,
  RuntimeOutput,
  RuntimeTrace,
  RuntimeTurn,
  ShortTermContext
} from "./types.js";
import type {
  LongTermMemoryReadRef,
  RuntimeFeedbackCandidateHintRef,
  RuntimeInvocationRef,
  RuntimeOutputRef,
  RuntimeTraceRef,
  RuntimeTurnRef,
  ShortTermContextRef
} from "./refs.js";

export class AgentRuntimeStorage {
  constructor(
    private readonly store: FileNativeStore,
    private readonly workspace: WorkspaceHandle
  ) {}

  readInvocation(ref: RuntimeInvocationRef): Promise<Result<RuntimeInvocation>> {
    return this.readRecord(invocationPath(ref.id), "runtime invocation is invalid", "runtime invocation not found");
  }

  writeInvocation(record: RuntimeInvocation, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(invocationPath(record.runtimeInvocationId), record, reason);
  }

  addInvocation(ref: RuntimeInvocationRef): Promise<Result<WriteReceipt>> {
    return this.addRef(invocationIndexPath, ref, "runtime invocation index is invalid", "write runtime invocation index");
  }

  readTurn(ref: RuntimeTurnRef): Promise<Result<RuntimeTurn>> {
    return this.readRecord(turnPath(ref.id), "runtime turn is invalid", "runtime turn not found");
  }

  writeTurn(record: RuntimeTurn, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(turnPath(record.runtimeTurnId), record, reason);
  }

  addTurn(ref: RuntimeTurnRef): Promise<Result<WriteReceipt>> {
    return this.addRef(turnIndexPath, ref, "runtime turn index is invalid", "write runtime turn index");
  }

  readMessageList(ref: MessageListRef): Promise<Result<RuntimeMessageListRecord>> {
    return this.readRecord(messageListPath(ref.id), "runtime message list is invalid", "runtime message list not found");
  }

  writeMessageList(record: RuntimeMessageListRecord, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(messageListPath(record.runtimeMessageListId), record, reason);
  }

  addMessageList(ref: MessageListRef): Promise<Result<WriteReceipt>> {
    return this.addMessageRef(messageListIndexPath, ref, "runtime message list index is invalid");
  }

  readShortTermContext(ref: ShortTermContextRef): Promise<Result<ShortTermContext>> {
    return this.readRecord(shortTermContextPath(ref.id), "short term context is invalid", "short term context not found");
  }

  writeShortTermContext(record: ShortTermContext, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(shortTermContextPath(record.shortTermContextId), record, reason);
  }

  addShortTermContext(ref: ShortTermContextRef): Promise<Result<WriteReceipt>> {
    return this.addRef(shortTermContextIndexPath, ref, "short term context index is invalid", "write short term context index");
  }

  writeMemoryRead(record: LongTermMemoryRead, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(memoryReadPath(record.memoryReadId), record, reason);
  }

  addMemoryRead(ref: LongTermMemoryReadRef): Promise<Result<WriteReceipt>> {
    return this.addRef(memoryReadIndexPath, ref, "memory read index is invalid", "write memory read index");
  }

  readOutput(ref: RuntimeOutputRef): Promise<Result<RuntimeOutput>> {
    return this.readRecord(outputPath(ref.id), "runtime output is invalid", "runtime output not found");
  }

  writeOutput(record: RuntimeOutput, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(outputPath(record.runtimeOutputId), record, reason);
  }

  addOutput(ref: RuntimeOutputRef): Promise<Result<WriteReceipt>> {
    return this.addRef(outputIndexPath, ref, "runtime output index is invalid", "write runtime output index");
  }

  readTrace(ref: RuntimeTraceRef): Promise<Result<RuntimeTrace>> {
    return this.readRecord(tracePath(ref.id), "runtime trace is invalid", "runtime trace not found");
  }

  writeTrace(record: RuntimeTrace, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(tracePath(record.runtimeTraceId), record, reason);
  }

  addTrace(ref: RuntimeTraceRef): Promise<Result<WriteReceipt>> {
    return this.addRef(traceIndexPath, ref, "runtime trace index is invalid", "write runtime trace index");
  }

  readFeedbackHint(ref: RuntimeFeedbackCandidateHintRef): Promise<Result<RuntimeFeedbackCandidateHint>> {
    return this.readRecord(feedbackHintPath(ref.id), "runtime feedback hint is invalid", "runtime feedback hint not found");
  }

  writeFeedbackHint(record: RuntimeFeedbackCandidateHint, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(feedbackHintPath(record.hintId), record, reason);
  }

  addFeedbackHint(ref: RuntimeFeedbackCandidateHintRef): Promise<Result<WriteReceipt>> {
    return this.addRef(feedbackHintIndexPath, ref, "feedback hint index is invalid", "write feedback hint index");
  }

  async readAllFeedbackHints(): Promise<Result<readonly RuntimeFeedbackCandidateHint[]>> {
    const index = await this.readIndex<RefIndex<RuntimeFeedbackCandidateHintRef>>(feedbackHintIndexPath, "feedback hint index is invalid");
    if (!index.ok) return index;
    const records: RuntimeFeedbackCandidateHint[] = [];
    for (const ref of index.value.refs) {
      const record = await this.readFeedbackHint(ref);
      if (record.ok) records.push(record.value);
      else if (record.error.code !== "not_found") return record;
    }
    return ok(records);
  }

  private async addRef<T extends { readonly id: string }>(
    path: string,
    ref: T,
    invalid: string,
    reason: string
  ): Promise<Result<WriteReceipt>> {
    const index = await this.readIndex<RefIndex<T>>(path, invalid);
    return index.ok ? this.writeRecord(path, { refs: uniqueRefs(index.value.refs, ref) }, reason) : index;
  }

  private async addMessageRef(path: string, ref: MessageListRef, invalid: string): Promise<Result<WriteReceipt>> {
    const index = await this.readIndex<MessageListIndex>(path, invalid);
    return index.ok
      ? this.writeRecord(path, { refs: uniqueRefs(index.value.refs, ref) }, "write runtime message list index")
      : index;
  }

  private async readIndex<T>(path: string, invalid: string): Promise<Result<T>> {
    const read = await this.store.readText(this.workspace, path, { reason: `read ${path}`, maxBytes: 512 * 1024 });
    if (!read.ok) return read.error.code === "not_found" ? ok({ refs: [] } as T) : read;
    return parseJson<T>(read.value.content, invalid);
  }

  private async readRecord<T>(path: string, invalid: string, missing: string): Promise<Result<T>> {
    const read = await this.store.readText(this.workspace, path, { reason: `read ${path}`, maxBytes: 1024 * 1024 });
    if (!read.ok) return read.error.code === "not_found" ? runtimeErr({ code: "not_found", message: missing }) : read;
    return parseJson<T>(read.value.content, invalid);
  }

  private writeRecord(path: string, record: unknown, reason: string): Promise<Result<WriteReceipt>> {
    return this.store.writeTextAtomic(this.workspace, path, JSON.stringify(record, null, 2), {
      reason,
      createParents: true
    });
  }
}

export function parseJson<T>(content: string, message: string): Result<T> {
  try {
    return ok(JSON.parse(content) as T);
  } catch (cause) {
    return runtimeErr({ code: "schema_incompatible", message, cause });
  }
}

function uniqueRefs<T extends { readonly id: string }>(existing: readonly T[], ref: T): readonly T[] {
  return existing.some((item) => item.id === ref.id) ? existing : [...existing, ref];
}

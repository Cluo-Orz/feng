import { ok, type Result } from "../domain/result.js";
import type { FileNativeStore, WorkspaceHandle, WriteReceipt } from "../file-store/index.js";
import { cliErr } from "./errors.js";
import { cliInvocationIndexPath, cliInvocationPath } from "./paths.js";
import type { CLIInvocationId } from "./brand.js";
import type { CLIInvocationIndex, CLIInvocationReceipt } from "./types.js";

export class CLIStorage {
  constructor(
    private readonly store: FileNativeStore,
    private readonly workspace: WorkspaceHandle
  ) {}

  readReceipt(id: CLIInvocationId): Promise<Result<CLIInvocationReceipt>> {
    return this.readRecord(cliInvocationPath(id), "cli invocation receipt is invalid", "cli invocation receipt not found");
  }

  writeReceipt(record: CLIInvocationReceipt, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(cliInvocationPath(record.invocationId), record, reason);
  }

  async addInvocation(id: CLIInvocationId): Promise<Result<WriteReceipt>> {
    const index = await this.readIndex();
    if (!index.ok) return index;
    const ids = index.value.invocationIds.includes(id) ? index.value.invocationIds : [...index.value.invocationIds, id];
    return this.writeRecord(cliInvocationIndexPath, { invocationIds: ids }, "update cli invocation index");
  }

  async listReceipts(): Promise<Result<readonly CLIInvocationReceipt[]>> {
    const index = await this.readIndex();
    if (!index.ok) return index;
    const records: CLIInvocationReceipt[] = [];
    for (const id of index.value.invocationIds) {
      const record = await this.readReceipt(id as CLIInvocationId);
      if (!record.ok) {
        if (record.error.code === "not_found") continue;
        return record;
      }
      records.push(record.value);
    }
    return ok(records);
  }

  private async readIndex(): Promise<Result<CLIInvocationIndex>> {
    const read = await this.store.readText(this.workspace, cliInvocationIndexPath, {
      reason: "read cli invocation index",
      maxBytes: 512 * 1024
    });
    if (!read.ok) return read.error.code === "not_found" ? ok({ invocationIds: [] }) : read;
    return parseJson<CLIInvocationIndex>(read.value.content, "cli invocation index is invalid");
  }

  private async readRecord<T>(path: string, invalid: string, missing: string): Promise<Result<T>> {
    const read = await this.store.readText(this.workspace, path, { reason: `read ${path}`, maxBytes: 512 * 1024 });
    if (!read.ok) return read.error.code === "not_found" ? cliErr({ code: "not_found", message: missing }) : read;
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
    return cliErr({ code: "schema_incompatible", message, cause });
  }
}

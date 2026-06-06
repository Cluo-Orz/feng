import { ok, type Result } from "../domain/result.js";
import type { FileNativeStore, WorkspaceHandle, WriteReceipt } from "../file-store/index.js";
import { growUnitErr } from "./errors.js";
import { growUnitIndexPath, growUnitRecordPath } from "./paths.js";
import type { GrowUnitIndex, GrowUnitRecord } from "./types.js";

export class GrowUnitStorage {
  constructor(
    private readonly store: FileNativeStore,
    private readonly workspace: WorkspaceHandle
  ) {}

  async readRecord(ref: GrowUnitRecord["growUnitRef"]): Promise<Result<GrowUnitRecord>> {
    const read = await this.store.readText(this.workspace, growUnitRecordPath(ref.id), {
      reason: "read grow unit record",
      maxBytes: 512 * 1024
    });
    if (!read.ok) {
      return read.error.code === "not_found"
        ? growUnitErr({ code: "not_found", message: "grow unit not found" })
        : read;
    }
    return parseJson<GrowUnitRecord>(read.value.content, "grow unit record is invalid");
  }

  async writeRecord(record: GrowUnitRecord, reason = "write grow unit record"): Promise<Result<WriteReceipt>> {
    return this.store.writeTextAtomic(
      this.workspace,
      growUnitRecordPath(record.growUnitId),
      JSON.stringify(record, null, 2),
      { reason, createParents: true }
    );
  }

  async addToIndex(ref: GrowUnitRecord["growUnitRef"]): Promise<Result<WriteReceipt>> {
    const index = await this.readIndex();
    if (!index.ok) return index;
    const refs = index.value.growUnitRefs.some((item) => item.id === ref.id)
      ? index.value.growUnitRefs
      : [...index.value.growUnitRefs, ref];
    return this.store.writeTextAtomic(this.workspace, growUnitIndexPath, JSON.stringify({ growUnitRefs: refs }, null, 2), {
      reason: "write grow unit index",
      createParents: true
    });
  }

  async readAllRecords(): Promise<Result<readonly GrowUnitRecord[]>> {
    const index = await this.readIndex();
    if (!index.ok) return index;
    const records: GrowUnitRecord[] = [];
    for (const ref of index.value.growUnitRefs) {
      const record = await this.readRecord(ref);
      if (record.ok) {
        records.push(record.value);
        continue;
      }
      if (record.error.code !== "not_found") return record;
    }
    return ok(records);
  }

  private async readIndex(): Promise<Result<GrowUnitIndex>> {
    const read = await this.store.readText(this.workspace, growUnitIndexPath, {
      reason: "read grow unit index",
      maxBytes: 512 * 1024
    });
    if (!read.ok) return read.error.code === "not_found" ? ok({ growUnitRefs: [] }) : read;
    return parseJson<GrowUnitIndex>(read.value.content, "grow unit index is invalid");
  }
}

export function parseJson<T>(content: string, message: string): Result<T> {
  try {
    return ok(JSON.parse(content) as T);
  } catch (cause) {
    return growUnitErr({ code: "schema_incompatible", message, cause });
  }
}

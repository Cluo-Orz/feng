import type { RuntimeContractRef } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import type { FileNativeStore, WorkspaceHandle, WriteReceipt } from "../file-store/index.js";
import { contractErr } from "./errors.js";
import { contractReportPath, runtimeContractIndexPath, runtimeContractRecordPath } from "./paths.js";
import type {
  ContractCompletenessReport,
  ContractReportRef,
  ContractVerificationReport,
  RuntimeContractIndex,
  RuntimeContractRecord
} from "./types.js";

export class RuntimeContractStorage {
  constructor(
    private readonly store: FileNativeStore,
    private readonly workspace: WorkspaceHandle
  ) {}

  readContract(ref: RuntimeContractRef): Promise<Result<RuntimeContractRecord>> {
    return this.readRecord(runtimeContractRecordPath(ref), "runtime contract is invalid", "runtime contract not found");
  }

  writeContract(record: RuntimeContractRecord, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(runtimeContractRecordPath(record.runtimeContractRef), record, reason);
  }

  readReport(ref: ContractReportRef): Promise<Result<ContractCompletenessReport | ContractVerificationReport>> {
    return this.readRecord(contractReportPath(ref.id), "contract report is invalid", "contract report not found");
  }

  writeReport(record: ContractCompletenessReport | ContractVerificationReport, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(contractReportPath(record.reportRef.id), record, reason);
  }

  async addContract(ref: RuntimeContractRef): Promise<Result<WriteReceipt>> {
    const index = await this.readIndex();
    return index.ok ? this.writeIndex({ refs: uniqueRefs(index.value.refs, ref) }) : index;
  }

  async readAllContracts(): Promise<Result<readonly RuntimeContractRecord[]>> {
    const index = await this.readIndex();
    if (!index.ok) return index;
    const records: RuntimeContractRecord[] = [];
    for (const ref of index.value.refs) {
      const record = await this.readContract(ref);
      if (record.ok) records.push(record.value);
      else if (record.error.code !== "not_found") return record;
    }
    return ok(records);
  }

  private async readIndex(): Promise<Result<RuntimeContractIndex>> {
    const read = await this.store.readText(this.workspace, runtimeContractIndexPath, {
      reason: "read runtime contract index",
      maxBytes: 512 * 1024
    });
    if (!read.ok) return read.error.code === "not_found" ? ok({ refs: [] }) : read;
    return parseJson<RuntimeContractIndex>(read.value.content, "runtime contract index is invalid");
  }

  private writeIndex(index: RuntimeContractIndex): Promise<Result<WriteReceipt>> {
    return this.writeRecord(runtimeContractIndexPath, index, "write runtime contract index");
  }

  private async readRecord<T>(path: string, invalid: string, missing: string): Promise<Result<T>> {
    const read = await this.store.readText(this.workspace, path, { reason: `read ${path}`, maxBytes: 512 * 1024 });
    if (!read.ok) return read.error.code === "not_found" ? contractErr({ code: "not_found", message: missing }) : read;
    return parseJson<T>(read.value.content, invalid);
  }

  private async writeRecord(path: string, record: unknown, reason: string): Promise<Result<WriteReceipt>> {
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
    return contractErr({ code: "schema_incompatible", message, cause });
  }
}

function uniqueRefs<T extends { readonly id: string }>(existing: readonly T[], ref: T): readonly T[] {
  return existing.some((item) => item.id === ref.id) ? existing : [...existing, ref];
}

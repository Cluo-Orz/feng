import type { HatchPackageRef } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import type { FileNativeStore, WorkspaceHandle, WriteReceipt } from "../file-store/index.js";
import { hatchErr } from "./errors.js";
import {
  hatchBuildPlanIndexPath,
  hatchBuildPlanPath,
  hatchPackageIndexPath,
  hatchPackagePath,
  hatchRequestIndexPath,
  hatchRequestPath,
  hatchVerificationPath
} from "./paths.js";
import type {
  HatchBuildPlan,
  HatchBuildPlanIndex,
  HatchBuildPlanRef,
  HatchPackageIndex,
  HatchPackageRecord,
  HatchPackageVerification,
  HatchRequestIndex,
  HatchRequestRecord,
  HatchRequestRef,
  HatchVerificationRef
} from "./types.js";

export class HatchBuilderStorage {
  constructor(
    private readonly store: FileNativeStore,
    private readonly workspace: WorkspaceHandle
  ) {}

  readRequest(ref: HatchRequestRef): Promise<Result<HatchRequestRecord>> {
    return this.readRecord(hatchRequestPath(ref.id), "hatch request is invalid", "hatch request not found");
  }

  writeRequest(record: HatchRequestRecord, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(hatchRequestPath(record.hatchRequestRef.id), record, reason);
  }

  readBuildPlan(ref: HatchBuildPlanRef): Promise<Result<HatchBuildPlan>> {
    return this.readRecord(hatchBuildPlanPath(ref.id), "hatch build plan is invalid", "hatch build plan not found");
  }

  writeBuildPlan(record: HatchBuildPlan, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(hatchBuildPlanPath(record.hatchBuildPlanRef.id), record, reason);
  }

  readPackage(ref: HatchPackageRef): Promise<Result<HatchPackageRecord>> {
    return this.readRecord(hatchPackagePath(ref.id), "hatch package record is invalid", "hatch package not found");
  }

  writePackage(record: HatchPackageRecord, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(hatchPackagePath(record.hatchPackageRef.id), record, reason);
  }

  readVerification(ref: HatchVerificationRef): Promise<Result<HatchPackageVerification>> {
    return this.readRecord(hatchVerificationPath(ref.id), "hatch verification is invalid", "hatch verification not found");
  }

  writeVerification(record: HatchPackageVerification, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(hatchVerificationPath(record.hatchVerificationRef.id), record, reason);
  }

  async addRequest(ref: HatchRequestRef): Promise<Result<WriteReceipt>> {
    const index = await this.readRequestIndex();
    return index.ok ? this.writeRecord(hatchRequestIndexPath, { refs: uniqueRefs(index.value.refs, ref) }, "write hatch request index") : index;
  }

  async addBuildPlan(ref: HatchBuildPlanRef): Promise<Result<WriteReceipt>> {
    const index = await this.readBuildPlanIndex();
    return index.ok ? this.writeRecord(hatchBuildPlanIndexPath, { refs: uniqueRefs(index.value.refs, ref) }, "write hatch build plan index") : index;
  }

  async addPackage(ref: HatchPackageRef): Promise<Result<WriteReceipt>> {
    const index = await this.readPackageIndex();
    return index.ok ? this.writeRecord(hatchPackageIndexPath, { refs: uniqueRefs(index.value.refs, ref) }, "write hatch package index") : index;
  }

  async readAllPackages(): Promise<Result<readonly HatchPackageRecord[]>> {
    const index = await this.readPackageIndex();
    if (!index.ok) return index;
    const records: HatchPackageRecord[] = [];
    for (const ref of index.value.refs) {
      const record = await this.readPackage(ref);
      if (record.ok) records.push(record.value);
      else if (record.error.code !== "not_found") return record;
    }
    return ok(records);
  }

  async readAllBuildPlans(): Promise<Result<readonly HatchBuildPlan[]>> {
    const index = await this.readBuildPlanIndex();
    if (!index.ok) return index;
    const records: HatchBuildPlan[] = [];
    for (const ref of index.value.refs) {
      const record = await this.readBuildPlan(ref);
      if (record.ok) records.push(record.value);
      else if (record.error.code !== "not_found") return record;
    }
    return ok(records);
  }

  private readRequestIndex(): Promise<Result<HatchRequestIndex>> {
    return this.readIndex(hatchRequestIndexPath, "hatch request index is invalid");
  }

  private readBuildPlanIndex(): Promise<Result<HatchBuildPlanIndex>> {
    return this.readIndex(hatchBuildPlanIndexPath, "hatch build plan index is invalid");
  }

  private readPackageIndex(): Promise<Result<HatchPackageIndex>> {
    return this.readIndex(hatchPackageIndexPath, "hatch package index is invalid");
  }

  private async readIndex<T>(path: string, invalid: string): Promise<Result<T>> {
    const read = await this.store.readText(this.workspace, path, { reason: `read ${path}`, maxBytes: 512 * 1024 });
    if (!read.ok) return read.error.code === "not_found" ? ok({ refs: [] } as T) : read;
    return parseJson<T>(read.value.content, invalid);
  }

  private async readRecord<T>(path: string, invalid: string, missing: string): Promise<Result<T>> {
    const read = await this.store.readText(this.workspace, path, { reason: `read ${path}`, maxBytes: 512 * 1024 });
    if (!read.ok) return read.error.code === "not_found" ? hatchErr({ code: "not_found", message: missing }) : read;
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
    return hatchErr({ code: "schema_incompatible", message, cause });
  }
}

function uniqueRefs<T extends { readonly id: string }>(existing: readonly T[], ref: T): readonly T[] {
  return existing.some((item) => item.id === ref.id) ? existing : [...existing, ref];
}

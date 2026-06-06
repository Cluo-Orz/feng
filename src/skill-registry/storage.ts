import type { SkillRef } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import type { FileNativeStore, WriteReceipt, WorkspaceHandle } from "../file-store/index.js";
import { skillErr } from "./errors.js";
import { skillActivationIndexPath, skillActivationPath, skillIndexPath, skillRecordPath } from "./paths.js";
import { parseJson } from "./logic.js";
import type { SkillActivation, SkillActivationId, SkillActivationIndex, SkillCatalogIndex, SkillRecord } from "./types.js";

export class SkillRegistryStorage {
  constructor(
    private readonly store: FileNativeStore,
    private readonly workspace: WorkspaceHandle
  ) {}

  async readRecord(skillRef: SkillRef): Promise<Result<SkillRecord>> {
    const read = await this.store.readText(this.workspace, skillRecordPath(skillRef.id), {
      reason: "read skill record",
      maxBytes: 512 * 1024
    });
    if (!read.ok) return read.error.code === "not_found" ? skillErr({ code: "not_found", message: "skill not found" }) : read;
    return parseJson<SkillRecord>(read.value.content, "skill record is invalid");
  }

  async writeRecord(record: SkillRecord): Promise<Result<WriteReceipt>> {
    return this.store.writeTextAtomic(this.workspace, skillRecordPath(record.skillId), JSON.stringify(record, null, 2), {
      reason: "write skill record",
      createParents: true
    });
  }

  async writeActivationRecord(activation: SkillActivation): Promise<Result<WriteReceipt>> {
    return this.store.writeTextAtomic(
      this.workspace,
      skillActivationPath(activation.activationId),
      JSON.stringify(activation, null, 2),
      { reason: "write skill activation", createParents: true }
    );
  }

  async readAllRecords(): Promise<Result<readonly SkillRecord[]>> {
    const index = await this.readIndex();
    if (!index.ok) return index;
    const records: SkillRecord[] = [];
    for (const ref of index.value.skillRefs) {
      const record = await this.readRecord(ref);
      if (record.ok) {
        records.push(record.value);
        continue;
      }
      if (record.error.code !== "not_found") return record;
    }
    return ok(records);
  }

  async recordsForFamily(family: string): Promise<Result<readonly SkillRecord[]>> {
    const records = await this.readAllRecords();
    return records.ok ? ok(records.value.filter((record) => record.family === family)) : records;
  }

  async findVersion(skillRef: SkillRef, version: string): Promise<Result<SkillRecord>> {
    const base = await this.readRecord(skillRef);
    if (!base.ok) return base;
    const records = await this.recordsForFamily(base.value.family);
    if (!records.ok) return records;
    const found = records.value.find((record) => record.version.schemaVersion === version);
    return found === undefined ? skillErr({ code: "not_found", message: "skill version not found" }) : ok(found);
  }

  async readAllActivations(): Promise<Result<readonly SkillActivation[]>> {
    const index = await this.readActivationIndex();
    if (!index.ok) return index;
    const activations: SkillActivation[] = [];
    for (const activationId of index.value.activationIds) {
      const read = await this.store.readText(this.workspace, skillActivationPath(activationId), {
        reason: "read skill activation",
        maxBytes: 256 * 1024
      });
      if (!read.ok) {
        if (read.error.code === "not_found") continue;
        return read;
      }
      const parsed = parseJson<SkillActivation>(read.value.content, "skill activation is invalid");
      if (!parsed.ok) return parsed;
      activations.push(parsed.value);
    }
    return ok(activations);
  }

  async addRecordToIndex(skillRef: SkillRef): Promise<Result<WriteReceipt>> {
    const index = await this.readIndex();
    if (!index.ok) return index;
    const refs = index.value.skillRefs.some((ref) => ref.id === skillRef.id)
      ? index.value.skillRefs
      : [...index.value.skillRefs, skillRef];
    return this.store.writeTextAtomic(this.workspace, skillIndexPath, JSON.stringify({ skillRefs: refs }, null, 2), {
      reason: "write skill index",
      createParents: true
    });
  }

  async addActivationToIndex(activationId: SkillActivationId): Promise<Result<WriteReceipt>> {
    const index = await this.readActivationIndex();
    if (!index.ok) return index;
    const ids = index.value.activationIds.includes(activationId)
      ? index.value.activationIds
      : [...index.value.activationIds, activationId];
    return this.store.writeTextAtomic(this.workspace, skillActivationIndexPath, JSON.stringify({ activationIds: ids }, null, 2), {
      reason: "write skill activation index",
      createParents: true
    });
  }

  private async readIndex(): Promise<Result<SkillCatalogIndex>> {
    const read = await this.store.readText(this.workspace, skillIndexPath, {
      reason: "read skill index",
      maxBytes: 512 * 1024
    });
    if (!read.ok) return read.error.code === "not_found" ? ok({ skillRefs: [] }) : read;
    return parseJson<SkillCatalogIndex>(read.value.content, "skill index is invalid");
  }

  private async readActivationIndex(): Promise<Result<SkillActivationIndex>> {
    const read = await this.store.readText(this.workspace, skillActivationIndexPath, {
      reason: "read skill activation index",
      maxBytes: 512 * 1024
    });
    if (!read.ok) return read.error.code === "not_found" ? ok({ activationIds: [] }) : read;
    return parseJson<SkillActivationIndex>(read.value.content, "skill activation index is invalid");
  }
}

import { ok, type Result } from "../domain/result.js";
import type { FileNativeStore, WorkspaceHandle, WriteReceipt } from "../file-store/index.js";
import { agendaErr } from "./errors.js";
import {
  agendaIndexPath,
  agendaItemIndexPath,
  agendaItemRecordPath,
  agendaRecordPath,
  attemptIntentIndexPath,
  attemptIntentRecordPath,
  dodIndexPath,
  dodRecordPath,
  gapIndexPath,
  gapRecordPath
} from "./paths.js";
import type {
  AgendaIndex,
  AgendaItemIndex,
  AgendaItemRecord,
  AgendaItemRef,
  AgendaRecord,
  AgendaRef,
  AttemptIntentIndex,
  AttemptIntentRecord,
  AttemptIntentRef,
  DoDIndex,
  DoDItemRecord,
  DoDRef,
  GapIndex,
  GapRecord,
  GapRef
} from "./types.js";

export class AgendaStorage {
  constructor(
    private readonly store: FileNativeStore,
    private readonly workspace: WorkspaceHandle
  ) {}

  async readAgenda(ref: AgendaRef): Promise<Result<AgendaRecord>> {
    return this.readRecord(agendaRecordPath(ref.id), "agenda record is invalid", "agenda not found");
  }

  async writeAgenda(record: AgendaRecord, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(agendaRecordPath(record.agendaId), record, reason);
  }

  async readAgendaItem(ref: AgendaItemRef): Promise<Result<AgendaItemRecord>> {
    return this.readRecord(agendaItemRecordPath(ref.id), "agenda item record is invalid", "agenda item not found");
  }

  async writeAgendaItem(record: AgendaItemRecord, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(agendaItemRecordPath(record.agendaItemId), record, reason);
  }

  async readGap(ref: GapRef): Promise<Result<GapRecord>> {
    return this.readRecord(gapRecordPath(ref.id), "gap record is invalid", "gap not found");
  }

  async writeGap(record: GapRecord, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(gapRecordPath(record.gapId), record, reason);
  }

  async readDoD(ref: DoDRef): Promise<Result<DoDItemRecord>> {
    return this.readRecord(dodRecordPath(ref.id), "dod record is invalid", "dod not found");
  }

  async writeDoD(record: DoDItemRecord, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(dodRecordPath(record.dodId), record, reason);
  }

  async readAttemptIntent(ref: AttemptIntentRef): Promise<Result<AttemptIntentRecord>> {
    return this.readRecord(
      attemptIntentRecordPath(ref.id),
      "attempt intent record is invalid",
      "attempt intent not found"
    );
  }

  async writeAttemptIntent(record: AttemptIntentRecord, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(attemptIntentRecordPath(record.attemptIntentId), record, reason);
  }

  async addAgenda(ref: AgendaRef): Promise<Result<WriteReceipt>> {
    const index = await this.readAgendaIndex();
    return index.ok ? this.writeIndex(agendaIndexPath, { agendaRefs: uniqueRefs(index.value.agendaRefs, ref) }) : index;
  }

  async addAgendaItem(ref: AgendaItemRef): Promise<Result<WriteReceipt>> {
    const index = await this.readAgendaItemIndex();
    return index.ok
      ? this.writeIndex(agendaItemIndexPath, { agendaItemRefs: uniqueRefs(index.value.agendaItemRefs, ref) })
      : index;
  }

  async addGap(ref: GapRef): Promise<Result<WriteReceipt>> {
    const index = await this.readGapIndex();
    return index.ok ? this.writeIndex(gapIndexPath, { gapRefs: uniqueRefs(index.value.gapRefs, ref) }) : index;
  }

  async addDoD(ref: DoDRef): Promise<Result<WriteReceipt>> {
    const index = await this.readDoDIndex();
    return index.ok ? this.writeIndex(dodIndexPath, { dodRefs: uniqueRefs(index.value.dodRefs, ref) }) : index;
  }

  async addAttemptIntent(ref: AttemptIntentRef): Promise<Result<WriteReceipt>> {
    const index = await this.readAttemptIntentIndex();
    return index.ok
      ? this.writeIndex(attemptIntentIndexPath, {
        attemptIntentRefs: uniqueRefs(index.value.attemptIntentRefs, ref)
      })
      : index;
  }

  async readAllAgendas(): Promise<Result<readonly AgendaRecord[]>> {
    const index = await this.readAgendaIndex();
    return index.ok ? this.readRecords(index.value.agendaRefs, (ref) => this.readAgenda(ref)) : index;
  }

  async readAllAgendaItems(): Promise<Result<readonly AgendaItemRecord[]>> {
    const index = await this.readAgendaItemIndex();
    return index.ok ? this.readRecords(index.value.agendaItemRefs, (ref) => this.readAgendaItem(ref)) : index;
  }

  async readAllGaps(): Promise<Result<readonly GapRecord[]>> {
    const index = await this.readGapIndex();
    return index.ok ? this.readRecords(index.value.gapRefs, (ref) => this.readGap(ref)) : index;
  }

  async readAllDoD(): Promise<Result<readonly DoDItemRecord[]>> {
    const index = await this.readDoDIndex();
    return index.ok ? this.readRecords(index.value.dodRefs, (ref) => this.readDoD(ref)) : index;
  }

  private async readAgendaIndex(): Promise<Result<AgendaIndex>> {
    return this.readIndex(agendaIndexPath, { agendaRefs: [] });
  }

  private async readAgendaItemIndex(): Promise<Result<AgendaItemIndex>> {
    return this.readIndex(agendaItemIndexPath, { agendaItemRefs: [] });
  }

  private async readGapIndex(): Promise<Result<GapIndex>> {
    return this.readIndex(gapIndexPath, { gapRefs: [] });
  }

  private async readDoDIndex(): Promise<Result<DoDIndex>> {
    return this.readIndex(dodIndexPath, { dodRefs: [] });
  }

  private async readAttemptIntentIndex(): Promise<Result<AttemptIntentIndex>> {
    return this.readIndex(attemptIntentIndexPath, { attemptIntentRefs: [] });
  }

  private async readRecord<T>(path: string, invalid: string, missing: string): Promise<Result<T>> {
    const read = await this.store.readText(this.workspace, path, { reason: `read ${path}`, maxBytes: 512 * 1024 });
    if (!read.ok) return read.error.code === "not_found" ? agendaErr({ code: "not_found", message: missing }) : read;
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

  private async readRecords<Ref, Record>(
    refs: readonly Ref[],
    reader: (ref: Ref) => Promise<Result<Record>>
  ): Promise<Result<readonly Record[]>> {
    const records: Record[] = [];
    for (const ref of refs) {
      const record = await reader(ref);
      if (record.ok) records.push(record.value);
      else if (record.error.code !== "not_found") return record;
    }
    return ok(records);
  }
}

export function parseJson<T>(content: string, message: string): Result<T> {
  try {
    return ok(JSON.parse(content) as T);
  } catch (cause) {
    return agendaErr({ code: "schema_incompatible", message, cause });
  }
}

function uniqueRefs<T extends { readonly id: string }>(existing: readonly T[], ref: T): readonly T[] {
  return existing.some((item) => item.id === ref.id) ? existing : [...existing, ref];
}

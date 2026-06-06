import { ok, type Result } from "../domain/result.js";
import type { AttemptRef } from "../domain/index.js";
import type { FileNativeStore, WorkspaceHandle, WriteReceipt } from "../file-store/index.js";
import { attemptErr } from "./errors.js";
import {
  attemptCandidatePath,
  attemptCheckpointPath,
  attemptIndexPath,
  attemptOutcomePath,
  attemptPlanPath,
  attemptRecordPath,
  attemptSnapshotPath,
  attemptTurnPath
} from "./paths.js";
import type {
  AttemptCheckpoint,
  AttemptExecutionPlan,
  AttemptIndex,
  AttemptInputSnapshot,
  AttemptOutcomeSummary,
  AttemptRecord,
  AttemptTurnRecord,
  CandidateOutputRecord
} from "./types.js";

export class AttemptStorage {
  constructor(
    private readonly store: FileNativeStore,
    private readonly workspace: WorkspaceHandle
  ) {}

  async readAttempt(ref: AttemptRef): Promise<Result<AttemptRecord>> {
    const read = await this.store.readText(this.workspace, attemptRecordPath(ref.id), {
      reason: "read attempt record",
      maxBytes: 512 * 1024
    });
    if (!read.ok) {
      return read.error.code === "not_found"
        ? attemptErr({ code: "not_found", message: "attempt not found" })
        : read;
    }
    return parseJson<AttemptRecord>(read.value.content, "attempt record is invalid JSON");
  }

  async writeAttempt(record: AttemptRecord, reason = "write attempt record"): Promise<Result<WriteReceipt>> {
    return this.store.writeTextAtomic(
      this.workspace,
      attemptRecordPath(record.attemptId),
      JSON.stringify(record, null, 2),
      { reason, createParents: true }
    );
  }

  async addAttempt(ref: AttemptRef): Promise<Result<WriteReceipt>> {
    const index = await this.readIndex();
    if (!index.ok) return index;
    const refs = uniqueRefs(index.value.attemptRefs, ref);
    return this.store.writeTextAtomic(this.workspace, attemptIndexPath, JSON.stringify({ attemptRefs: refs }, null, 2), {
      reason: "write attempt index",
      createParents: true
    });
  }

  async readAllAttempts(): Promise<Result<readonly AttemptRecord[]>> {
    const index = await this.readIndex();
    if (!index.ok) return index;
    const records: AttemptRecord[] = [];
    for (const ref of index.value.attemptRefs) {
      const record = await this.readAttempt(ref);
      if (record.ok) records.push(record.value);
      else if (record.error.code !== "not_found") return record;
    }
    return ok(records);
  }

  async writeSnapshot(record: AttemptInputSnapshot): Promise<Result<WriteReceipt>> {
    return this.writeJson(attemptSnapshotPath(record.attemptRef.id, record.snapshotId), record, "write attempt snapshot");
  }

  async readSnapshot(record: AttemptRecord): Promise<Result<AttemptInputSnapshot>> {
    if (record.inputSnapshotRef === undefined) {
      return attemptErr({ code: "not_found", message: "attempt has no input snapshot" });
    }
    return this.readJson(
      attemptSnapshotPath(record.attemptId, record.inputSnapshotRef.id),
      "attempt snapshot is invalid JSON",
      "attempt snapshot not found"
    );
  }

  async writePlan(record: AttemptExecutionPlan): Promise<Result<WriteReceipt>> {
    return this.writeJson(attemptPlanPath(record.attemptRef.id, record.executionPlanId), record, "write execution plan");
  }

  async readPlan(record: AttemptRecord): Promise<Result<AttemptExecutionPlan>> {
    if (record.executionPlanRef === undefined) {
      return attemptErr({ code: "not_found", message: "attempt has no execution plan" });
    }
    return this.readJson(
      attemptPlanPath(record.attemptId, record.executionPlanRef.id),
      "attempt plan is invalid JSON",
      "attempt plan not found"
    );
  }

  async writeTurn(record: AttemptTurnRecord): Promise<Result<WriteReceipt>> {
    return this.writeJson(attemptTurnPath(record.attemptRef.id, record.turnId), record, "write attempt turn");
  }

  async readTurn(attempt: AttemptRecord, ref: AttemptTurnRecord["turnRef"]): Promise<Result<AttemptTurnRecord>> {
    return this.readJson(
      attemptTurnPath(attempt.attemptId, ref.id),
      "attempt turn is invalid JSON",
      "attempt turn not found"
    );
  }

  async writeCandidate(record: CandidateOutputRecord): Promise<Result<WriteReceipt>> {
    return this.writeJson(
      attemptCandidatePath(record.attemptRef.id, record.candidateOutputId),
      record,
      "write candidate output record"
    );
  }

  async readCandidate(attempt: AttemptRecord, ref: CandidateOutputRecord["candidateOutputRef"]): Promise<Result<CandidateOutputRecord>> {
    return this.readJson(
      attemptCandidatePath(attempt.attemptId, ref.id),
      "candidate output record is invalid JSON",
      "candidate output not found"
    );
  }

  async writeCheckpoint(record: AttemptCheckpoint): Promise<Result<WriteReceipt>> {
    return this.writeJson(
      attemptCheckpointPath(record.attemptRef.id, record.checkpointId),
      record,
      "write attempt checkpoint"
    );
  }

  async readCheckpoint(attempt: AttemptRecord, ref: AttemptCheckpoint["checkpointRef"]): Promise<Result<AttemptCheckpoint>> {
    return this.readJson(
      attemptCheckpointPath(attempt.attemptId, ref.id),
      "attempt checkpoint is invalid JSON",
      "attempt checkpoint not found"
    );
  }

  async writeOutcome(record: AttemptOutcomeSummary): Promise<Result<WriteReceipt>> {
    return this.writeJson(
      attemptOutcomePath(record.attemptRef.id, record.outcomeSummaryId),
      record,
      "write attempt outcome"
    );
  }

  async readOutcome(record: AttemptRecord): Promise<Result<AttemptOutcomeSummary>> {
    if (record.outcomeSummaryRef === undefined) {
      return attemptErr({ code: "not_found", message: "attempt has no outcome summary" });
    }
    return this.readJson(
      attemptOutcomePath(record.attemptId, record.outcomeSummaryRef.id),
      "attempt outcome is invalid JSON",
      "attempt outcome not found"
    );
  }

  private async readIndex(): Promise<Result<AttemptIndex>> {
    const read = await this.store.readText(this.workspace, attemptIndexPath, {
      reason: "read attempt index",
      maxBytes: 512 * 1024
    });
    if (!read.ok) return read.error.code === "not_found" ? ok({ attemptRefs: [] }) : read;
    return parseJson<AttemptIndex>(read.value.content, "attempt index is invalid JSON");
  }

  private async writeJson(path: string, value: unknown, reason: string): Promise<Result<WriteReceipt>> {
    return this.store.writeTextAtomic(this.workspace, path, JSON.stringify(value, null, 2), {
      reason,
      createParents: true
    });
  }

  private async readJson<T>(path: string, invalid: string, missing: string): Promise<Result<T>> {
    const read = await this.store.readText(this.workspace, path, { reason: `read ${path}`, maxBytes: 1024 * 1024 });
    if (!read.ok) return read.error.code === "not_found" ? attemptErr({ code: "not_found", message: missing }) : read;
    return parseJson<T>(read.value.content, invalid);
  }
}

export function parseJson<T>(content: string, message: string): Result<T> {
  try {
    return ok(JSON.parse(content) as T);
  } catch (cause) {
    return attemptErr({ code: "schema_incompatible", message, cause });
  }
}

function uniqueRefs<T extends { readonly id: string }>(existing: readonly T[], ref: T): readonly T[] {
  return existing.some((item) => item.id === ref.id) ? existing : [...existing, ref];
}

import { ok, type Result } from "../domain/result.js";
import type { FileNativeStore, WorkspaceHandle, WriteReceipt } from "../file-store/index.js";
import { evidenceErr } from "./errors.js";
import {
  assessmentIndexPath,
  assessmentRecordPath,
  evaluationIndexPath,
  evaluationRecordPath,
  evidenceIndexPath,
  evidenceRecordPath,
  gapIndexPath,
  gapRecordPath,
  verdictIndexPath,
  verdictRecordPath
} from "./paths.js";
import type {
  AssessmentIndex,
  DoDEvaluation,
  DoDEvaluationRef,
  EvaluationIndex,
  EvidenceIndex,
  EvidenceRecord,
  EvidenceRef,
  GapIndex,
  ReadinessAssessment,
  ReadinessAssessmentRef,
  ReadinessGap,
  ReadinessGapRef,
  ReadinessVerdictRecord,
  ReadinessVerdictRef,
  VerdictIndex
} from "./types.js";

export class EvidenceStorage {
  constructor(
    private readonly store: FileNativeStore,
    private readonly workspace: WorkspaceHandle
  ) {}

  readEvidence(ref: EvidenceRef): Promise<Result<EvidenceRecord>> {
    return this.readRecord(evidenceRecordPath(ref.id), "evidence record is invalid", "evidence not found");
  }

  writeEvidence(record: EvidenceRecord, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(evidenceRecordPath(record.evidenceId), record, reason);
  }

  readEvaluation(ref: DoDEvaluationRef): Promise<Result<DoDEvaluation>> {
    return this.readRecord(evaluationRecordPath(ref.id), "dod evaluation is invalid", "dod evaluation not found");
  }

  writeEvaluation(record: DoDEvaluation, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(evaluationRecordPath(record.dodEvaluationId), record, reason);
  }

  readAssessment(ref: ReadinessAssessmentRef): Promise<Result<ReadinessAssessment>> {
    return this.readRecord(assessmentRecordPath(ref.id), "readiness assessment is invalid", "readiness assessment not found");
  }

  writeAssessment(record: ReadinessAssessment, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(assessmentRecordPath(record.readinessAssessmentId), record, reason);
  }

  readGap(ref: ReadinessGapRef): Promise<Result<ReadinessGap>> {
    return this.readRecord(gapRecordPath(ref.id), "readiness gap is invalid", "readiness gap not found");
  }

  writeGap(record: ReadinessGap, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(gapRecordPath(record.readinessGapId), record, reason);
  }

  readVerdict(ref: ReadinessVerdictRef): Promise<Result<ReadinessVerdictRecord>> {
    return this.readRecord(verdictRecordPath(ref.id), "readiness verdict is invalid", "readiness verdict not found");
  }

  writeVerdict(record: ReadinessVerdictRecord, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(verdictRecordPath(record.readinessVerdictId), record, reason);
  }

  async addEvidence(ref: EvidenceRef): Promise<Result<WriteReceipt>> {
    const index = await this.readEvidenceIndex();
    return index.ok ? this.writeIndex(evidenceIndexPath, { evidenceRefs: uniqueRefs(index.value.evidenceRefs, ref) }) : index;
  }

  async addEvaluation(ref: DoDEvaluationRef): Promise<Result<WriteReceipt>> {
    const index = await this.readEvaluationIndex();
    return index.ok
      ? this.writeIndex(evaluationIndexPath, { evaluationRefs: uniqueRefs(index.value.evaluationRefs, ref) })
      : index;
  }

  async addAssessment(ref: ReadinessAssessmentRef): Promise<Result<WriteReceipt>> {
    const index = await this.readAssessmentIndex();
    return index.ok
      ? this.writeIndex(assessmentIndexPath, { assessmentRefs: uniqueRefs(index.value.assessmentRefs, ref) })
      : index;
  }

  async addGap(ref: ReadinessGapRef): Promise<Result<WriteReceipt>> {
    const index = await this.readGapIndex();
    return index.ok ? this.writeIndex(gapIndexPath, { gapRefs: uniqueRefs(index.value.gapRefs, ref) }) : index;
  }

  async addVerdict(ref: ReadinessVerdictRef): Promise<Result<WriteReceipt>> {
    const index = await this.readVerdictIndex();
    return index.ok
      ? this.writeIndex(verdictIndexPath, { verdictRefs: uniqueRefs(index.value.verdictRefs, ref) })
      : index;
  }

  async readAllEvidence(): Promise<Result<readonly EvidenceRecord[]>> {
    const index = await this.readEvidenceIndex();
    return index.ok ? this.readRecords(index.value.evidenceRefs, (ref) => this.readEvidence(ref)) : index;
  }

  async readAllEvaluations(): Promise<Result<readonly DoDEvaluation[]>> {
    const index = await this.readEvaluationIndex();
    return index.ok ? this.readRecords(index.value.evaluationRefs, (ref) => this.readEvaluation(ref)) : index;
  }

  async readAllAssessments(): Promise<Result<readonly ReadinessAssessment[]>> {
    const index = await this.readAssessmentIndex();
    return index.ok ? this.readRecords(index.value.assessmentRefs, (ref) => this.readAssessment(ref)) : index;
  }

  async readAllGaps(): Promise<Result<readonly ReadinessGap[]>> {
    const index = await this.readGapIndex();
    return index.ok ? this.readRecords(index.value.gapRefs, (ref) => this.readGap(ref)) : index;
  }

  async readAllVerdicts(): Promise<Result<readonly ReadinessVerdictRecord[]>> {
    const index = await this.readVerdictIndex();
    return index.ok ? this.readRecords(index.value.verdictRefs, (ref) => this.readVerdict(ref)) : index;
  }

  private readEvidenceIndex(): Promise<Result<EvidenceIndex>> {
    return this.readIndex(evidenceIndexPath, { evidenceRefs: [] });
  }

  private readEvaluationIndex(): Promise<Result<EvaluationIndex>> {
    return this.readIndex(evaluationIndexPath, { evaluationRefs: [] });
  }

  private readAssessmentIndex(): Promise<Result<AssessmentIndex>> {
    return this.readIndex(assessmentIndexPath, { assessmentRefs: [] });
  }

  private readGapIndex(): Promise<Result<GapIndex>> {
    return this.readIndex(gapIndexPath, { gapRefs: [] });
  }

  private readVerdictIndex(): Promise<Result<VerdictIndex>> {
    return this.readIndex(verdictIndexPath, { verdictRefs: [] });
  }

  private async readRecord<T>(path: string, invalid: string, missing: string): Promise<Result<T>> {
    const read = await this.store.readText(this.workspace, path, { reason: `read ${path}`, maxBytes: 512 * 1024 });
    if (!read.ok) return read.error.code === "not_found" ? evidenceErr({ code: "not_found", message: missing }) : read;
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
    return evidenceErr({ code: "schema_incompatible", message, cause });
  }
}

function uniqueRefs<T extends { readonly id: string }>(existing: readonly T[], ref: T): readonly T[] {
  return existing.some((item) => item.id === ref.id) ? existing : [...existing, ref];
}

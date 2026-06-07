import { ok, type Result } from "../domain/result.js";
import type { TargetWorldRef } from "../domain/index.js";
import type { FileNativeStore, WorkspaceHandle, WriteReceipt } from "../file-store/index.js";
import { targetErr } from "./errors.js";
import {
  adapterIndexPath,
  adapterPath,
  compatibilityIndexPath,
  compatibilityPath,
  debugSignalIndexPath,
  debugSignalPath,
  failureMappingIndexPath,
  failureMappingPath,
  targetActionIndexPath,
  targetActionPath,
  targetWorldIndexPath,
  targetWorldPath,
  validationIndexPath,
  validationPath,
  worldInputIndexPath,
  worldInputPath,
  worldOutputIndexPath,
  worldOutputPath
} from "./paths.js";
import type {
  RefIndex,
  TargetActionRequest,
  TargetActionRequestRef,
  TargetDebugSignal,
  TargetDebugSignalRef,
  TargetFailureMapping,
  TargetFailureMappingRef,
  TargetValidationReport,
  TargetValidationReportRef,
  TargetWorldAdapterDefinition,
  TargetWorldAdapterRef,
  TargetWorldCompatibilityReport,
  TargetWorldCompatibilityReportRef,
  TargetWorldDescriptor,
  WorldInputEnvelope,
  WorldInputEnvelopeRef,
  WorldOutputEnvelope,
  WorldOutputEnvelopeRef
} from "./types.js";

export class TargetWorldAdapterStorage {
  constructor(
    private readonly store: FileNativeStore,
    private readonly workspace: WorkspaceHandle
  ) {}

  readTargetWorld(ref: TargetWorldRef): Promise<Result<TargetWorldDescriptor>> {
    return this.readRecord(targetWorldPath(ref.id), "target world record is invalid", "target world not found");
  }

  writeTargetWorld(record: TargetWorldDescriptor, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(targetWorldPath(record.targetWorldId), record, reason);
  }

  addTargetWorld(ref: TargetWorldRef): Promise<Result<WriteReceipt>> {
    return this.addRef(targetWorldIndexPath, ref, "target world index is invalid", "write target world index");
  }

  readAdapter(ref: TargetWorldAdapterRef): Promise<Result<TargetWorldAdapterDefinition>> {
    return this.readRecord(adapterPath(ref.id), "target world adapter record is invalid", "target world adapter not found");
  }

  writeAdapter(record: TargetWorldAdapterDefinition, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(adapterPath(record.adapterId), record, reason);
  }

  addAdapter(ref: TargetWorldAdapterRef): Promise<Result<WriteReceipt>> {
    return this.addRef(adapterIndexPath, ref, "target world adapter index is invalid", "write target world adapter index");
  }

  readCompatibility(ref: TargetWorldCompatibilityReportRef): Promise<Result<TargetWorldCompatibilityReport>> {
    return this.readRecord(compatibilityPath(ref.id), "compatibility report is invalid", "compatibility report not found");
  }

  writeCompatibility(record: TargetWorldCompatibilityReport, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(compatibilityPath(record.reportId), record, reason);
  }

  addCompatibility(ref: TargetWorldCompatibilityReportRef): Promise<Result<WriteReceipt>> {
    return this.addRef(compatibilityIndexPath, ref, "compatibility index is invalid", "write compatibility index");
  }

  readWorldInput(ref: WorldInputEnvelopeRef): Promise<Result<WorldInputEnvelope>> {
    return this.readRecord(worldInputPath(ref.id), "world input envelope is invalid", "world input envelope not found");
  }

  writeWorldInput(record: WorldInputEnvelope, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(worldInputPath(record.worldInputId), record, reason);
  }

  addWorldInput(ref: WorldInputEnvelopeRef): Promise<Result<WriteReceipt>> {
    return this.addRef(worldInputIndexPath, ref, "world input index is invalid", "write world input index");
  }

  readWorldOutput(ref: WorldOutputEnvelopeRef): Promise<Result<WorldOutputEnvelope>> {
    return this.readRecord(worldOutputPath(ref.id), "world output envelope is invalid", "world output envelope not found");
  }

  writeWorldOutput(record: WorldOutputEnvelope, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(worldOutputPath(record.worldOutputId), record, reason);
  }

  addWorldOutput(ref: WorldOutputEnvelopeRef): Promise<Result<WriteReceipt>> {
    return this.addRef(worldOutputIndexPath, ref, "world output index is invalid", "write world output index");
  }

  readAction(ref: TargetActionRequestRef): Promise<Result<TargetActionRequest>> {
    return this.readRecord(targetActionPath(ref.id), "target action request is invalid", "target action request not found");
  }

  writeAction(record: TargetActionRequest, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(targetActionPath(record.targetActionRequestId), record, reason);
  }

  addAction(ref: TargetActionRequestRef): Promise<Result<WriteReceipt>> {
    return this.addRef(targetActionIndexPath, ref, "target action index is invalid", "write target action index");
  }

  writeValidation(record: TargetValidationReport, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(validationPath(record.validationReportId), record, reason);
  }

  addValidation(ref: TargetValidationReportRef): Promise<Result<WriteReceipt>> {
    return this.addRef(validationIndexPath, ref, "validation index is invalid", "write validation index");
  }

  writeFailureMapping(record: TargetFailureMapping, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(failureMappingPath(record.failureMappingId), record, reason);
  }

  addFailureMapping(ref: TargetFailureMappingRef): Promise<Result<WriteReceipt>> {
    return this.addRef(failureMappingIndexPath, ref, "failure mapping index is invalid", "write failure mapping index");
  }

  writeDebugSignal(record: TargetDebugSignal, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(debugSignalPath(record.debugSignalId), record, reason);
  }

  readDebugSignal(ref: TargetDebugSignalRef): Promise<Result<TargetDebugSignal>> {
    return this.readRecord(debugSignalPath(ref.id), "debug signal record is invalid", "debug signal not found");
  }

  addDebugSignal(ref: TargetDebugSignalRef): Promise<Result<WriteReceipt>> {
    return this.addRef(debugSignalIndexPath, ref, "debug signal index is invalid", "write debug signal index");
  }

  async readAllAdapters(): Promise<Result<readonly TargetWorldAdapterDefinition[]>> {
    const index = await this.readIndex<RefIndex<TargetWorldAdapterRef>>(adapterIndexPath, "target world adapter index is invalid");
    if (!index.ok) return index;
    const records: TargetWorldAdapterDefinition[] = [];
    for (const ref of index.value.refs) {
      const record = await this.readAdapter(ref);
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

  private async readIndex<T>(path: string, invalid: string): Promise<Result<T>> {
    const read = await this.store.readText(this.workspace, path, { reason: `read ${path}`, maxBytes: 512 * 1024 });
    if (!read.ok) return read.error.code === "not_found" ? ok({ refs: [] } as T) : read;
    return parseJson<T>(read.value.content, invalid);
  }

  private async readRecord<T>(path: string, invalid: string, missing: string): Promise<Result<T>> {
    const read = await this.store.readText(this.workspace, path, { reason: `read ${path}`, maxBytes: 512 * 1024 });
    if (!read.ok) return read.error.code === "not_found" ? targetErr({ code: "not_found", message: missing }) : read;
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
    return targetErr({ code: "schema_incompatible", message, cause });
  }
}

function uniqueRefs<T extends { readonly id: string }>(existing: readonly T[], ref: T): readonly T[] {
  return existing.some((item) => item.id === ref.id) ? existing : [...existing, ref];
}

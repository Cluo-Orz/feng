import { randomUUID } from "node:crypto";
import { makeTargetWorldId, ok, type Result } from "../domain/index.js";
import type { RuntimeContractRecord } from "../runtime-contract-registry/index.js";
import {
  makeTargetActionReceiptId,
  makeTargetActionRequestId,
  makeTargetDebugSignalId,
  makeTargetFailureMappingId,
  makeTargetValidationReportId,
  makeTargetWorldAdapterId,
  makeTargetWorldCompatibilityReportId,
  makeWorldInputId,
  makeWorldOutputId
} from "./brand.js";
import { targetErr } from "./errors.js";
import {
  compatibilityReportRef,
  targetActionReceiptRef,
  targetActionRequestRef,
  targetDebugSignalRef,
  targetFailureMappingRef,
  targetValidationReportRef,
  targetWorldAdapterRef,
  targetWorldRef,
  worldInputEnvelopeRef,
  worldOutputEnvelopeRef
} from "./refs.js";
import type {
  AdapterQuery,
  TargetActionReceiptRef,
  TargetActionRequestRef,
  TargetDebugSignalRef,
  TargetFailureMappingRef,
  TargetValidationReportRef,
  TargetWorldAdapterDefinition,
  TargetWorldAdapterInput,
  TargetWorldAdapterRef,
  TargetWorldCompatibilityReportRef,
  TargetWorldDescriptorInput,
  TargetWorldPage,
  WorldInputEnvelopeRef,
  WorldInputKind,
  WorldOutputEnvelopeRef,
  WorldOutputKind
} from "./types.js";

export const newTargetWorldRef = () => targetWorldRef(makeTargetWorldId(`target-world-${randomUUID()}`));
export const newAdapterRef = (): TargetWorldAdapterRef => targetWorldAdapterRef(makeTargetWorldAdapterId(`target-adapter-${randomUUID()}`));
export const newCompatibilityReportRef = (): TargetWorldCompatibilityReportRef =>
  compatibilityReportRef(makeTargetWorldCompatibilityReportId(`target-compatibility-${randomUUID()}`));
export const newWorldInputRef = (): WorldInputEnvelopeRef => worldInputEnvelopeRef(makeWorldInputId(`world-input-${randomUUID()}`));
export const newWorldOutputRef = (): WorldOutputEnvelopeRef => worldOutputEnvelopeRef(makeWorldOutputId(`world-output-${randomUUID()}`));
export const newActionRequestRef = (): TargetActionRequestRef =>
  targetActionRequestRef(makeTargetActionRequestId(`target-action-${randomUUID()}`));
export const newActionReceiptRef = (): TargetActionReceiptRef =>
  targetActionReceiptRef(makeTargetActionReceiptId(`target-action-receipt-${randomUUID()}`));
export const newValidationReportRef = (): TargetValidationReportRef =>
  targetValidationReportRef(makeTargetValidationReportId(`target-validation-${randomUUID()}`));
export const newFailureMappingRef = (): TargetFailureMappingRef =>
  targetFailureMappingRef(makeTargetFailureMappingId(`target-failure-${randomUUID()}`));
export const newDebugSignalRef = (): TargetDebugSignalRef =>
  targetDebugSignalRef(makeTargetDebugSignalId(`target-debug-${randomUUID()}`));

export function validateTargetWorldInput(input: TargetWorldDescriptorInput): Result<void> {
  if (input.name.trim().length === 0) return targetErr({ code: "invalid_input", message: "target world name is required" });
  if (input.description.trim().length === 0) return targetErr({ code: "invalid_input", message: "target world description is required" });
  if (input.inputKinds.length === 0) return targetErr({ code: "invalid_input", message: "target world requires inputKinds" });
  if (input.outputKinds.length === 0) return targetErr({ code: "invalid_input", message: "target world requires outputKinds" });
  return ok(undefined);
}

export function validateAdapterInput(input: TargetWorldAdapterInput): Result<void> {
  if (input.name.trim().length === 0) return targetErr({ code: "invalid_input", message: "adapter name is required" });
  if (input.supportedRuntimeKernelTypes.length === 0) return targetErr({ code: "invalid_input", message: "adapter requires runtime kernel support" });
  if (input.supportedInputKinds.length === 0) return targetErr({ code: "invalid_input", message: "adapter requires input support" });
  if (input.supportedOutputKinds.length === 0) return targetErr({ code: "invalid_input", message: "adapter requires output support" });
  return ok(undefined);
}

export function activeAdapterMatches(record: TargetWorldAdapterDefinition, query: AdapterQuery): boolean {
  return (query.targetWorldRef === undefined || record.targetWorldRef.id === query.targetWorldRef.id)
    && (query.lifecycle === undefined || record.lifecycle === query.lifecycle)
    && (query.kernelType === undefined || record.supportedRuntimeKernelTypes.includes(query.kernelType));
}

export function pageRecords<T>(records: readonly T[], limit?: number, cursor?: string): TargetWorldPage<T> {
  const start = cursor === undefined ? 0 : Number.parseInt(cursor, 10);
  const size = Math.max(1, limit ?? (records.length || 1));
  const page = records.slice(start, start + size);
  return {
    records: page,
    total: records.length,
    ...(start + size >= records.length ? {} : { nextCursor: String(start + size) }),
    truncated: start + size < records.length
  };
}

export function contractInputKinds(contract: RuntimeContractRecord): readonly WorldInputKind[] {
  return (contract.shape.input?.inputModes ?? []).filter((item): item is WorldInputKind & typeof item => isWorldInputKind(item));
}

export function contractOutputKinds(contract: RuntimeContractRecord): readonly WorldOutputKind[] {
  const modes = [...(contract.shape.output?.outputModes ?? []), ...(contract.shape.event?.outputModes ?? [])];
  return modes.filter((item): item is WorldOutputKind & typeof item => isWorldOutputKind(item));
}

export function contractAllowedActions(contract: RuntimeContractRecord): readonly string[] {
  return contract.shape.actionBoundary?.allowedActionKinds ?? [];
}

export function contractForbiddenActions(contract: RuntimeContractRecord): readonly string[] {
  return contract.shape.actionBoundary?.forbiddenActionKinds ?? [];
}

export function intersects(a: readonly string[], b: readonly string[]): readonly string[] {
  const bSet = new Set(b);
  return [...new Set(a.filter((item) => bSet.has(item)))];
}

export function isWorldInputKind(value: string): value is WorldInputKind {
  return ["state_snapshot", "tick_state", "dialogue_turn", "file_material", "event", "sensor_frame", "batch_job", "manual_trigger"].includes(value);
}

export function isWorldOutputKind(value: string): value is WorldOutputKind {
  return [
    "structured_result", "text_result", "action_event", "decision_event", "control_command",
    "file_artifact", "patch_candidate", "chapter_output", "music_fragment", "debug_event", "feedback_candidate"
  ].includes(value);
}

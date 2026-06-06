import { makeRef, type TargetWorldRef } from "../domain/index.js";
import type {
  TargetActionReceiptId,
  TargetActionRequestId,
  TargetDebugSignalId,
  TargetFailureMappingId,
  TargetValidationReportId,
  TargetWorldAdapterId,
  TargetWorldCompatibilityReportId,
  WorldInputId,
  WorldOutputId
} from "./brand.js";
import type {
  TargetActionReceiptRef,
  TargetActionRequestRef,
  TargetDebugSignalRef,
  TargetFailureMappingRef,
  TargetValidationReportRef,
  TargetWorldAdapterRef,
  TargetWorldCompatibilityReportRef,
  WorldInputEnvelopeRef,
  WorldOutputEnvelopeRef
} from "./types.js";

export function targetWorldRef(id: TargetWorldRef["id"]): TargetWorldRef {
  return makeRef("target_world", id, { uri: `target-world://${id}` });
}

export function targetWorldAdapterRef(id: TargetWorldAdapterId): TargetWorldAdapterRef {
  return { kind: "target_world_adapter", id, uri: `target-world-adapter://${id}` };
}

export function compatibilityReportRef(id: TargetWorldCompatibilityReportId): TargetWorldCompatibilityReportRef {
  return { kind: "target_world_compatibility_report", id, uri: `target-world-compatibility://${id}` };
}

export function worldInputEnvelopeRef(id: WorldInputId): WorldInputEnvelopeRef {
  return { kind: "world_input", id, uri: `world-input://${id}` };
}

export function worldOutputEnvelopeRef(id: WorldOutputId): WorldOutputEnvelopeRef {
  return { kind: "world_output", id, uri: `world-output://${id}` };
}

export function targetActionRequestRef(id: TargetActionRequestId): TargetActionRequestRef {
  return { kind: "target_action_request", id, uri: `target-action-request://${id}` };
}

export function targetActionReceiptRef(id: TargetActionReceiptId): TargetActionReceiptRef {
  return { kind: "target_action_receipt", id, uri: `target-action-receipt://${id}` };
}

export function targetValidationReportRef(id: TargetValidationReportId): TargetValidationReportRef {
  return { kind: "target_validation_report", id, uri: `target-validation-report://${id}` };
}

export function targetFailureMappingRef(id: TargetFailureMappingId): TargetFailureMappingRef {
  return { kind: "target_failure_mapping", id, uri: `target-failure-mapping://${id}` };
}

export function targetDebugSignalRef(id: TargetDebugSignalId): TargetDebugSignalRef {
  return { kind: "target_debug_signal", id, uri: `target-debug-signal://${id}` };
}

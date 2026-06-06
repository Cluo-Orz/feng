import { createTargetWorldRuntime, type TargetWorldRuntime } from "./runtime.js";
import {
  changeAdapterLifecycleRecord,
  getTargetWorldRecord,
  listAdapterRecords,
  registerAdapterRecord,
  registerTargetWorldRecord
} from "./descriptor-flow.js";
import {
  checkRuntimeContractCompatibilityRecord,
  explainCompatibilityRecord
} from "./compatibility-flow.js";
import {
  normalizeRuntimeOutputRecord,
  normalizeWorldInputRecord,
  validateWorldOutputRecord
} from "./envelope-flow.js";
import {
  cancelTargetActionRecord,
  dispatchTargetActionRecord,
  prepareTargetActionRecord
} from "./action-flow.js";
import {
  mapTargetFailureRecord,
  recordTargetDebugSignalRecord,
  runTargetValidationRecord
} from "./validation-debug-flow.js";
import type {
  AdapterLifecycle,
  AdapterQuery,
  TargetActionInput,
  TargetActionRequestRef,
  TargetDebugSignalInput,
  TargetFailureMappingInput,
  TargetValidationInput,
  TargetWorldAdapter,
  TargetWorldAdapterInput,
  TargetWorldAdapterOptions,
  TargetWorldAdapterRef,
  TargetWorldDescriptorInput,
  WorldInputEnvelopeRef,
  TargetWorldCompatibilityReportRef,
  WorldInputEnvelopeInput,
  WorldOutputEnvelopeInput,
  WorldOutputEnvelopeRef
} from "./types.js";
import type { RuntimeContractRef, TargetWorldRef } from "../domain/index.js";

export function createTargetWorldAdapter(options: TargetWorldAdapterOptions): TargetWorldAdapter {
  return new NodeTargetWorldAdapter(createTargetWorldRuntime(options));
}

class NodeTargetWorldAdapter implements TargetWorldAdapter {
  constructor(private readonly runtime: TargetWorldRuntime) {}

  registerTargetWorld(input: TargetWorldDescriptorInput) {
    return registerTargetWorldRecord(this.runtime, input);
  }

  getTargetWorld(ref: TargetWorldRef) {
    return getTargetWorldRecord(this.runtime, ref);
  }

  registerAdapter(input: TargetWorldAdapterInput) {
    return registerAdapterRecord(this.runtime, input);
  }

  listAdapters(query?: AdapterQuery) {
    return listAdapterRecords(this.runtime, query);
  }

  changeAdapterLifecycle(ref: TargetWorldAdapterRef, lifecycle: AdapterLifecycle, reason: string) {
    return changeAdapterLifecycleRecord(this.runtime, ref, lifecycle, reason);
  }

  checkRuntimeContractCompatibility(runtimeContractRef: RuntimeContractRef, targetWorldRef: TargetWorldRef) {
    return checkRuntimeContractCompatibilityRecord(this.runtime, runtimeContractRef, targetWorldRef);
  }

  explainCompatibility(ref: TargetWorldCompatibilityReportRef) {
    return explainCompatibilityRecord(this.runtime, ref);
  }

  normalizeWorldInput(input: WorldInputEnvelopeInput) {
    return normalizeWorldInputRecord(this.runtime, input);
  }

  getWorldInput(ref: WorldInputEnvelopeRef) {
    return this.runtime.storage.readWorldInput(ref);
  }

  normalizeRuntimeOutput(input: WorldOutputEnvelopeInput) {
    return normalizeRuntimeOutputRecord(this.runtime, input);
  }

  getWorldOutput(ref: WorldOutputEnvelopeRef) {
    return this.runtime.storage.readWorldOutput(ref);
  }

  validateWorldOutput(ref: WorldOutputEnvelopeRef) {
    return validateWorldOutputRecord(this.runtime, ref);
  }

  prepareTargetAction(outputEnvelopeRef: WorldOutputEnvelopeRef, input: TargetActionInput) {
    return prepareTargetActionRecord(this.runtime, outputEnvelopeRef, input);
  }

  getTargetAction(ref: TargetActionRequestRef) {
    return this.runtime.storage.readAction(ref);
  }

  dispatchTargetAction(ref: TargetActionRequestRef, reason: string) {
    return dispatchTargetActionRecord(this.runtime, ref, reason);
  }

  cancelTargetAction(ref: TargetActionRequestRef, reason: string) {
    return cancelTargetActionRecord(this.runtime, ref, reason);
  }

  runTargetValidation(input: TargetValidationInput) {
    return runTargetValidationRecord(this.runtime, input);
  }

  recordTargetDebugSignal(input: TargetDebugSignalInput) {
    return recordTargetDebugSignalRecord(this.runtime, input);
  }

  mapTargetFailure(input: TargetFailureMappingInput) {
    return mapTargetFailureRecord(this.runtime, input);
  }
}

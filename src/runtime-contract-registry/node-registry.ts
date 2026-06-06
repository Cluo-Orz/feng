import type { RuntimeContractRef } from "../domain/index.js";
import {
  addRuntimeContractVersionRecord,
  compareRuntimeContractVersionRecords,
  deprecateRuntimeContractRecord,
  getRuntimeContractRecord,
  listRuntimeContractRecords,
  materializeRuntimeContractRecord,
  recordContractCandidate,
  registerRuntimeContract,
  retractRuntimeContractRecord
} from "./registry-flow.js";
import { createRuntimeContractRuntime, type RuntimeContractRuntime } from "./runtime.js";
import {
  buildRuntimeContractSummaryRecord,
  explainCompatibilityRecord,
  explainRuntimeContractRecord
} from "./summary-flow.js";
import {
  lockRuntimeContractForHatchRecord,
  validateRuntimeContractRecord,
  verifyRuntimeContractForHatchRecord
} from "./verification-flow.js";
import type {
  RuntimeContractInput,
  RuntimeContractQuery,
  RuntimeContractRegistry,
  RuntimeContractRegistryOptions
} from "./types.js";

export function createRuntimeContractRegistry(options: RuntimeContractRegistryOptions): RuntimeContractRegistry {
  return new NodeRuntimeContractRegistry(createRuntimeContractRuntime(options));
}

class NodeRuntimeContractRegistry implements RuntimeContractRegistry {
  constructor(private readonly runtime: RuntimeContractRuntime) {}

  recordContractCandidate(input: RuntimeContractInput) {
    return recordContractCandidate(this.runtime, input);
  }

  registerRuntimeContract(input: RuntimeContractInput) {
    return registerRuntimeContract(this.runtime, input);
  }

  getRuntimeContract(ref: RuntimeContractRef) {
    return getRuntimeContractRecord(this.runtime, ref);
  }

  listRuntimeContracts(query?: RuntimeContractQuery) {
    return listRuntimeContractRecords(this.runtime, query);
  }

  materializeRuntimeContract(ref: RuntimeContractRef) {
    return materializeRuntimeContractRecord(this.runtime, ref);
  }

  addRuntimeContractVersion(ref: RuntimeContractRef, input: RuntimeContractInput) {
    return addRuntimeContractVersionRecord(this.runtime, ref, input);
  }

  compareRuntimeContractVersions(a: RuntimeContractRef, b: RuntimeContractRef) {
    return compareRuntimeContractVersionRecords(this.runtime, a, b);
  }

  deprecateRuntimeContract(ref: RuntimeContractRef, reason: string) {
    return deprecateRuntimeContractRecord(this.runtime, ref, reason);
  }

  retractRuntimeContract(ref: RuntimeContractRef, reason: string) {
    return retractRuntimeContractRecord(this.runtime, ref, reason);
  }

  validateRuntimeContract(ref: RuntimeContractRef) {
    return validateRuntimeContractRecord(this.runtime, ref);
  }

  verifyRuntimeContractForHatch(ref: RuntimeContractRef, readiness: Parameters<RuntimeContractRegistry["verifyRuntimeContractForHatch"]>[1]) {
    return verifyRuntimeContractForHatchRecord(this.runtime, ref, readiness);
  }

  lockRuntimeContractForHatch(ref: RuntimeContractRef, input: Parameters<RuntimeContractRegistry["lockRuntimeContractForHatch"]>[1]) {
    return lockRuntimeContractForHatchRecord(this.runtime, ref, input);
  }

  buildRuntimeContractSummary(ref: RuntimeContractRef) {
    return buildRuntimeContractSummaryRecord(this.runtime, ref);
  }

  explainRuntimeContract(ref: RuntimeContractRef) {
    return explainRuntimeContractRecord(this.runtime, ref);
  }

  explainCompatibility(ref: RuntimeContractRef, targetVersion: string) {
    return explainCompatibilityRecord(this.runtime, ref, targetVersion);
  }
}

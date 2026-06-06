import type { GrowUnitRef, HatchPackageRef } from "../domain/index.js";
import type { HatchRequestRef } from "./types.js";
import { buildHatchPackageRecord, publishLocalHatchPackageRecord, retractHatchPackageRecord, supersedeHatchPackageRecord, verifyHatchPackageRecord } from "./package-flow.js";
import { buildHatchPlanRecord, requestHatchRecord } from "./plan-flow.js";
import {
  explainHatchPackageRecord,
  explainResourceExclusionRecord,
  explainResourceInclusionRecord,
  getHatchPackageRecord,
  listHatchPackageRecords
} from "./query-flow.js";
import { createHatchRuntime, type HatchRuntime } from "./runtime.js";
import { selectHatchResourcesForInput } from "./resource-selection.js";
import type {
  HatchBuildPlanRef,
  HatchBuilder,
  HatchBuilderOptions,
  HatchExclusionRef,
  HatchPackageQuery,
  HatchRequestInput,
  HatchResourceRef
} from "./types.js";

export function createHatchBuilder(options: HatchBuilderOptions): HatchBuilder {
  return new NodeHatchBuilder(createHatchRuntime(options));
}

class NodeHatchBuilder implements HatchBuilder {
  constructor(private readonly runtime: HatchRuntime) {}

  requestHatch(input: HatchRequestInput) {
    return requestHatchRecord(this.runtime, input);
  }

  buildHatchPlan(ref: HatchRequestRef, policyContext?: HatchRequestInput["policyContext"]) {
    return buildHatchPlanRecord(this.runtime, ref, policyContext);
  }

  buildHatchPackage(ref: HatchBuildPlanRef) {
    return buildHatchPackageRecord(this.runtime, ref);
  }

  verifyHatchPackage(ref: HatchPackageRef) {
    return verifyHatchPackageRecord(this.runtime, ref);
  }

  publishLocalHatchPackage(ref: HatchPackageRef, input: Parameters<HatchBuilder["publishLocalHatchPackage"]>[1]) {
    return publishLocalHatchPackageRecord(this.runtime, ref, input);
  }

  getHatchPackage(ref: HatchPackageRef) {
    return getHatchPackageRecord(this.runtime, ref);
  }

  listHatchPackages(growUnitRef: GrowUnitRef, query?: HatchPackageQuery) {
    return listHatchPackageRecords(this.runtime, growUnitRef, query);
  }

  retractHatchPackage(ref: HatchPackageRef, reason: string) {
    return retractHatchPackageRecord(this.runtime, ref, reason);
  }

  supersedeHatchPackage(oldRef: HatchPackageRef, newRef: HatchPackageRef, reason: string) {
    return supersedeHatchPackageRecord(this.runtime, oldRef, newRef, reason);
  }

  explainHatchPackage(ref: HatchPackageRef) {
    return explainHatchPackageRecord(this.runtime, ref);
  }

  selectHatchResources(input: HatchRequestInput, policyContext?: HatchRequestInput["policyContext"]) {
    return selectHatchResourcesForInput(this.runtime, input, policyContext);
  }

  explainResourceInclusion(ref: HatchResourceRef) {
    return explainResourceInclusionRecord(this.runtime, ref);
  }

  explainResourceExclusion(ref: HatchExclusionRef) {
    return explainResourceExclusionRecord(this.runtime, ref);
  }
}

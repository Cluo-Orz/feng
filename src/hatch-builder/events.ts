import { makeLedgerStreamId, type LedgerStream } from "../event-ledger/index.js";
import type { GrowUnitRef, HatchPackageRef } from "../domain/index.js";

export const hatchEventTypes = {
  requested: "hatch_requested",
  buildPlanCreated: "hatch_build_plan_created",
  resourceIncluded: "hatch_resource_included",
  resourceExcluded: "hatch_resource_excluded",
  policyChecked: "hatch_policy_checked",
  contractVerified: "hatch_contract_verified",
  buildStarted: "hatch_package_build_started",
  built: "hatch_package_built",
  verified: "hatch_package_verified",
  publishedLocal: "hatch_package_published_local",
  failed: "hatch_package_failed",
  retracted: "hatch_package_retracted",
  superseded: "hatch_package_superseded"
} as const;

export function hatchGrowStream(growUnitRef: GrowUnitRef): LedgerStream {
  return { streamType: "hatch_package", streamId: makeLedgerStreamId(`grow-${growUnitRef.id}`) };
}

export function hatchPackageStream(hatchPackageRef: HatchPackageRef): LedgerStream {
  return { streamType: "hatch_package", streamId: makeLedgerStreamId(hatchPackageRef.id) };
}

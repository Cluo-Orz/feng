import { makeLedgerStreamId, type LedgerStream } from "../event-ledger/index.js";
import type { GrowUnitRef } from "../domain/index.js";

export const runtimeContractEventTypes = {
  candidateRecorded: "runtime_contract_candidate_recorded",
  registered: "runtime_contract_registered",
  versionAdded: "runtime_contract_version_added",
  validated: "runtime_contract_validated",
  verificationFailed: "runtime_contract_verification_failed",
  lockedForHatch: "runtime_contract_locked_for_hatch",
  linkedToHatchPackage: "runtime_contract_linked_to_hatch_package",
  deprecated: "runtime_contract_deprecated",
  retracted: "runtime_contract_retracted",
  superseded: "runtime_contract_superseded",
  incompatible: "runtime_contract_incompatible"
} as const;

export function runtimeContractGrowStream(growUnitRef: GrowUnitRef): LedgerStream {
  return { streamType: "grow_unit", streamId: makeLedgerStreamId(growUnitRef.id) };
}

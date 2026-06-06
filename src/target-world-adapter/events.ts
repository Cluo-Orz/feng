import { makeLedgerStreamId, type LedgerStream } from "../event-ledger/index.js";
import type { TargetWorldRef } from "../domain/index.js";

export const targetWorldEventTypes = {
  targetWorldRegistered: "target_world_registered",
  adapterRegistered: "target_world_adapter_registered",
  adapterLifecycleChanged: "target_world_adapter_lifecycle_changed",
  compatibilityChecked: "target_world_contract_compatibility_checked",
  inputNormalized: "world_input_normalized",
  outputNormalized: "world_output_normalized",
  actionPrepared: "target_action_prepared",
  actionPolicyChecked: "target_action_policy_checked",
  actionDispatched: "target_action_dispatched",
  actionCancelled: "target_action_cancelled",
  validationReported: "target_validation_reported",
  failureMapped: "target_failure_mapped",
  debugSignalRecorded: "target_debug_signal_recorded"
} as const;

export function targetWorldStream(ref: TargetWorldRef): LedgerStream {
  return { streamType: "target_world", streamId: makeLedgerStreamId(ref.id) };
}

export function workspaceTargetWorldStream(workspaceId: string): LedgerStream {
  return { streamType: "target_world", streamId: makeLedgerStreamId(`workspace-${workspaceId}`) };
}

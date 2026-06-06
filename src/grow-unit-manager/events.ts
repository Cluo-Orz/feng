import type { GrowUnitRef } from "../domain/index.js";
import { makeLedgerStreamId, type LedgerStream } from "../event-ledger/index.js";

export const growUnitEventTypes = {
  created: "grow_unit_created",
  goalBoundaryUpdated: "grow_unit_goal_boundary_updated",
  targetWorldLinked: "grow_unit_target_world_linked",
  lifecycleChanged: "grow_unit_lifecycle_changed",
  blocked: "grow_unit_blocked",
  unblocked: "grow_unit_unblocked",
  archived: "grow_unit_archived",
  admissionStateLinked: "grow_unit_admission_state_linked",
  agendaStateLinked: "grow_unit_agenda_state_linked",
  attemptLinked: "grow_unit_attempt_linked",
  messageListLinked: "grow_unit_message_list_linked",
  readinessVerdictApplied: "grow_unit_readiness_verdict_applied",
  hatchPackageLinked: "grow_unit_hatch_package_linked",
  superseded: "grow_unit_superseded"
} as const;

export function growUnitStream(growUnitRef: GrowUnitRef): LedgerStream {
  return { streamType: "grow_unit", streamId: makeLedgerStreamId(growUnitRef.id) };
}

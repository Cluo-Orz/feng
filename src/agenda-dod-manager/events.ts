import type { GrowUnitRef } from "../domain/index.js";
import { makeLedgerStreamId, type LedgerStream } from "../event-ledger/index.js";

export const agendaEventTypes = {
  agendaCreated: "agenda_created",
  agendaItemProposed: "agenda_item_proposed",
  agendaItemActivated: "agenda_item_activated",
  agendaItemUpdated: "agenda_item_updated",
  agendaItemBlocked: "agenda_item_blocked",
  agendaItemRetired: "agenda_item_retired",
  gapRecorded: "gap_recorded",
  gapUpdated: "gap_updated",
  gapResolvedForNow: "gap_resolved_for_now",
  dodDefined: "dod_defined",
  dodRevised: "dod_revised",
  dodRetired: "dod_retired",
  dodEvaluationLinked: "dod_evaluation_linked",
  attemptIntentCreated: "attempt_intent_created",
  agendaSummaryUpdated: "agenda_summary_updated",
  agendaDecisionSuperseded: "agenda_decision_superseded"
} as const;

export function agendaGrowStream(growUnitRef: GrowUnitRef): LedgerStream {
  return { streamType: "grow_unit", streamId: makeLedgerStreamId(growUnitRef.id) };
}

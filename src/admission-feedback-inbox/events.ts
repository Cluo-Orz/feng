import { makeLedgerStreamId, type LedgerStream } from "../event-ledger/index.js";
import type { FeedbackUnitRef, GrowUnitRef } from "../domain/index.js";

export const admissionEventTypes = {
  inboxItemReceived: "inbox_item_received",
  inboxItemNormalized: "inbox_item_normalized",
  inboxItemClassified: "inbox_item_classified",
  inboxItemAdmitted: "inbox_item_admitted",
  inboxItemRejected: "inbox_item_rejected",
  inboxItemQuarantined: "inbox_item_quarantined",
  inboxItemRedacted: "inbox_item_redacted",
  inboxItemWaitingPolicy: "inbox_item_waiting_policy",
  inboxItemWaitingEvidence: "inbox_item_waiting_evidence",
  inboxItemWaitingHuman: "inbox_item_waiting_human",
  inboxItemLocalOnly: "inbox_item_local_only",
  feedbackUnitCreated: "feedback_unit_created",
  feedbackStatusChanged: "feedback_status_changed",
  feedbackEvidenceLinked: "feedback_evidence_linked",
  feedbackRedacted: "feedback_redacted",
  feedbackUpstreamProposed: "feedback_upstream_proposed",
  feedbackUpstreamResultRecorded: "feedback_upstream_result_recorded",
  admissionDecisionSuperseded: "admission_decision_superseded"
} as const;

export function admissionGrowStream(growUnitRef: GrowUnitRef): LedgerStream {
  return { streamType: "grow_unit", streamId: makeLedgerStreamId(growUnitRef.id) };
}

export function feedbackStream(feedbackUnitRef: FeedbackUnitRef): LedgerStream {
  return { streamType: "feedback_unit", streamId: makeLedgerStreamId(feedbackUnitRef.id) };
}

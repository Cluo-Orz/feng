import { makeLedgerStreamId, type LedgerStream } from "../event-ledger/index.js";
import type { DebugCorrelationId } from "./brand.js";

export const debugBridgeEventTypes = {
  correlationOpened: "debug_correlation_opened",
  correlationLinkedRuntime: "debug_correlation_linked_runtime",
  correlationLinkedTrace: "debug_correlation_linked_trace",
  correlationLinkedSignal: "debug_correlation_linked_signal",
  runtimeReportEnvelopeCreated: "runtime_report_envelope_created",
  feedbackAttributionRecorded: "feedback_attribution_recorded",
  privacyFilterApplied: "privacy_filter_applied",
  feedbackBridgePacketBuilt: "feedback_bridge_packet_built",
  feedbackCandidateSubmitted: "feedback_candidate_submitted",
  upstreamProposalRequested: "upstream_proposal_requested",
  upstreamBridgeResultRecorded: "upstream_bridge_result_recorded",
  correlationClosed: "debug_correlation_closed",
  bridgeDecisionSuperseded: "bridge_decision_superseded"
} as const;

export function debugBridgeStream(id: DebugCorrelationId): LedgerStream {
  return { streamType: "debug_bridge", streamId: makeLedgerStreamId(id) };
}

import type {
  DebugCorrelationId,
  FeedbackAttributionId,
  FeedbackBridgePacketId,
  PrivacyFilterResultId,
  RuntimeReportEnvelopeId,
  UpstreamProposalRequestId
} from "./brand.js";
import type {
  DebugCorrelationRef,
  FeedbackAttributionRef,
  FeedbackBridgePacketRef,
  PrivacyFilterResultRef,
  RuntimeReportEnvelopeRef,
  UpstreamProposalRequestRef
} from "./types.js";

export function debugCorrelationRef(id: DebugCorrelationId): DebugCorrelationRef {
  return { kind: "debug_correlation", id, uri: `debug-correlation://${id}` };
}
export function runtimeReportEnvelopeRef(id: RuntimeReportEnvelopeId): RuntimeReportEnvelopeRef {
  return { kind: "runtime_report_envelope", id, uri: `runtime-report-envelope://${id}` };
}
export function feedbackAttributionRef(id: FeedbackAttributionId): FeedbackAttributionRef {
  return { kind: "feedback_attribution", id, uri: `feedback-attribution://${id}` };
}
export function privacyFilterResultRef(id: PrivacyFilterResultId): PrivacyFilterResultRef {
  return { kind: "privacy_filter_result", id, uri: `privacy-filter-result://${id}` };
}
export function feedbackBridgePacketRef(id: FeedbackBridgePacketId): FeedbackBridgePacketRef {
  return { kind: "feedback_bridge_packet", id, uri: `feedback-bridge-packet://${id}` };
}
export function upstreamProposalRequestRef(id: UpstreamProposalRequestId): UpstreamProposalRequestRef {
  return { kind: "upstream_proposal_request", id, uri: `upstream-proposal-request://${id}` };
}

import type {
  DebugCorrelationId,
  FeedbackAttributionId,
  FeedbackBridgePacketId,
  PrivacyFilterResultId,
  RuntimeReportEnvelopeId,
  UpstreamProposalRequestId
} from "./brand.js";

const root = ".feng/debug-feedback-bridge";

const enc = (value: string): string => encodeURIComponent(value).replaceAll("%", "~");

export const correlationIndexPath = `${root}/correlations/index.json`;
export const envelopeIndexPath = `${root}/envelopes/index.json`;
export const attributionIndexPath = `${root}/attributions/index.json`;
export const privacyIndexPath = `${root}/privacy/index.json`;
export const packetIndexPath = `${root}/packets/index.json`;
export const proposalRequestIndexPath = `${root}/proposal-requests/index.json`;

export const correlationPath = (id: DebugCorrelationId): string => `${root}/correlations/${enc(id)}.json`;
export const envelopePath = (id: RuntimeReportEnvelopeId): string => `${root}/envelopes/${enc(id)}.json`;
export const attributionPath = (id: FeedbackAttributionId): string => `${root}/attributions/${enc(id)}.json`;
export const privacyPath = (id: PrivacyFilterResultId): string => `${root}/privacy/${enc(id)}.json`;
export const packetPath = (id: FeedbackBridgePacketId): string => `${root}/packets/${enc(id)}.json`;
export const proposalRequestPath = (id: UpstreamProposalRequestId): string =>
  `${root}/proposal-requests/${enc(id)}.json`;

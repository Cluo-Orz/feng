import { makeNonEmptyBrand, type BrandedString } from "../domain/brand.js";

export type DebugCorrelationId = BrandedString<"DebugCorrelationId">;
export type RuntimeReportEnvelopeId = BrandedString<"RuntimeReportEnvelopeId">;
export type FeedbackAttributionId = BrandedString<"FeedbackAttributionId">;
export type PrivacyFilterResultId = BrandedString<"PrivacyFilterResultId">;
export type FeedbackBridgePacketId = BrandedString<"FeedbackBridgePacketId">;
export type UpstreamProposalRequestId = BrandedString<"UpstreamProposalRequestId">;

export const makeDebugCorrelationId = (value: string): DebugCorrelationId =>
  makeNonEmptyBrand("DebugCorrelationId", value);
export const makeRuntimeReportEnvelopeId = (value: string): RuntimeReportEnvelopeId =>
  makeNonEmptyBrand("RuntimeReportEnvelopeId", value);
export const makeFeedbackAttributionId = (value: string): FeedbackAttributionId =>
  makeNonEmptyBrand("FeedbackAttributionId", value);
export const makePrivacyFilterResultId = (value: string): PrivacyFilterResultId =>
  makeNonEmptyBrand("PrivacyFilterResultId", value);
export const makeFeedbackBridgePacketId = (value: string): FeedbackBridgePacketId =>
  makeNonEmptyBrand("FeedbackBridgePacketId", value);
export const makeUpstreamProposalRequestId = (value: string): UpstreamProposalRequestId =>
  makeNonEmptyBrand("UpstreamProposalRequestId", value);

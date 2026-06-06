import { makeNonEmptyBrand, type BrandedString } from "../domain/brand.js";

export type RuntimeInvocationId = BrandedString<"RuntimeInvocationId">;
export type RuntimeTurnId = BrandedString<"RuntimeTurnId">;
export type RuntimeOutputId = BrandedString<"RuntimeOutputId">;
export type RuntimeTraceId = BrandedString<"RuntimeTraceId">;
export type RuntimeFeedbackCandidateHintId = BrandedString<"RuntimeFeedbackCandidateHintId">;
export type ShortTermContextId = BrandedString<"ShortTermContextId">;
export type LongTermMemoryReadId = BrandedString<"LongTermMemoryReadId">;

export const makeRuntimeInvocationId = (value: string): RuntimeInvocationId =>
  makeNonEmptyBrand("RuntimeInvocationId", value);
export const makeRuntimeTurnId = (value: string): RuntimeTurnId =>
  makeNonEmptyBrand("RuntimeTurnId", value);
export const makeRuntimeOutputId = (value: string): RuntimeOutputId =>
  makeNonEmptyBrand("RuntimeOutputId", value);
export const makeRuntimeTraceId = (value: string): RuntimeTraceId =>
  makeNonEmptyBrand("RuntimeTraceId", value);
export const makeRuntimeFeedbackCandidateHintId = (value: string): RuntimeFeedbackCandidateHintId =>
  makeNonEmptyBrand("RuntimeFeedbackCandidateHintId", value);
export const makeShortTermContextId = (value: string): ShortTermContextId =>
  makeNonEmptyBrand("ShortTermContextId", value);
export const makeLongTermMemoryReadId = (value: string): LongTermMemoryReadId =>
  makeNonEmptyBrand("LongTermMemoryReadId", value);

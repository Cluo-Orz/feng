import { makeNonEmptyBrand, type BrandedString } from "../domain/brand.js";

export type TargetWorldAdapterId = BrandedString<"TargetWorldAdapterId">;
export type TargetWorldCompatibilityReportId = BrandedString<"TargetWorldCompatibilityReportId">;
export type WorldInputId = BrandedString<"WorldInputId">;
export type WorldOutputId = BrandedString<"WorldOutputId">;
export type TargetActionRequestId = BrandedString<"TargetActionRequestId">;
export type TargetActionReceiptId = BrandedString<"TargetActionReceiptId">;
export type TargetValidationReportId = BrandedString<"TargetValidationReportId">;
export type TargetFailureMappingId = BrandedString<"TargetFailureMappingId">;
export type TargetDebugSignalId = BrandedString<"TargetDebugSignalId">;

export const makeTargetWorldAdapterId = (value: string): TargetWorldAdapterId =>
  makeNonEmptyBrand("TargetWorldAdapterId", value);
export const makeTargetWorldCompatibilityReportId = (value: string): TargetWorldCompatibilityReportId =>
  makeNonEmptyBrand("TargetWorldCompatibilityReportId", value);
export const makeWorldInputId = (value: string): WorldInputId => makeNonEmptyBrand("WorldInputId", value);
export const makeWorldOutputId = (value: string): WorldOutputId => makeNonEmptyBrand("WorldOutputId", value);
export const makeTargetActionRequestId = (value: string): TargetActionRequestId =>
  makeNonEmptyBrand("TargetActionRequestId", value);
export const makeTargetActionReceiptId = (value: string): TargetActionReceiptId =>
  makeNonEmptyBrand("TargetActionReceiptId", value);
export const makeTargetValidationReportId = (value: string): TargetValidationReportId =>
  makeNonEmptyBrand("TargetValidationReportId", value);
export const makeTargetFailureMappingId = (value: string): TargetFailureMappingId =>
  makeNonEmptyBrand("TargetFailureMappingId", value);
export const makeTargetDebugSignalId = (value: string): TargetDebugSignalId =>
  makeNonEmptyBrand("TargetDebugSignalId", value);

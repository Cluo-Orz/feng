import { makeNonEmptyBrand } from "../domain/brand.js";
import type {
  HatchBuildPlanId,
  HatchBuildReceiptId,
  HatchExclusionId,
  HatchRequestId,
  HatchResourceId,
  HatchVerificationId
} from "./types.js";

export const makeHatchRequestId = (value: string): HatchRequestId => makeNonEmptyBrand("HatchRequestId", value);
export const makeHatchBuildPlanId = (value: string): HatchBuildPlanId => makeNonEmptyBrand("HatchBuildPlanId", value);
export const makeHatchResourceId = (value: string): HatchResourceId => makeNonEmptyBrand("HatchResourceId", value);
export const makeHatchExclusionId = (value: string): HatchExclusionId => makeNonEmptyBrand("HatchExclusionId", value);
export const makeHatchBuildReceiptId = (value: string): HatchBuildReceiptId => makeNonEmptyBrand("HatchBuildReceiptId", value);
export const makeHatchVerificationId = (value: string): HatchVerificationId => makeNonEmptyBrand("HatchVerificationId", value);

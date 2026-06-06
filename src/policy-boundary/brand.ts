import { makeNonEmptyBrand } from "../domain/brand.js";
import type { ApprovalId, CapabilityGrantId, PolicyRequestId } from "./types.js";

export const makePolicyRequestId = (value: string): PolicyRequestId =>
  makeNonEmptyBrand("PolicyRequestId", value);

export const makeCapabilityGrantId = (value: string): CapabilityGrantId =>
  makeNonEmptyBrand("CapabilityGrantId", value);

export const makeApprovalId = (value: string): ApprovalId => makeNonEmptyBrand("ApprovalId", value);

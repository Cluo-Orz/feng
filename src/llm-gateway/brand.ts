import { makeNonEmptyBrand } from "../domain/brand.js";
import type { LLMRequestId, ProviderCallReceiptId } from "./types.js";

export const makeLLMRequestId = (value: string): LLMRequestId =>
  makeNonEmptyBrand("LLMRequestId", value);

export const makeProviderCallReceiptId = (value: string): ProviderCallReceiptId =>
  makeNonEmptyBrand("ProviderCallReceiptId", value);

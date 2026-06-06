import { makeNonEmptyBrand } from "../domain/brand.js";
import type { ContextCompilePlanId, MessageListInvalidationId } from "./types.js";

export const makeContextCompilePlanId = (value: string): ContextCompilePlanId =>
  makeNonEmptyBrand("ContextCompilePlanId", value);

export const makeMessageListInvalidationId = (value: string): MessageListInvalidationId =>
  makeNonEmptyBrand("MessageListInvalidationId", value);

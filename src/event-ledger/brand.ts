import { makeNonEmptyBrand } from "../domain/brand.js";
import type { IdempotencyKey, LedgerStreamId, ProjectionKey, ProjectionName } from "./types.js";

export const makeLedgerStreamId = (value: string): LedgerStreamId =>
  makeNonEmptyBrand("LedgerStreamId", value);

export const makeIdempotencyKey = (value: string): IdempotencyKey =>
  makeNonEmptyBrand("IdempotencyKey", value);

export const makeProjectionName = (value: string): ProjectionName =>
  makeNonEmptyBrand("ProjectionName", value);

export const makeProjectionKey = (value: string): ProjectionKey =>
  makeNonEmptyBrand("ProjectionKey", value);

import { makeNonEmptyBrand } from "../domain/brand.js";
import type { AgendaId, AgendaItemId, AttemptIntentId, DoDId, GapId } from "./types.js";

export const makeAgendaId = (value: string): AgendaId => makeNonEmptyBrand("AgendaId", value);
export const makeAgendaItemId = (value: string): AgendaItemId => makeNonEmptyBrand("AgendaItemId", value);
export const makeGapId = (value: string): GapId => makeNonEmptyBrand("GapId", value);
export const makeDoDId = (value: string): DoDId => makeNonEmptyBrand("DoDId", value);
export const makeAttemptIntentId = (value: string): AttemptIntentId =>
  makeNonEmptyBrand("AttemptIntentId", value);

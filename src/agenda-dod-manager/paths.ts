import type { AgendaId, AgendaItemId, AttemptIntentId, DoDId, GapId } from "./types.js";

const root = ".feng/agenda";

export const agendaIndexPath = `${root}/index.json`;
export const agendaItemIndexPath = `${root}/items/index.json`;
export const gapIndexPath = `${root}/gaps/index.json`;
export const dodIndexPath = `${root}/dod/index.json`;
export const attemptIntentIndexPath = `${root}/attempt-intents/index.json`;

export const agendaRecordPath = (id: AgendaId): string => `${root}/agendas/${id}.json`;
export const agendaItemRecordPath = (id: AgendaItemId): string => `${root}/items/${id}.json`;
export const gapRecordPath = (id: GapId): string => `${root}/gaps/${id}.json`;
export const dodRecordPath = (id: DoDId): string => `${root}/dod/${id}.json`;
export const attemptIntentRecordPath = (id: AttemptIntentId): string => `${root}/attempt-intents/${id}.json`;

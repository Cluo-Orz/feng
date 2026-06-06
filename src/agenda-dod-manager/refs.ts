import type {
  AgendaId,
  AgendaItemId,
  AgendaItemRef,
  AgendaRef,
  AttemptIntentId,
  AttemptIntentRef,
  DoDId,
  DoDRef,
  GapId,
  GapRef
} from "./types.js";

export const makeAgendaRef = (id: AgendaId): AgendaRef => ({ kind: "agenda", id, uri: `agenda://${id}` });
export const makeAgendaItemRef = (id: AgendaItemId): AgendaItemRef => ({ kind: "agenda_item", id, uri: `agenda-item://${id}` });
export const makeGapRef = (id: GapId): GapRef => ({ kind: "gap", id, uri: `gap://${id}` });
export const makeDoDRef = (id: DoDId): DoDRef => ({ kind: "dod", id, uri: `dod://${id}` });
export const makeAttemptIntentRef = (id: AttemptIntentId): AttemptIntentRef => ({
  kind: "attempt_intent",
  id,
  uri: `attempt-intent://${id}`
});

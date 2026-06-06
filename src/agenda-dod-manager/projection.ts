import { ok, type Result } from "../domain/result.js";
import type { EventEnvelope, EventPayloadSummary } from "../event-ledger/index.js";
import { agendaEventTypes } from "./events.js";
import { agendaErr } from "./errors.js";
import type { AgendaRecord } from "./types.js";

const agendaEventTypeSet = new Set<string>(Object.values(agendaEventTypes));

export function projectAgendaEvents(events: readonly EventEnvelope[]): Result<AgendaRecord> {
  let record: AgendaRecord | undefined;
  for (const event of events) {
    if (!agendaEventTypeSet.has(event.eventType)) continue;
    const payload = objectPayload(event.payload);
    if (payload === undefined) return invalid("agenda event payload is invalid");
    if (event.eventType === agendaEventTypes.agendaCreated) {
      const created = recordField(payload, "record");
      if (created === undefined) return invalid("agenda created event lacks record");
      record = created;
      continue;
    }
    const projected = recordField(payload, "agendaRecord");
    if (projected !== undefined) record = projected;
  }
  return record === undefined
    ? agendaErr({ code: "not_found", message: "agenda stream has no agenda events" })
    : ok(record);
}

function objectPayload(payload: EventPayloadSummary): Record<string, unknown> | undefined {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : undefined;
}

function recordField(payload: Record<string, unknown>, key: string): AgendaRecord | undefined {
  const record = payload[key];
  return isObject(record) && isObject(record.agendaRef) && record.agendaRef.kind === "agenda"
    ? record as unknown as AgendaRecord
    : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function invalid(message: string): Result<AgendaRecord> {
  return agendaErr({ code: "schema_incompatible", message });
}

import type { EventPayloadSummary } from "../event-ledger/index.js";

export function payload(value: Record<string, unknown>): EventPayloadSummary {
  return JSON.parse(JSON.stringify(value)) as EventPayloadSummary;
}

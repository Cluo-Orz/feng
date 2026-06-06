import type { EventPayloadSummary } from "../event-ledger/index.js";

export function payload(input: Record<string, unknown>): EventPayloadSummary {
  return JSON.parse(JSON.stringify(input)) as EventPayloadSummary;
}

export function refsPayload(input: Record<string, unknown>): EventPayloadSummary {
  return payload(input);
}

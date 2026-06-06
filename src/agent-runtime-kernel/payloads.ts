import type { EventPayloadSummary } from "../event-ledger/index.js";

export function payload(value: unknown): EventPayloadSummary {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => payload(item));
  if (typeof value === "object") {
    const out: Record<string, EventPayloadSummary> = {};
    for (const [key, item] of Object.entries(value)) out[key] = payload(item);
    return out;
  }
  return String(value);
}

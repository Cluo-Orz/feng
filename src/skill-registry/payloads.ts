import type { EventPayloadSummary } from "../event-ledger/index.js";

export function toSkillEventPayload(value: unknown): EventPayloadSummary {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => toSkillEventPayload(item));
  if (typeof value === "object") {
    const output: Record<string, EventPayloadSummary> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined && typeof item !== "function" && typeof item !== "symbol") {
        output[key] = toSkillEventPayload(item);
      }
    }
    return output;
  }
  return String(value);
}

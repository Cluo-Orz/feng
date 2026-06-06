import { createHash, randomUUID } from "node:crypto";
import { makeEventId } from "../domain/ids.js";
import type { EventId } from "../domain/ids.js";

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function payloadFingerprint(input: {
  readonly eventType: string;
  readonly eventVersion: string;
  readonly payload: unknown;
  readonly payloadRefUri?: string;
}): string {
  return sha256Text(stableStringify(input));
}

export function newEventId(): EventId {
  return makeEventId(`event-${randomUUID()}`);
}

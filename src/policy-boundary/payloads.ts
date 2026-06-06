import type { EventPayloadSummary } from "../event-ledger/index.js";
import type { ApprovalReceipt, CapabilityGrant, PolicyDecision } from "./types.js";

export function decisionPayload(decision: PolicyDecision): EventPayloadSummary {
  const { eventReceipt, ...payload } = decision;
  return toEventPayload(payload);
}

export function approvalPayload(receipt: ApprovalReceipt): EventPayloadSummary {
  const { eventReceipt, ...payload } = receipt;
  return toEventPayload(payload);
}

export function grantPayload(grant: CapabilityGrant): EventPayloadSummary {
  return toEventPayload(grant);
}

export function decisionFromPayload(payload: EventPayloadSummary): PolicyDecision | undefined {
  return isRecord(payload) && typeof payload.policyDecisionId === "string"
    ? (payload as unknown as PolicyDecision)
    : undefined;
}

export function grantFromPayload(payload: EventPayloadSummary): CapabilityGrant | undefined {
  return isRecord(payload) && typeof payload.grantId === "string"
    ? (payload as unknown as CapabilityGrant)
    : undefined;
}

export function toEventPayload(value: unknown): EventPayloadSummary {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => toEventPayload(item));
  if (typeof value === "object") {
    const output: Record<string, EventPayloadSummary> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined && typeof item !== "function" && typeof item !== "symbol") {
        output[key] = toEventPayload(item);
      }
    }
    return output;
  }
  return String(value);
}

function isRecord(value: EventPayloadSummary): value is { readonly [key: string]: EventPayloadSummary } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

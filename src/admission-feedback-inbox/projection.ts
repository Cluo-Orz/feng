import type { EventEnvelope } from "../event-ledger/index.js";
import { isFeedbackStatus, type ArtifactRef } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import { admissionEventTypes } from "./events.js";
import { admissionErr } from "./errors.js";
import { appendEvidence, feedbackWithStatus } from "./logic.js";
import type { FeedbackUnitRecord, UpstreamProposalRef } from "./types.js";

export function projectFeedbackEvents(events: readonly EventEnvelope[]): Result<FeedbackUnitRecord> {
  let record: FeedbackUnitRecord | undefined;
  for (const event of events) {
    if (event.eventType === admissionEventTypes.feedbackUnitCreated) {
      const created = recordPayload(event.payload);
      if (created === undefined) return invalid("feedback created event is missing record payload");
      record = created;
      continue;
    }
    if (record === undefined) continue;
    if (event.eventType === admissionEventTypes.feedbackEvidenceLinked) {
      record = appendEvidence(record, artifactRefs(event.payload, "evidenceRefs"));
      continue;
    }
    if (event.eventType === admissionEventTypes.feedbackStatusChanged ||
      event.eventType === admissionEventTypes.feedbackRedacted ||
      event.eventType === admissionEventTypes.feedbackUpstreamResultRecorded) {
      const to = stringField(event.payload, "to");
      if (to === undefined || !isFeedbackStatus(to)) return invalid("feedback status event has invalid target status");
      const policyDecisionId = stringField(event.payload, "policyDecisionId") as FeedbackUnitRecord["policyDecisionId"] | undefined;
      const proposalRef = upstreamProposalRef(event.payload);
      record = feedbackWithStatus(record, to, {
        ...(policyDecisionId === undefined ? {} : { policyDecisionId }),
        ...(proposalRef === undefined ? {} : { upstreamProposalRef: proposalRef })
      });
    }
  }
  return record === undefined
    ? admissionErr({ code: "not_found", message: "feedback stream does not contain a creation event" })
    : ok(record);
}

function recordPayload(payload: unknown): FeedbackUnitRecord | undefined {
  if (!isObject(payload)) return undefined;
  const record = payload.record;
  return isObject(record) && isObject(record.feedbackUnitRef) ? record as unknown as FeedbackUnitRecord : undefined;
}

function artifactRefs(payload: unknown, key: string): readonly ArtifactRef[] {
  if (!isObject(payload)) return [];
  const value = payload[key];
  return Array.isArray(value) ? value.filter((item): item is ArtifactRef => isObject(item) && item.kind === "artifact") : [];
}

function upstreamProposalRef(payload: unknown): UpstreamProposalRef | undefined {
  if (!isObject(payload)) return undefined;
  const value = payload.upstreamProposalRef;
  return isObject(value) && value.kind === "upstream_proposal" ? value as unknown as UpstreamProposalRef : undefined;
}

function stringField(payload: unknown, key: string): string | undefined {
  return isObject(payload) && typeof payload[key] === "string" ? payload[key] : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function invalid(message: string): Result<FeedbackUnitRecord> {
  return admissionErr({ code: "schema_incompatible", message });
}

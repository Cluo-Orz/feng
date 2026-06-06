import { randomUUID } from "node:crypto";
import { makeFeedbackUnitId, type ArtifactRef, type FeedbackStatus, type FeedbackUnitRef } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import { admissionErr } from "./errors.js";
import { makeInboxItemId, makeUpstreamProposalId } from "./brand.js";
import { makeFeedbackUnitRef, makeInboxItemRef, makeUpstreamProposalRef } from "./refs.js";
import type {
  AdmissionDecisionKind,
  FeedbackQuery,
  FeedbackUnitRecord,
  InboxItemRecord,
  InboxItemStatus,
  InboxQuery,
  ReceivePayloadInput,
  UpstreamProposalRef
} from "./types.js";

export function newInboxItemRef() {
  return makeInboxItemRef(makeInboxItemId(`inbox-${randomUUID()}`));
}

export function newFeedbackUnitRef(): FeedbackUnitRef {
  return makeFeedbackUnitRef(makeFeedbackUnitId(`feedback-${randomUUID()}`));
}

export function newUpstreamProposalRef() {
  return makeUpstreamProposalRef(makeUpstreamProposalId(`proposal-${randomUUID()}`));
}

export function validateReceive(input: ReceivePayloadInput): Result<void> {
  if (input.existingArtifactRef === undefined && input.content === undefined) {
    return admissionErr({ code: "invalid_input", message: "receive input requires content or existingArtifactRef" });
  }
  if (input.existingArtifactRef !== undefined && input.content !== undefined) {
    return admissionErr({ code: "invalid_input", message: "receive input cannot provide both content and existingArtifactRef" });
  }
  return ok(undefined);
}

export function decisionStatus(decision: AdmissionDecisionKind): InboxItemStatus {
  if (decision === "reject") return "rejected";
  if (decision === "quarantine") return "quarantined";
  if (decision === "wait_for_evidence") return "waiting_evidence";
  if (decision === "wait_for_human") return "waiting_human";
  if (decision === "redact_then_admit") return "redacted";
  if (decision === "propose_upstream") return "waiting_policy";
  return "admitted";
}

export function decisionEventType(decision: AdmissionDecisionKind): string {
  if (decision === "reject") return "inbox_item_rejected";
  if (decision === "quarantine") return "inbox_item_quarantined";
  if (decision === "redact_then_admit") return "inbox_item_redacted";
  if (decision === "propose_upstream") return "inbox_item_waiting_policy";
  if (decision === "wait_for_evidence") return "inbox_item_waiting_evidence";
  if (decision === "wait_for_human") return "inbox_item_waiting_human";
  if (decision === "local_only") return "inbox_item_local_only";
  return "inbox_item_admitted";
}

export function assertAdmissionDecision(record: InboxItemRecord, decision: AdmissionDecisionKind): Result<void> {
  if (record.status === "archived") return admissionErr({ code: "admission_conflict", message: "archived inbox item cannot mutate" });
  if (["admitted", "rejected", "quarantined", "redacted"].includes(record.status)) {
    return admissionErr({ code: "admission_conflict", message: `final inbox item status cannot be changed: ${record.status}` });
  }
  if (decision === "local_only" && record.status !== "waiting_policy") {
    return admissionErr({ code: "admission_conflict", message: "local_only is only valid after waiting_policy" });
  }
  return ok(undefined);
}

const allowedFeedbackTransitions: Record<FeedbackStatus, readonly FeedbackStatus[]> = {
  candidate: ["accepted_local", "proposed_upstream", "rejected", "ignored", "waiting_evidence", "waiting_human", "redacted"],
  accepted_local: ["proposed_upstream", "redacted", "ignored"],
  proposed_upstream: ["accepted_upstream", "rejected", "waiting_evidence", "waiting_human", "redacted"],
  accepted_upstream: ["redacted"],
  rejected: ["ignored"],
  ignored: [],
  waiting_evidence: ["candidate", "accepted_local", "rejected", "waiting_human", "redacted"],
  waiting_human: ["candidate", "accepted_local", "rejected", "waiting_evidence", "redacted"],
  redacted: ["accepted_local", "proposed_upstream", "rejected", "ignored"]
};

export function assertFeedbackTransition(record: FeedbackUnitRecord, to: FeedbackStatus): Result<void> {
  if (!allowedFeedbackTransitions[record.status].includes(to)) {
    return admissionErr({
      code: "feedback_status_conflict",
      message: `cannot transition feedback from ${record.status} to ${to}`
    });
  }
  return ok(undefined);
}

export function feedbackWithStatus(
  record: FeedbackUnitRecord,
  to: FeedbackStatus,
  reason: { readonly policyDecisionId?: FeedbackUnitRecord["policyDecisionId"]; readonly upstreamProposalRef?: UpstreamProposalRef },
  eventCount = 1
): FeedbackUnitRecord {
  return {
    ...record,
    status: to,
    ...(reason.policyDecisionId === undefined ? {} : { policyDecisionId: reason.policyDecisionId }),
    ...(reason.upstreamProposalRef === undefined ? {} : { upstreamProposalRef: reason.upstreamProposalRef }),
    updatedAt: new Date().toISOString(),
    recordVersion: record.recordVersion + eventCount
  };
}

export function appendEvidence(record: FeedbackUnitRecord, evidenceRefs: readonly ArtifactRef[]): FeedbackUnitRecord {
  const byId = new Map(record.evidenceRefs.map((ref) => [ref.id, ref]));
  for (const ref of evidenceRefs) byId.set(ref.id, ref);
  return {
    ...record,
    evidenceRefs: [...byId.values()],
    updatedAt: new Date().toISOString(),
    recordVersion: record.recordVersion + 1
  };
}

export function matchesInboxQuery(record: InboxItemRecord, query: InboxQuery): boolean {
  if (query.status !== undefined && record.status !== query.status) return false;
  if (query.includeArchived !== true && record.status === "archived") return false;
  if (query.text !== undefined && !`${record.normalizedSummary} ${record.sourceKind}`.toLowerCase().includes(query.text.toLowerCase())) return false;
  return true;
}

export function matchesFeedbackQuery(record: FeedbackUnitRecord, query: FeedbackQuery): boolean {
  if (query.status !== undefined && record.status !== query.status) return false;
  if (query.targetLayer !== undefined && record.targetLayer !== query.targetLayer) return false;
  return true;
}

export function paginate<T>(
  records: readonly T[],
  query: { readonly limit?: number; readonly cursor?: string }
): { readonly page: readonly T[]; readonly total: number; readonly nextCursor?: string; readonly truncated: boolean } {
  const start = query.cursor === undefined ? 0 : Number.parseInt(query.cursor, 10);
  const limit = query.limit ?? 50;
  const page = records.slice(start, start + limit);
  const next = start + page.length;
  return {
    page,
    total: records.length,
    ...(next < records.length ? { nextCursor: String(next) } : {}),
    truncated: next < records.length
  };
}

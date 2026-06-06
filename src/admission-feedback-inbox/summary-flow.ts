import type { FeedbackUnitRef } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import { readFeedbackRecord } from "./feedback-access.js";
import type { AdmissionRuntime } from "./runtime.js";
import type {
  AdmissionExplanation,
  AdmissionSummary,
  InboxItemRecord,
  InboxItemRef,
  UpstreamProposalRef
} from "./types.js";

export async function buildAdmissionSummaryRecord(
  runtime: AdmissionRuntime,
  growUnitRef: InboxItemRecord["growUnitRef"]
): Promise<Result<AdmissionSummary>> {
  const inbox = await runtime.storage.readAllInbox();
  if (!inbox.ok) return inbox;
  const feedback = await runtime.storage.readAllFeedback();
  if (!feedback.ok) return feedback;
  const inboxForGrow = inbox.value.filter((item) => item.growUnitRef.id === growUnitRef.id);
  const feedbackForGrow = feedback.value.filter((item) => item.growUnitRef.id === growUnitRef.id);
  const pendingStatuses = new Set(["received", "normalized", "classified", "waiting_policy", "waiting_evidence", "waiting_human"]);
  const waitingEvidence = feedbackForGrow.filter((item) => item.status === "waiting_evidence").length +
    inboxForGrow.filter((item) => item.status === "waiting_evidence").length;
  return ok({
    growUnitRef,
    pendingInboxCount: inboxForGrow.filter((item) => pendingStatuses.has(item.status)).length,
    admittedInboxCount: inboxForGrow.filter((item) => item.status === "admitted" || item.status === "redacted").length,
    quarantinedInboxCount: inboxForGrow.filter((item) => item.status === "quarantined").length,
    feedbackCandidateCount: feedbackForGrow.filter((item) => item.status === "candidate").length,
    proposedUpstreamCount: feedbackForGrow.filter((item) => item.status === "proposed_upstream").length,
    waitingEvidenceCount: waitingEvidence,
    latestInboxRefs: inboxForGrow.sort(byUpdatedDesc).slice(0, 5).map((item) => item.inboxItemRef),
    latestFeedbackRefs: feedbackForGrow.sort(byUpdatedDesc).slice(0, 5).map((item) => item.feedbackUnitRef),
    builtAt: new Date().toISOString()
  });
}

export async function explainAdmissionRef(
  runtime: AdmissionRuntime,
  ref: InboxItemRef | FeedbackUnitRef | UpstreamProposalRef
): Promise<Result<AdmissionExplanation>> {
  if (ref.kind === "inbox_item") return explainInbox(runtime, ref);
  if (ref.kind === "feedback_unit") return explainFeedback(runtime, ref);
  return explainProposal(runtime, ref);
}

async function explainInbox(runtime: AdmissionRuntime, ref: InboxItemRef): Promise<Result<AdmissionExplanation>> {
  const record = await runtime.storage.readInbox(ref);
  if (!record.ok) return record;
  return ok({
    ref,
    summary: privacySafeSummary(record.value.normalizedSummary, record.value.initialPrivacyClass),
    facts: [
      `status=${record.value.status}`,
      `sourceKind=${record.value.sourceKind}`,
      `privacy=${record.value.initialPrivacyClass}`,
      record.value.classification === undefined ? "classification=none" : `suggested=${record.value.classification.suggestedDecision}`,
      record.value.decision === undefined ? "decision=none" : `decision=${record.value.decision.decision}`
    ]
  });
}

async function explainFeedback(runtime: AdmissionRuntime, ref: FeedbackUnitRef): Promise<Result<AdmissionExplanation>> {
  const record = await readFeedbackRecord(runtime, ref);
  if (!record.ok) return record;
  return ok({
    ref,
    summary: privacySafeSummary(record.value.summary, record.value.privacyClass),
    facts: [
      `status=${record.value.status}`,
      `originLayer=${record.value.originLayer}`,
      `targetLayer=${record.value.targetLayer}`,
      `evidenceRefs=${record.value.evidenceRefs.length}`,
      record.value.upstreamProposalRef === undefined ? "upstreamProposal=none" : `upstreamProposal=${record.value.upstreamProposalRef.id}`
    ]
  });
}

async function explainProposal(runtime: AdmissionRuntime, ref: UpstreamProposalRef): Promise<Result<AdmissionExplanation>> {
  const record = await runtime.storage.readProposal(ref);
  if (!record.ok) return record;
  return ok({
    ref,
    summary: record.value.summary,
    facts: [
      `fromGrowUnit=${record.value.fromGrowUnitRef.id}`,
      `toGrowUnit=${record.value.toGrowUnitRef.id}`,
      `feedbackRefs=${record.value.feedbackUnitRefs.length}`,
      `policyDecision=${record.value.policyDecisionId}`,
      `privacyBoundary=${record.value.privacyBoundary}`
    ]
  });
}

function byUpdatedDesc(a: { readonly updatedAt: string }, b: { readonly updatedAt: string }): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

function privacySafeSummary(summary: string, privacy: string): string {
  return privacy === "contains_secret" || privacy === "unknown" ? "content withheld by privacy metadata" : summary;
}

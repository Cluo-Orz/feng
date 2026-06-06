import type { FeedbackStatus, FeedbackUnitRef } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import { admissionEventTypes } from "./events.js";
import { admissionErr } from "./errors.js";
import { readFeedbackRecord } from "./feedback-access.js";
import { assertFeedbackTransition, newUpstreamProposalRef } from "./logic.js";
import { evaluateUpstreamPolicy } from "./policy.js";
import type { AdmissionRuntime } from "./runtime.js";
import { appendGrowEvent, ensureGrowUnitWritable } from "./runtime.js";
import { mutateFeedbackStatus } from "./feedback-flow.js";
import type {
  CreateUpstreamProposalInput,
  FeedbackTransitionReceipt,
  FeedbackUnitRecord,
  UpstreamProposalRecord,
  UpstreamProposalRef,
  UpstreamResultInput
} from "./types.js";

export async function createUpstreamProposalRecord(
  runtime: AdmissionRuntime,
  input: CreateUpstreamProposalInput
): Promise<Result<UpstreamProposalRef>> {
  if (input.feedbackUnitRefs.length === 0) {
    return admissionErr({ code: "invalid_input", message: "upstream proposal requires at least one feedback unit" });
  }
  const feedback = await readProposalFeedback(runtime, input.feedbackUnitRefs);
  if (!feedback.ok) return feedback;
  const fromGrowUnitRef = feedback.value[0]!.growUnitRef;
  const sameGrow = feedback.value.every((item) => item.growUnitRef.id === fromGrowUnitRef.id);
  if (!sameGrow) return admissionErr({ code: "invalid_input", message: "upstream proposal feedback must share one grow unit" });
  const writable = await ensureGrowUnitWritable(runtime, fromGrowUnitRef);
  if (!writable.ok) return writable;
  const target = await runtime.options.growUnitManager.getGrowUnit(input.targetGrowUnitRef);
  if (!target.ok) return target;
  for (const record of feedback.value) {
    const allowed = assertFeedbackTransition(record, "proposed_upstream");
    if (!allowed.ok) return allowed;
  }
  const summaryArtifact = await runtime.options.artifactRegistry.resolveArtifact(input.redactedSummaryRef);
  if (!summaryArtifact.ok) return summaryArtifact;
  const policy = await evaluateUpstreamPolicy({
    policyBoundary: runtime.options.policyBoundary,
    artifactRegistry: runtime.options.artifactRegistry,
    fromGrowUnitRef,
    targetGrowUnitRef: input.targetGrowUnitRef,
    redactedSummaryRef: input.redactedSummaryRef,
    source: input.source,
    reason: input.reason,
    ...(input.policyContext === undefined ? {} : { policyContext: input.policyContext })
  });
  if (!policy.ok) return policy;
  const proposalRef = newUpstreamProposalRef();
  const record: UpstreamProposalRecord = {
    proposalId: proposalRef.id,
    proposalRef,
    fromGrowUnitRef,
    toGrowUnitRef: input.targetGrowUnitRef,
    feedbackUnitRefs: input.feedbackUnitRefs,
    summary: bounded(input.summary, 2_000),
    redactedSummaryRef: input.redactedSummaryRef,
    evidenceRefs: input.evidenceRefs ?? [],
    policyDecisionId: policy.value.policyDecisionId,
    privacyBoundary: input.privacyBoundary,
    attribution: input.attribution,
    createdAt: new Date().toISOString(),
    source: input.source,
    audit: input.audit
  };
  const event = await appendGrowEvent({
    runtime,
    growUnitRef: fromGrowUnitRef,
    eventType: admissionEventTypes.feedbackUpstreamProposed,
    body: {
      proposalRef,
      fromGrowUnitRef,
      toGrowUnitRef: input.targetGrowUnitRef,
      feedbackUnitRefs: input.feedbackUnitRefs,
      policyDecisionId: record.policyDecisionId
    },
    source: input.source,
    audit: input.audit
  });
  if (!event.ok) return event;
  const write = await runtime.storage.writeProposal(record, "write upstream proposal");
  if (!write.ok) return write;
  const index = await runtime.storage.addProposal(proposalRef);
  if (!index.ok) return index;
  for (const item of feedback.value) {
    const transitioned = await mutateFeedbackStatus(runtime, item, "proposed_upstream", {
      to: "proposed_upstream",
      reason: input.reason,
      source: input.source,
      audit: input.audit,
      policyDecisionId: record.policyDecisionId,
      upstreamProposalRef: proposalRef
    }, admissionEventTypes.feedbackStatusChanged);
    if (!transitioned.ok) return transitioned;
  }
  return ok(proposalRef);
}

export async function recordUpstreamProposalResult(
  runtime: AdmissionRuntime,
  proposalRef: UpstreamProposalRef,
  input: UpstreamResultInput
): Promise<Result<readonly FeedbackTransitionReceipt[]>> {
  const proposal = await runtime.storage.readProposal(proposalRef);
  if (!proposal.ok) return proposal;
  const receipts: FeedbackTransitionReceipt[] = [];
  for (const ref of proposal.value.feedbackUnitRefs) {
    const record = await readFeedbackRecord(runtime, ref);
    if (!record.ok) return record;
    const to = mapUpstreamResult(input.result);
    const transitioned = await mutateFeedbackStatus(runtime, record.value, to, {
      to,
      reason: input.reason,
      source: input.source,
      audit: input.audit,
      policyDecisionId: proposal.value.policyDecisionId,
      upstreamProposalRef: proposalRef
    }, admissionEventTypes.feedbackUpstreamResultRecorded);
    if (!transitioned.ok) return transitioned;
    receipts.push(transitioned.value);
  }
  return ok(receipts);
}

async function readProposalFeedback(
  runtime: AdmissionRuntime,
  refs: readonly FeedbackUnitRef[]
): Promise<Result<readonly FeedbackUnitRecord[]>> {
  const records: FeedbackUnitRecord[] = [];
  for (const ref of refs) {
    const record = await readFeedbackRecord(runtime, ref);
    if (!record.ok) return record;
    records.push(record.value);
  }
  return ok(records);
}

function mapUpstreamResult(result: UpstreamResultInput["result"]): FeedbackStatus {
  if (result === "accepted_upstream") return "accepted_upstream";
  if (result === "waiting_evidence") return "waiting_evidence";
  if (result === "waiting_human") return "waiting_human";
  return "rejected";
}

function bounded(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

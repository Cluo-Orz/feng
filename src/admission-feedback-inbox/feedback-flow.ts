import type { ArtifactRef, FeedbackStatus, FeedbackUnitRef, PolicyDecisionId } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import type { EventAppendReceipt } from "../event-ledger/index.js";
import type { WriteReceipt } from "../file-store/index.js";
import { resolvePayloadRef } from "./artifacts.js";
import { admissionEventTypes } from "./events.js";
import { admissionErr } from "./errors.js";
import { readFeedbackRecord } from "./feedback-access.js";
import {
  appendEvidence,
  assertFeedbackTransition,
  feedbackWithStatus,
  matchesFeedbackQuery,
  newFeedbackUnitRef,
  paginate,
  validateReceive
} from "./logic.js";
import type { AdmissionRuntime } from "./runtime.js";
import { appendFeedbackEvent, ensureGrowUnitWritable } from "./runtime.js";
import type {
  CreateFeedbackInput,
  FeedbackQuery,
  FeedbackTransitionInput,
  FeedbackTransitionReceipt,
  FeedbackUnitPage,
  FeedbackUnitRecord
} from "./types.js";

export async function createFeedbackUnitRecord(
  runtime: AdmissionRuntime,
  input: CreateFeedbackInput
): Promise<Result<FeedbackUnitRef>> {
  const valid = validateFeedbackInput(input);
  if (!valid.ok) return valid;
  const writable = await ensureGrowUnitWritable(runtime, input.growUnitRef);
  if (!writable.ok) return writable;
  const detail = await resolveDetailRef(runtime, input);
  if (!detail.ok) return detail;
  const evidence = await ensureArtifacts(runtime, input.evidenceRefs ?? []);
  if (!evidence.ok) return evidence;
  const traces = await ensureArtifacts(runtime, input.runtimeTraceRefs ?? []);
  if (!traces.ok) return traces;
  const feedbackUnitRef = newFeedbackUnitRef();
  const now = new Date().toISOString();
  const record: FeedbackUnitRecord = {
    feedbackUnitId: feedbackUnitRef.id,
    feedbackUnitRef,
    growUnitRef: input.growUnitRef,
    originLayer: input.originLayer,
    targetLayer: input.targetLayer,
    status: "candidate",
    summary: bounded(input.summary, 2_000),
    ...(detail.value === undefined ? {} : { detailRef: detail.value }),
    evidenceRefs: uniqueRefs(evidence.value),
    runtimeTraceRefs: uniqueRefs(traces.value),
    attribution: bounded(input.attribution, 500),
    impact: bounded(input.impact, 1_000),
    suggestedAction: bounded(input.suggestedAction, 1_000),
    privacyClass: input.privacyClass,
    createdAt: now,
    updatedAt: now,
    source: input.source,
    audit: input.audit,
    recordVersion: 1
  };
  const event = await appendFeedbackEvent({
    runtime,
    feedbackUnitRef,
    eventType: admissionEventTypes.feedbackUnitCreated,
    body: { feedbackUnitRef, record },
    source: input.source,
    audit: input.audit
  });
  if (!event.ok) return event;
  const write = await runtime.storage.writeFeedback(record, "write feedback unit");
  if (!write.ok) return write;
  const index = await runtime.storage.addFeedback(feedbackUnitRef);
  return index.ok ? ok(feedbackUnitRef) : index;
}

export async function transitionFeedbackUnit(
  runtime: AdmissionRuntime,
  feedbackUnitRef: FeedbackUnitRef,
  input: FeedbackTransitionInput
): Promise<Result<FeedbackTransitionReceipt>> {
  const record = await readFeedbackRecord(runtime, feedbackUnitRef);
  if (!record.ok) return record;
  const guarded = guardUpstreamTransition(input);
  if (!guarded.ok) return guarded;
  return mutateFeedbackStatus(runtime, record.value, input.to, input, admissionEventTypes.feedbackStatusChanged);
}

export async function linkFeedbackEvidenceRefs(
  runtime: AdmissionRuntime,
  feedbackUnitRef: FeedbackUnitRef,
  evidenceRefs: readonly ArtifactRef[],
  reason: string
): Promise<Result<FeedbackTransitionReceipt>> {
  const record = await readFeedbackRecord(runtime, feedbackUnitRef);
  if (!record.ok) return record;
  const evidence = await ensureArtifacts(runtime, evidenceRefs);
  if (!evidence.ok) return evidence;
  const updated = appendEvidence(record.value, evidence.value);
  const event = await appendFeedbackEvent({
    runtime,
    feedbackUnitRef,
    eventType: admissionEventTypes.feedbackEvidenceLinked,
    body: { feedbackUnitRef, from: record.value.status, to: updated.status, evidenceRefs: evidence.value, reason },
    source: record.value.source,
    audit: { ...record.value.audit, reason }
  });
  if (!event.ok) return event;
  const write = await runtime.storage.writeFeedback(updated, "link feedback evidence");
  if (!write.ok) return write;
  return ok(receipt(feedbackUnitRef, record.value.status, updated.status, event.value, write.value));
}

export async function redactFeedbackUnit(
  runtime: AdmissionRuntime,
  feedbackUnitRef: FeedbackUnitRef,
  policyDecisionId: PolicyDecisionId
): Promise<Result<FeedbackTransitionReceipt>> {
  const record = await readFeedbackRecord(runtime, feedbackUnitRef);
  if (!record.ok) return record;
  return mutateFeedbackStatus(
    runtime,
    record.value,
    "redacted",
    {
      to: "redacted",
      reason: "redact feedback",
      source: record.value.source,
      audit: { ...record.value.audit, reason: "redact feedback" },
      policyDecisionId
    },
    admissionEventTypes.feedbackRedacted
  );
}

export async function listFeedbackUnits(
  runtime: AdmissionRuntime,
  growUnitRef: FeedbackUnitRecord["growUnitRef"],
  query: FeedbackQuery = {}
): Promise<Result<FeedbackUnitPage>> {
  const records = await runtime.storage.readAllFeedback();
  if (!records.ok) return records;
  const selected = records.value
    .filter((record) => record.growUnitRef.id === growUnitRef.id)
    .filter((record) => matchesFeedbackQuery(record, query))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const page = paginate(selected, query);
  return ok({
    records: page.page,
    total: page.total,
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    truncated: page.truncated
  });
}

export async function mutateFeedbackStatus(
  runtime: AdmissionRuntime,
  record: FeedbackUnitRecord,
  to: FeedbackStatus,
  input: FeedbackTransitionInput,
  eventType: string
): Promise<Result<FeedbackTransitionReceipt>> {
  const writable = await ensureGrowUnitWritable(runtime, record.growUnitRef);
  if (!writable.ok) return writable;
  const allowed = assertFeedbackTransition(record, to);
  if (!allowed.ok) return allowed;
  const updated = feedbackWithStatus(record, to, {
    ...(input.policyDecisionId === undefined ? {} : { policyDecisionId: input.policyDecisionId }),
    ...(input.upstreamProposalRef === undefined ? {} : { upstreamProposalRef: input.upstreamProposalRef })
  });
  const event = await appendFeedbackEvent({
    runtime,
    feedbackUnitRef: record.feedbackUnitRef,
    eventType,
    body: {
      feedbackUnitRef: record.feedbackUnitRef,
      from: record.status,
      to,
      reason: input.reason,
      policyDecisionId: input.policyDecisionId,
      upstreamProposalRef: input.upstreamProposalRef
    },
    source: input.source,
    audit: input.audit
  });
  if (!event.ok) return event;
  const write = await runtime.storage.writeFeedback(updated, `write feedback ${to}`);
  return write.ok ? ok(receipt(record.feedbackUnitRef, record.status, to, event.value, write.value)) : write;
}

async function resolveDetailRef(runtime: AdmissionRuntime, input: CreateFeedbackInput): Promise<Result<ArtifactRef | undefined>> {
  if (input.detail !== undefined && input.detailRef !== undefined) {
    return admissionErr({ code: "invalid_input", message: "feedback detail cannot provide both detail and detailRef" });
  }
  if (input.detailRef !== undefined) {
    const record = await runtime.options.artifactRegistry.resolveArtifact(input.detailRef);
    return record.ok ? ok(input.detailRef) : record;
  }
  if (input.detail === undefined) return ok(undefined);
  const valid = validateReceive(input.detail);
  if (!valid.ok) return valid;
  return resolvePayloadRef(runtime, "manual_review", input.detail);
}

async function ensureArtifacts(runtime: AdmissionRuntime, refs: readonly ArtifactRef[]): Promise<Result<readonly ArtifactRef[]>> {
  for (const ref of refs) {
    const record = await runtime.options.artifactRegistry.resolveArtifact(ref);
    if (!record.ok) return record;
  }
  return ok(refs);
}

function validateFeedbackInput(input: CreateFeedbackInput): Result<void> {
  if (input.summary.trim().length === 0) return admissionErr({ code: "invalid_input", message: "feedback summary is required" });
  if (input.attribution.trim().length === 0) return admissionErr({ code: "invalid_input", message: "feedback attribution is required" });
  return ok(undefined);
}

function guardUpstreamTransition(input: FeedbackTransitionInput): Result<void> {
  if ((input.to === "proposed_upstream" || input.to === "accepted_upstream") && input.upstreamProposalRef === undefined) {
    return admissionErr({ code: "invalid_input", message: `${input.to} requires upstreamProposalRef` });
  }
  return ok(undefined);
}

function receipt(
  feedbackUnitRef: FeedbackUnitRef,
  from: FeedbackStatus,
  to: FeedbackStatus,
  eventReceipt: EventAppendReceipt,
  recordWriteReceipt: WriteReceipt
): FeedbackTransitionReceipt {
  return { feedbackUnitRef, from, to, eventReceipt, recordWriteReceipt };
}

function uniqueRefs<T extends { readonly id: string }>(refs: readonly T[]): readonly T[] {
  return [...new Map(refs.map((ref) => [ref.id, ref])).values()];
}

function bounded(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

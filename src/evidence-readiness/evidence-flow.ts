import { ok, type Result } from "../domain/result.js";
import type { EvidenceRuntime } from "./runtime.js";
import {
  appendEvidenceEvent,
  ensureGrowUnitWritable,
  evaluateArtifactPolicy,
  materializeEvidenceArtifact,
  resolveArtifactForEvidence
} from "./runtime.js";
import { evidenceEventTypes } from "./events.js";
import { evidenceErr } from "./errors.js";
import {
  artifactKindForSource,
  classifyRecord,
  compact,
  defaultQuality,
  lifecycleUsableForReadiness,
  mergeQuality,
  newEvidenceRef,
  nonEmpty
} from "./logic.js";
import type {
  EvidenceClassification,
  EvidencePage,
  EvidenceQuery,
  EvidenceReceipt,
  EvidenceRecord,
  EvidenceRef,
  EvidenceStatus,
  EvidenceTransitionInput,
  RecordEvidenceCandidateInput
} from "./types.js";

export async function recordEvidenceCandidate(
  runtime: EvidenceRuntime,
  input: RecordEvidenceCandidateInput
): Promise<Result<EvidenceRef>> {
  const valid = validateCandidateInput(input);
  if (!valid.ok) return valid;
  const writable = await ensureGrowUnitWritable(runtime, input.growUnitRef);
  if (!writable.ok) return writable;
  const artifact = await ensureCandidateArtifact(runtime, input);
  if (!artifact.ok) return artifact;
  const evidenceRef = newEvidenceRef();
  const now = new Date().toISOString();
  const record: EvidenceRecord = {
    evidenceId: evidenceRef.id,
    evidenceRef,
    growUnitRef: input.growUnitRef,
    sourceKind: input.sourceKind,
    status: "candidate",
    summary: compact(input.summary, 4_000),
    ...(artifact.value === undefined ? {} : { artifactRef: artifact.value }),
    ...(input.relatedAttemptRef === undefined ? {} : { relatedAttemptRef: input.relatedAttemptRef }),
    ...(input.relatedFeedbackRef === undefined ? {} : { relatedFeedbackRef: input.relatedFeedbackRef }),
    relationHints: input.relationHints ?? [],
    quality: mergeQuality(defaultQuality(input.sourceKind), input.quality),
    policyDecisionRefs: [],
    scope: compact(input.scope ?? "current grow unit", 2_000),
    createdAt: now,
    updatedAt: now,
    source: input.source,
    version: input.version,
    audit: input.audit,
    recordVersion: 1
  };
  const write = await runtime.storage.writeEvidence(record, "record evidence candidate");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addEvidence(evidenceRef);
  if (!indexed.ok) return indexed;
  const event = await appendEvidenceEvent({
    runtime,
    growUnitRef: input.growUnitRef,
    eventType: evidenceEventTypes.candidateRecorded,
    body: { evidenceRef, sourceKind: input.sourceKind, status: record.status, artifactRef: record.artifactRef },
    source: input.source,
    audit: input.audit
  });
  return event.ok ? ok(evidenceRef) : event;
}

export async function classifyEvidenceRecord(
  runtime: EvidenceRuntime,
  evidenceRef: EvidenceRef
): Promise<Result<EvidenceClassification>> {
  const record = await runtime.storage.readEvidence(evidenceRef);
  if (!record.ok) return record;
  const classified = classifyRecord(record.value);
  const result: EvidenceClassification = {
    evidenceRef,
    status: classified.status,
    quality: record.value.quality,
    relations: record.value.relationHints,
    usableForReadiness: classified.usable,
    reason: classified.reason,
    policyDecisionRefs: record.value.policyDecisionRefs,
    classifiedAt: new Date().toISOString()
  };
  const event = await appendEvidenceEvent({
    runtime,
    growUnitRef: record.value.growUnitRef,
    eventType: evidenceEventTypes.classified,
    body: { evidenceRef, status: result.status, usableForReadiness: result.usableForReadiness, reason: result.reason },
    source: record.value.source,
    audit: { ...record.value.audit, reason: "classify evidence" }
  });
  return event.ok ? ok(result) : event;
}

export function acceptEvidenceRecord(
  runtime: EvidenceRuntime,
  evidenceRef: EvidenceRef,
  input: EvidenceTransitionInput
): Promise<Result<EvidenceReceipt>> {
  return transitionWithArtifactCheck(runtime, evidenceRef, input);
}

export function rejectEvidenceRecord(
  runtime: EvidenceRuntime,
  evidenceRef: EvidenceRef,
  input: EvidenceTransitionInput
): Promise<Result<EvidenceReceipt>> {
  return transitionEvidence(runtime, evidenceRef, "rejected", input, evidenceEventTypes.rejected, { rejectionReason: input.reason });
}

export function markEvidenceStaleRecord(
  runtime: EvidenceRuntime,
  evidenceRef: EvidenceRef,
  input: EvidenceTransitionInput
): Promise<Result<EvidenceReceipt>> {
  return transitionEvidence(runtime, evidenceRef, "stale", input, evidenceEventTypes.markedStale, { staleReason: input.reason });
}

export async function listEvidenceRecords(
  runtime: EvidenceRuntime,
  growUnitRef: EvidenceRecord["growUnitRef"],
  query: EvidenceQuery = {}
): Promise<Result<EvidencePage>> {
  const all = await runtime.storage.readAllEvidence();
  if (!all.ok) return all;
  let records = all.value.filter((record) => record.growUnitRef.id === growUnitRef.id);
  if (query.status !== undefined) records = records.filter((record) => record.status === query.status);
  if (query.sourceKind !== undefined) records = records.filter((record) => record.sourceKind === query.sourceKind);
  if (query.text !== undefined) {
    const needle = query.text.toLowerCase();
    records = records.filter((record) => `${record.summary}\n${record.scope}`.toLowerCase().includes(needle));
  }
  const start = query.cursor === undefined ? 0 : Number.parseInt(query.cursor, 10);
  const limit = Math.max(1, query.limit ?? (records.length || 1));
  const page = records.slice(start, start + limit);
  return ok({
    records: page,
    total: records.length,
    ...(start + limit >= records.length ? {} : { nextCursor: String(start + limit) }),
    truncated: start + limit < records.length
  });
}

async function transitionWithArtifactCheck(
  runtime: EvidenceRuntime,
  evidenceRef: EvidenceRef,
  input: EvidenceTransitionInput
): Promise<Result<EvidenceReceipt>> {
  const current = await runtime.storage.readEvidence(evidenceRef);
  if (!current.ok) return current;
  if (current.value.artifactRef === undefined) {
    return evidenceErr({ code: "evidence_unavailable", message: "accepted evidence requires an artifact" });
  }
  const resolved = await resolveArtifactForEvidence(runtime, current.value.artifactRef);
  if (!resolved.ok) return resolved;
  const unusable = await unusableArtifactTransition(runtime, current.value, resolved.value.lifecycle, input);
  if (unusable !== undefined) return unusable;
  const policy = await evaluateArtifactPolicy({
    runtime,
    record: resolved.value,
    growUnitRef: current.value.growUnitRef,
    source: input.source,
    reason: input.reason,
    ...(input.policyContext === undefined ? {} : { context: input.policyContext })
  });
  if (!policy.ok) return policy;
  if (policy.value.verdict === "deny") {
    const changed = await transitionEvidence(
      runtime,
      evidenceRef,
      "waiting_policy",
      input,
      evidenceEventTypes.acceptedForEvaluation,
      {},
      policy.value
    );
    return changed.ok ? evidenceErr({ code: "policy_blocked", message: policy.value.explanation }) : changed;
  }
  if (policy.value.verdict === "ask") {
    const changed = await transitionEvidence(
      runtime,
      evidenceRef,
      "waiting_policy",
      input,
      evidenceEventTypes.acceptedForEvaluation,
      {},
      policy.value
    );
    return changed.ok ? evidenceErr({ code: "approval_required", message: policy.value.explanation }) : changed;
  }
  if (policy.value.verdict === "allow_with_redaction" || resolved.value.privacyClass === "contains_secret") {
    const changed = await transitionEvidence(runtime, evidenceRef, "redacted", input, evidenceEventTypes.redacted, {}, policy.value);
    return changed.ok
      ? evidenceErr({ code: "privacy_blocked", message: "redacted or secret evidence cannot support readiness" })
      : changed;
  }
  const materialized = await materializeEvidenceArtifact(runtime, current.value.artifactRef, input.reason);
  if (!materialized.ok) return materialized;
  if (materialized.value.status !== "available") {
    const next = materialized.value.status === "redacted" ? "redacted" : "unavailable";
    const eventType = next === "redacted" ? evidenceEventTypes.redacted : evidenceEventTypes.unavailable;
    const changed = await transitionEvidence(runtime, evidenceRef, next, input, eventType, {}, policy.value);
    return changed.ok
      ? evidenceErr({
          code: next === "redacted" ? "privacy_blocked" : "artifact_unavailable",
          message: "artifact is not readable"
        })
      : changed;
  }
  return transitionEvidence(runtime, evidenceRef, "accepted_for_evaluation", input, evidenceEventTypes.acceptedForEvaluation, {
    acceptedAt: new Date().toISOString(),
    quality: { ...current.value.quality, privacyFit: "fit" }
  }, policy.value);
}

async function transitionEvidence(
  runtime: EvidenceRuntime,
  evidenceRef: EvidenceRef,
  to: EvidenceStatus,
  input: EvidenceTransitionInput,
  eventType: string,
  patch: Partial<EvidenceRecord>,
  policyDecision?: EvidenceReceipt["policyDecision"]
): Promise<Result<EvidenceReceipt>> {
  const current = await runtime.storage.readEvidence(evidenceRef);
  if (!current.ok) return current;
  const writable = await ensureGrowUnitWritable(runtime, current.value.growUnitRef);
  if (!writable.ok) return writable;
  const updated: EvidenceRecord = {
    ...current.value,
    ...patch,
    status: to,
    policyDecisionRefs: policyDecision === undefined
      ? current.value.policyDecisionRefs
      : [...current.value.policyDecisionRefs, policyDecision.policyDecisionId],
    updatedAt: new Date().toISOString(),
    source: input.source,
    audit: input.audit,
    recordVersion: current.value.recordVersion + 1
  };
  const write = await runtime.storage.writeEvidence(updated, input.reason);
  if (!write.ok) return write;
  const event = await appendEvidenceEvent({
    runtime,
    growUnitRef: updated.growUnitRef,
    eventType,
    body: { evidenceRef, from: current.value.status, to, policyDecisionId: policyDecision?.policyDecisionId },
    source: input.source,
    audit: input.audit
  });
  if (!event.ok) return event;
  return ok({
    evidenceRef,
    from: current.value.status,
    to,
    ...(policyDecision === undefined ? {} : { policyDecision }),
    eventReceipt: event.value,
    recordWriteReceipt: write.value
  });
}

function validateCandidateInput(input: RecordEvidenceCandidateInput): Result<void> {
  const required = [nonEmpty(input.summary, "summary")];
  const failed = required.find((item) => !item.ok);
  if (failed !== undefined && !failed.ok) return failed;
  if (input.artifactRef !== undefined && input.content !== undefined) {
    return evidenceErr({ code: "invalid_input", message: "provide either artifactRef or content, not both" });
  }
  if (input.sourceKind === "manual_review" && (input.scope ?? "").trim().length === 0) {
    return evidenceErr({ code: "invalid_input", message: "manual review evidence requires scope" });
  }
  return ok(undefined);
}

async function ensureCandidateArtifact(
  runtime: EvidenceRuntime,
  input: RecordEvidenceCandidateInput
): Promise<Result<EvidenceRecord["artifactRef"]>> {
  if (input.artifactRef !== undefined) {
    const resolved = await resolveArtifactForEvidence(runtime, input.artifactRef);
    return resolved.ok ? ok(input.artifactRef) : resolved;
  }
  if (input.content === undefined) return ok(undefined);
  const registered = await runtime.options.artifactRegistry.registerArtifact({
    kind: input.artifactKind ?? artifactKindForSource(input.sourceKind),
    content: input.content,
    mediaType: input.mediaType ?? "text/plain",
    ...(input.encoding === undefined ? {} : { encoding: input.encoding }),
    source: input.source,
    version: input.version,
    audit: input.audit,
    privacyClass: input.privacyClass ?? input.source.privacyLevel,
    retentionClass: input.retentionClass ?? "grow_scoped",
    producerModule: "evidence-readiness"
  });
  return registered.ok ? ok(registered.value) : registered;
}

async function unusableArtifactTransition(
  runtime: EvidenceRuntime,
  record: EvidenceRecord,
  lifecycle: string,
  input: EvidenceTransitionInput
): Promise<Result<EvidenceReceipt> | undefined> {
  if (lifecycleUsableForReadiness(lifecycle)) return undefined;
  const to = lifecycle === "redacted" ? "redacted" : "unavailable";
  const eventType = to === "redacted" ? evidenceEventTypes.redacted : evidenceEventTypes.unavailable;
  const changed = await transitionEvidence(runtime, record.evidenceRef, to, input, eventType, {});
  if (!changed.ok) return changed;
  return evidenceErr({
    code: to === "redacted" ? "privacy_blocked" : "artifact_unavailable",
    message: `artifact lifecycle ${lifecycle} cannot support readiness`
  });
}

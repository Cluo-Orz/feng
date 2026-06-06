import type { GrowUnitRecord } from "../grow-unit-manager/index.js";
import type { AuditDescriptor, SourceDescriptor } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import type { EventAppendReceipt } from "../event-ledger/index.js";
import type { WriteReceipt } from "../file-store/index.js";
import { admissionEventTypes } from "./events.js";
import { admissionErr } from "./errors.js";
import { registerInboxPayload } from "./artifacts.js";
import {
  assertAdmissionDecision,
  decisionEventType,
  decisionStatus,
  matchesInboxQuery,
  newInboxItemRef,
  paginate,
  validateReceive
} from "./logic.js";
import type { AdmissionRuntime } from "./runtime.js";
import { appendGrowEvent, ensureGrowUnitWritable } from "./runtime.js";
import type {
  AdmissionClassification,
  AdmissionDecisionInput,
  AdmissionReceipt,
  ClassifyInboxContext,
  InboxItemPage,
  InboxQuery,
  InboxItemRecord,
  InboxItemRef,
  InboxSourceKind,
  ReceivePayloadInput
} from "./types.js";

const pendingStatuses = ["received", "normalized", "classified", "waiting_policy", "waiting_evidence", "waiting_human"];

export async function receiveInboxItem(
  runtime: AdmissionRuntime,
  growUnitRef: InboxItemRecord["growUnitRef"],
  sourceKind: InboxSourceKind,
  input: ReceivePayloadInput
): Promise<Result<InboxItemRef>> {
  const valid = validateReceive(input);
  if (!valid.ok) return valid;
  const writable = await ensureGrowUnitWritable(runtime, growUnitRef);
  if (!writable.ok) return writable;
  const registered = await registerInboxPayload(runtime, sourceKind, input);
  if (!registered.ok) return registered;
  const inboxItemRef = newInboxItemRef();
  const now = new Date().toISOString();
  const record: InboxItemRecord = {
    inboxItemId: inboxItemRef.id,
    inboxItemRef,
    growUnitRef,
    sourceKind,
    source: input.source,
    receivedAt: now,
    rawArtifactRef: registered.value.rawArtifactRef,
    ...(registered.value.previewRef === undefined ? {} : { previewRef: registered.value.previewRef }),
    normalizedSummary: registered.value.normalizedSummary,
    initialPrivacyClass: input.privacyClass,
    status: "received",
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
    audit: input.audit,
    version: input.version,
    updatedAt: now,
    recordVersion: 1
  };
  const event = await appendGrowEvent({
    runtime,
    growUnitRef,
    eventType: admissionEventTypes.inboxItemReceived,
    body: { inboxItemRef, sourceKind, rawArtifactRef: record.rawArtifactRef, previewRef: record.previewRef, status: "received" },
    source: input.source,
    audit: input.audit,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId })
  });
  if (!event.ok) return event;
  const write = await runtime.storage.writeInbox(record, "write received inbox item");
  if (!write.ok) return write;
  const index = await runtime.storage.addInbox(inboxItemRef);
  return index.ok ? ok(inboxItemRef) : index;
}

export async function normalizeInbox(runtime: AdmissionRuntime, ref: InboxItemRef): Promise<Result<InboxItemRecord>> {
  const record = await runtime.storage.readInbox(ref);
  if (!record.ok) return record;
  const mutable = assertInboxMutable(record.value, ["received", "normalized"]);
  if (!mutable.ok) return mutable;
  if (record.value.status === "normalized") return ok(record.value);
  const preview = await runtime.options.artifactRegistry.readArtifactPreview(record.value.rawArtifactRef, {
    reason: "normalize inbox item",
    maxBytes: 8 * 1024,
    allowArchived: true
  });
  if (!preview.ok) return preview;
  const updated: InboxItemRecord = {
    ...record.value,
    normalizedSummary: compact(preview.value.content),
    status: "normalized",
    updatedAt: new Date().toISOString(),
    recordVersion: record.value.recordVersion + 1
  };
  const written = await writeInboxMutation(runtime, updated, admissionEventTypes.inboxItemNormalized, {
    inboxItemRef: ref,
    from: record.value.status,
    to: updated.status,
    normalizedSummary: updated.normalizedSummary
  });
  return written.ok ? ok(updated) : written;
}

export async function classifyInbox(
  runtime: AdmissionRuntime,
  ref: InboxItemRef,
  context: ClassifyInboxContext = {}
): Promise<Result<AdmissionClassification>> {
  const record = await runtime.storage.readInbox(ref);
  if (!record.ok) return record;
  const mutable = assertInboxMutable(record.value, ["received", "normalized", "classified"]);
  if (!mutable.ok) return mutable;
  const grow = await runtime.options.growUnitManager.getGrowUnit(record.value.growUnitRef);
  if (!grow.ok) return grow;
  const routerRefs = await activeDefaultRouterRefs(runtime, grow.value);
  if (!routerRefs.ok) return routerRefs;
  const classification: AdmissionClassification = {
    inboxItemRef: ref,
    suggestedDecision: suggestedDecision(record.value, context),
    reason: classificationReason(record.value, context),
    evidenceRefs: [record.value.rawArtifactRef],
    routerSkillRefs: routerRefs.value,
    classifiedAt: new Date().toISOString()
  };
  const updated: InboxItemRecord = {
    ...record.value,
    classification,
    status: "classified",
    updatedAt: new Date().toISOString(),
    recordVersion: record.value.recordVersion + 1
  };
  const written = await writeInboxMutation(runtime, updated, admissionEventTypes.inboxItemClassified, {
    inboxItemRef: ref,
    from: record.value.status,
    to: "classified",
    suggestedDecision: classification.suggestedDecision,
    evidenceRefs: classification.evidenceRefs,
    routerSkillRefs: classification.routerSkillRefs
  });
  return written.ok ? ok(classification) : written;
}

export async function decideInboxAdmission(
  runtime: AdmissionRuntime,
  ref: InboxItemRef,
  input: AdmissionDecisionInput
): Promise<Result<AdmissionReceipt>> {
  const record = await runtime.storage.readInbox(ref);
  if (!record.ok) return record;
  const writable = await ensureGrowUnitWritable(runtime, record.value.growUnitRef);
  if (!writable.ok) return writable;
  const allowed = assertAdmissionDecision(record.value, input.decision);
  if (!allowed.ok) return allowed;
  if ((input.decision === "redact_then_admit" || input.decision === "propose_upstream") && input.redactedArtifactRef === undefined) {
    return admissionErr({ code: "redaction_required", message: `${input.decision} requires a redactedArtifactRef` });
  }
  const updated: InboxItemRecord = {
    ...record.value,
    status: decisionStatus(input.decision),
    decision: {
      decision: input.decision,
      reason: input.reason,
      evidenceRefs: input.evidenceRefs ?? [],
      ...(input.redactedArtifactRef === undefined ? {} : { redactedArtifactRef: input.redactedArtifactRef }),
      decidedAt: new Date().toISOString(),
      source: input.source,
      audit: input.audit
    },
    updatedAt: new Date().toISOString(),
    recordVersion: record.value.recordVersion + 1
  };
  const written = await writeInboxMutation(
    runtime,
    updated,
    decisionEventType(input.decision),
    {
      inboxItemRef: ref,
      from: record.value.status,
      to: updated.status,
      decision: input.decision,
      evidenceRefs: input.evidenceRefs ?? [],
      redactedArtifactRef: input.redactedArtifactRef
    },
    input.source,
    input.audit
  );
  if (!written.ok) return written;
  return ok({
    inboxItemRef: ref,
    from: record.value.status,
    to: updated.status,
    decision: input.decision,
    eventReceipt: written.value.eventReceipt,
    recordWriteReceipt: written.value.recordWriteReceipt
  });
}

export async function listPendingInboxItems(
  runtime: AdmissionRuntime,
  growUnitRef: InboxItemRecord["growUnitRef"],
  query: InboxQuery = {}
): Promise<Result<InboxItemPage>> {
  const records = await runtime.storage.readAllInbox();
  if (!records.ok) return records;
  const selected = records.value
    .filter((record) => record.growUnitRef.id === growUnitRef.id)
    .filter((record) => "status" in query || pendingStatuses.includes(record.status))
    .filter((record) => matchesInboxQuery(record, query))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const page = paginate(selected, query);
  return ok({
    items: page.page,
    total: page.total,
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    truncated: page.truncated
  });
}

async function writeInboxMutation(
  runtime: AdmissionRuntime,
  record: InboxItemRecord,
  eventType: string,
  body: Record<string, unknown>,
  source: SourceDescriptor = record.source,
  audit: AuditDescriptor = record.audit
): Promise<Result<{ readonly eventReceipt: EventAppendReceipt; readonly recordWriteReceipt: WriteReceipt }>> {
  const event = await appendGrowEvent({
    runtime,
    growUnitRef: record.growUnitRef,
    eventType,
    body,
    source,
    audit,
    ...(record.correlationId === undefined ? {} : { correlationId: record.correlationId })
  });
  if (!event.ok) return event;
  const write = await runtime.storage.writeInbox(record, `write ${eventType}`);
  return write.ok ? ok({ eventReceipt: event.value, recordWriteReceipt: write.value }) : write;
}

function assertInboxMutable(record: InboxItemRecord, allowed: readonly string[]): Result<void> {
  if (!allowed.includes(record.status)) {
    return admissionErr({ code: "admission_conflict", message: `inbox item in ${record.status} cannot be changed here` });
  }
  return ok(undefined);
}

async function activeDefaultRouterRefs(runtime: AdmissionRuntime, grow: GrowUnitRecord) {
  const scopes = [
    { workspace: grow.workspace },
    { workspace: grow.workspace, growUnit: grow.growUnitId },
    { workspace: grow.workspace, systemDefault: true }
  ];
  const refs = new Map<string, AdmissionClassification["routerSkillRefs"][number]>();
  for (const scope of scopes) {
    const active = await runtime.options.skillRegistry.listActiveSkills(scope);
    if (!active.ok) return active;
    for (const item of active.value.skills) {
      if (item.record.family === "default_feedback_router") refs.set(item.record.skillId, item.record.skillRef);
    }
  }
  return ok([...refs.values()]);
}

function suggestedDecision(record: InboxItemRecord, context: ClassifyInboxContext): AdmissionClassification["suggestedDecision"] {
  const text = `${record.normalizedSummary} ${context.defaultFeedbackRouterSummary ?? ""}`.toLowerCase();
  if (record.initialPrivacyClass === "contains_secret") return "quarantine";
  if (record.sourceKind === "runtime_report" || record.sourceKind === "debug_trace") return "admit_as_feedback_candidate";
  if (record.sourceKind === "upstream_proposal" || record.sourceKind === "manual_review") return "admit_as_feedback_candidate";
  if (/error|failed|failure|crash|bug|regression|问题|失败|报错/.test(text)) return "admit_as_feedback_candidate";
  if (/agent|goal|create|make|我要|做一个|智能体/.test(text)) return "admit_as_goal_signal";
  return "admit_as_material";
}

function classificationReason(record: InboxItemRecord, context: ClassifyInboxContext): string {
  const parts = [`source=${record.sourceKind}`, `privacy=${record.initialPrivacyClass}`];
  if (context.growStateSummary !== undefined) parts.push("grow state supplied");
  if (context.defaultFeedbackRouterSummary !== undefined) parts.push("default router summary supplied");
  return parts.join("; ");
}

function compact(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= 1_000 ? text : `${text.slice(0, 997)}...`;
}

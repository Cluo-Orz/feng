import { ok, type Result } from "../domain/result.js";
import type { RuntimeContractRef } from "../domain/index.js";
import { runtimeContractEventTypes } from "./events.js";
import { contractErr } from "./errors.js";
import {
  assertMutable,
  compact,
  contractDocument,
  diffContracts,
  matchesQuery,
  newRuntimeContractRef,
  secretContentDetected,
  validateInput
} from "./logic.js";
import { appendContractEvent, ensureGrowUnitWritable } from "./runtime.js";
import type { RuntimeContractRuntime } from "./runtime.js";
import type {
  RuntimeContractDiffSummary,
  RuntimeContractInput,
  RuntimeContractMaterialization,
  RuntimeContractPage,
  RuntimeContractQuery,
  RuntimeContractReceipt,
  RuntimeContractRecord
} from "./types.js";

export function recordContractCandidate(
  runtime: RuntimeContractRuntime,
  input: RuntimeContractInput
): Promise<Result<RuntimeContractRef>> {
  return createContract(runtime, input, "candidate");
}

export function registerRuntimeContract(
  runtime: RuntimeContractRuntime,
  input: RuntimeContractInput
): Promise<Result<RuntimeContractRef>> {
  return createContract(runtime, input, "registered");
}

export function getRuntimeContractRecord(runtime: RuntimeContractRuntime, ref: RuntimeContractRef) {
  return runtime.storage.readContract(ref);
}

export async function listRuntimeContractRecords(
  runtime: RuntimeContractRuntime,
  query: RuntimeContractQuery = {}
): Promise<Result<RuntimeContractPage>> {
  const all = await runtime.storage.readAllContracts();
  if (!all.ok) return all;
  const records = all.value.filter((record) => matchesQuery(record, query));
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

export async function materializeRuntimeContractRecord(
  runtime: RuntimeContractRuntime,
  ref: RuntimeContractRef
): Promise<Result<RuntimeContractMaterialization>> {
  const record = await runtime.storage.readContract(ref);
  if (!record.ok) return record;
  const materialized = await runtime.options.artifactRegistry.materializeArtifact(record.value.artifactRef, {
    reason: "materialize runtime contract",
    maxBytes: 512 * 1024,
    allowArchived: true
  });
  if (!materialized.ok) return materialized;
  if (materialized.value.status !== "available" || typeof materialized.value.content !== "string") {
    return contractErr({ code: "artifact_unavailable", message: "runtime contract artifact is not readable" });
  }
  return ok({
    runtimeContractRef: ref,
    artifactRef: record.value.artifactRef,
    content: materialized.value.content,
    record: record.value
  });
}

export async function addRuntimeContractVersionRecord(
  runtime: RuntimeContractRuntime,
  ref: RuntimeContractRef,
  input: RuntimeContractInput
): Promise<Result<RuntimeContractRef>> {
  const current = await runtime.storage.readContract(ref);
  if (!current.ok) return current;
  const mutable = assertMutable(current.value);
  if (!mutable.ok) return mutable;
  const created = await createContract(runtime, {
    ...input,
    growUnitRef: current.value.growUnitRef,
    evidenceRefs: input.evidenceRefs ?? current.value.evidenceRefs
  }, "registered");
  if (!created.ok) return created;
  const superseded = await transitionContract(runtime, current.value, "superseded", "add runtime contract version");
  if (!superseded.ok) return superseded;
  const next = await runtime.storage.readContract(created.value);
  if (!next.ok) return next;
  const event = await appendContractEvent({
    runtime,
    record: next.value,
    eventType: runtimeContractEventTypes.versionAdded,
    body: { previousRef: ref, nextRef: created.value, version: input.version }
  });
  return event.ok ? ok(created.value) : event;
}

export async function compareRuntimeContractVersionRecords(
  runtime: RuntimeContractRuntime,
  a: RuntimeContractRef,
  b: RuntimeContractRef
): Promise<Result<RuntimeContractDiffSummary>> {
  const left = await runtime.storage.readContract(a);
  if (!left.ok) return left;
  const right = await runtime.storage.readContract(b);
  return right.ok ? ok(diffContracts(left.value, right.value)) : right;
}

export async function deprecateRuntimeContractRecord(
  runtime: RuntimeContractRuntime,
  ref: RuntimeContractRef,
  reason: string
): Promise<Result<RuntimeContractReceipt>> {
  const record = await runtime.storage.readContract(ref);
  return record.ok ? transitionContract(runtime, record.value, "deprecated", reason) : record;
}

export async function retractRuntimeContractRecord(
  runtime: RuntimeContractRuntime,
  ref: RuntimeContractRef,
  reason: string
): Promise<Result<RuntimeContractReceipt>> {
  const record = await runtime.storage.readContract(ref);
  return record.ok ? transitionContract(runtime, record.value, "retracted", reason) : record;
}

export async function transitionContract(
  runtime: RuntimeContractRuntime,
  record: RuntimeContractRecord,
  to: RuntimeContractRecord["lifecycle"],
  reason: string
): Promise<Result<RuntimeContractReceipt>> {
  const from = record.lifecycle;
  const updated = { ...record, lifecycle: to, updatedAt: new Date().toISOString(), recordVersion: record.recordVersion + 1 };
  const write = await runtime.storage.writeContract(updated, reason);
  if (!write.ok) return write;
  const eventType = eventTypeForLifecycle(to);
  const event = await appendContractEvent({
    runtime,
    record: updated,
    eventType,
    body: { runtimeContractRef: record.runtimeContractRef, from, to, reason }
  });
  if (!event.ok) return event;
  return ok({ runtimeContractRef: record.runtimeContractRef, from, to, artifactRef: record.artifactRef, eventReceipt: event.value, recordWriteReceipt: write.value });
}

async function createContract(
  runtime: RuntimeContractRuntime,
  input: RuntimeContractInput,
  lifecycle: RuntimeContractRecord["lifecycle"]
): Promise<Result<RuntimeContractRef>> {
  const valid = validateInput(input);
  if (!valid.ok) return valid;
  const writable = await ensureGrowUnitWritable(runtime, input.growUnitRef);
  if (!writable.ok) return writable;
  const ref = newRuntimeContractRef();
  const now = new Date().toISOString();
  const partial = {
    runtimeContractRef: ref,
    growUnitRef: input.growUnitRef,
    name: compact(input.name, 200),
    version: input.version,
    lifecycle,
    runtimeKernelType: input.runtimeKernelType,
    ...(input.targetWorldSummaryRef === undefined ? {} : { targetWorldSummaryRef: input.targetWorldSummaryRef }),
    shape: input.shape ?? {},
    capabilityRequirements: input.capabilityRequirements ?? [],
    policyDecisionRefs: [],
    evidenceRefs: input.evidenceRefs ?? [],
    ...(input.readinessVerdictRef === undefined ? {} : { readinessVerdictRef: input.readinessVerdictRef }),
    createdAt: now,
    updatedAt: now,
    source: input.source,
    audit: input.audit,
    recordVersion: 1
  } satisfies Omit<RuntimeContractRecord, "artifactRef">;
  const content = contractDocument(partial);
  if (secretContentDetected(content)) return contractErr({ code: "privacy_blocked", message: "runtime contract artifact cannot contain secret material" });
  const artifact = await runtime.options.artifactRegistry.registerArtifact({
    kind: "runtime_contract",
    content,
    mediaType: "application/json",
    encoding: "utf8",
    source: input.source,
    version: input.version,
    audit: input.audit,
    privacyClass: input.source.privacyLevel,
    retentionClass: "hatch_scoped",
    producerModule: "runtime-contract-registry"
  });
  if (!artifact.ok) return artifact;
  const record: RuntimeContractRecord = { ...partial, artifactRef: artifact.value };
  const write = await runtime.storage.writeContract(record, "write runtime contract");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addContract(ref);
  if (!indexed.ok) return indexed;
  const event = await appendContractEvent({
    runtime,
    record,
    eventType: lifecycle === "candidate" ? runtimeContractEventTypes.candidateRecorded : runtimeContractEventTypes.registered,
    body: { runtimeContractRef: ref, lifecycle, runtimeKernelType: record.runtimeKernelType, artifactRef: record.artifactRef }
  });
  return event.ok ? ok(ref) : event;
}

function eventTypeForLifecycle(lifecycle: RuntimeContractRecord["lifecycle"]): string {
  if (lifecycle === "deprecated") return runtimeContractEventTypes.deprecated;
  if (lifecycle === "retracted") return runtimeContractEventTypes.retracted;
  if (lifecycle === "superseded") return runtimeContractEventTypes.superseded;
  if (lifecycle === "incompatible") return runtimeContractEventTypes.incompatible;
  if (lifecycle === "locked_for_hatch") return runtimeContractEventTypes.lockedForHatch;
  if (lifecycle === "validated") return runtimeContractEventTypes.validated;
  return runtimeContractEventTypes.verificationFailed;
}

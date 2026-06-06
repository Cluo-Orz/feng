import { ok, type Result } from "../domain/result.js";
import { targetWorldEventTypes, appendTargetWorldEvent, registerTargetArtifact, type TargetWorldRuntime } from "./runtime.js";
import { targetErr } from "./errors.js";
import {
  activeAdapterMatches,
  newAdapterRef,
  newTargetWorldRef,
  pageRecords,
  validateAdapterInput,
  validateTargetWorldInput
} from "./logic.js";
import type {
  AdapterLifecycle,
  AdapterQuery,
  TargetWorldAdapterDefinition,
  TargetWorldAdapterInput,
  TargetWorldAdapterRef,
  TargetWorldDescriptor,
  TargetWorldDescriptorInput,
  TargetWorldPage
} from "./types.js";

export async function registerTargetWorldRecord(
  runtime: TargetWorldRuntime,
  input: TargetWorldDescriptorInput
): Promise<Result<TargetWorldDescriptor["targetWorldRef"]>> {
  const valid = validateTargetWorldInput(input);
  if (!valid.ok) return valid;
  const ref = newTargetWorldRef();
  const now = new Date().toISOString();
  const summary = await registerTargetArtifact({
    runtime,
    kind: "summary",
    content: {
      targetWorldRef: ref,
      name: input.name,
      kind: input.kind,
      inputKinds: input.inputKinds,
      outputKinds: input.outputKinds,
      actionKinds: input.actionKinds,
      privacyBoundary: input.privacyBoundary
    },
    privacyClass: input.privacyBoundary,
    source: input.source,
    audit: input.audit
  });
  if (!summary.ok) return summary;
  const record: TargetWorldDescriptor = {
    ...input,
    targetWorldId: ref.id,
    targetWorldRef: ref,
    summaryArtifactRef: summary.value,
    createdAt: now,
    updatedAt: now,
    recordVersion: 1
  };
  const write = await runtime.storage.writeTargetWorld(record, "write target world descriptor");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addTargetWorld(ref);
  if (!indexed.ok) return indexed;
  const event = await appendTargetWorldEvent({
    runtime,
    targetWorldRef: ref,
    eventType: targetWorldEventTypes.targetWorldRegistered,
    body: { targetWorldRef: ref, kind: input.kind, inputKinds: input.inputKinds, outputKinds: input.outputKinds },
    source: input.source,
    audit: input.audit
  });
  return event.ok ? ok(ref) : event;
}

export function getTargetWorldRecord(runtime: TargetWorldRuntime, ref: TargetWorldDescriptor["targetWorldRef"]) {
  return runtime.storage.readTargetWorld(ref);
}

export async function registerAdapterRecord(
  runtime: TargetWorldRuntime,
  input: TargetWorldAdapterInput
): Promise<Result<TargetWorldAdapterRef>> {
  const valid = validateAdapterInput(input);
  if (!valid.ok) return valid;
  const target = await runtime.storage.readTargetWorld(input.targetWorldRef);
  if (!target.ok) return target;
  if (!input.supportedInputKinds.every((kind) => target.value.inputKinds.includes(kind))) {
    return targetErr({ code: "adapter_incompatible", message: "adapter declares input kinds outside target world boundary" });
  }
  if (!input.supportedOutputKinds.every((kind) => target.value.outputKinds.includes(kind))) {
    return targetErr({ code: "adapter_incompatible", message: "adapter declares output kinds outside target world boundary" });
  }
  const ref = newAdapterRef();
  const now = new Date().toISOString();
  const record: TargetWorldAdapterDefinition = {
    ...input,
    adapterId: ref.id,
    adapterRef: ref,
    lifecycle: "registered",
    createdAt: now,
    updatedAt: now,
    recordVersion: 1
  };
  const write = await runtime.storage.writeAdapter(record, "write target world adapter");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addAdapter(ref);
  if (!indexed.ok) return indexed;
  const event = await appendTargetWorldEvent({
    runtime,
    targetWorldRef: input.targetWorldRef,
    eventType: targetWorldEventTypes.adapterRegistered,
    body: { adapterRef: ref, targetWorldRef: input.targetWorldRef, kernelTypes: input.supportedRuntimeKernelTypes },
    source: input.source,
    audit: input.audit
  });
  return event.ok ? ok(ref) : event;
}

export async function listAdapterRecords(
  runtime: TargetWorldRuntime,
  query: AdapterQuery = {}
): Promise<Result<TargetWorldPage<TargetWorldAdapterDefinition>>> {
  const all = await runtime.storage.readAllAdapters();
  if (!all.ok) return all;
  return ok(pageRecords(all.value.filter((record) => activeAdapterMatches(record, query)), query.limit, query.cursor));
}

export async function changeAdapterLifecycleRecord(
  runtime: TargetWorldRuntime,
  ref: TargetWorldAdapterRef,
  lifecycle: AdapterLifecycle,
  reason: string
): Promise<Result<TargetWorldAdapterDefinition>> {
  const record = await runtime.storage.readAdapter(ref);
  if (!record.ok) return record;
  if (record.value.lifecycle === lifecycle) return targetErr({ code: "lifecycle_conflict", message: "adapter is already in requested lifecycle" });
  const updated = {
    ...record.value,
    lifecycle,
    updatedAt: new Date().toISOString(),
    recordVersion: record.value.recordVersion + 1
  };
  const write = await runtime.storage.writeAdapter(updated, reason);
  if (!write.ok) return write;
  const event = await appendTargetWorldEvent({
    runtime,
    targetWorldRef: updated.targetWorldRef,
    eventType: targetWorldEventTypes.adapterLifecycleChanged,
    body: { adapterRef: ref, from: record.value.lifecycle, to: lifecycle, reason },
    source: updated.source,
    audit: { ...updated.audit, reason }
  });
  return event.ok ? ok(updated) : event;
}

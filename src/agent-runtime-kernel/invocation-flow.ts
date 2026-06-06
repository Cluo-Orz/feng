import { ok, type ArtifactRef, type Result } from "../domain/index.js";
import type { HatchPackageRecord } from "../hatch-builder/index.js";
import type { RuntimeContractRecord } from "../runtime-contract-registry/index.js";
import { runtimeErr } from "./errors.js";
import {
  ensureRunnableContract,
  ensureRunnablePackage,
  mutateInvocation,
  newInvocationRef,
  newLongTermMemoryReadRef,
  newShortTermContextRef,
  packageResourceHashes,
  terminalInvocationStatus
} from "./logic.js";
import { appendRuntimeEvent, runtimeEventTypes, type AgentRuntime } from "./runtime.js";
import { recordRuntimeTraceRecord } from "./trace-flow.js";
import type {
  LongTermMemoryRead,
  ProductionVersionLock,
  RuntimeInvocation,
  RuntimeInvocationExplanation,
  RuntimeInvocationReceipt,
  ShortTermContext,
  StartRuntimeInvocationInput
} from "./types.js";
import type { RuntimeInvocationRef } from "./refs.js";

export async function startRuntimeInvocationRecord(
  runtime: AgentRuntime,
  input: StartRuntimeInvocationInput
): Promise<Result<RuntimeInvocationRef>> {
  const loaded = await loadAndValidateStart(runtime, input);
  if (!loaded.ok) return loaded;
  const compatibility = await runtime.options.targetWorldAdapter.checkRuntimeContractCompatibility(
    loaded.value.contract.runtimeContractRef,
    input.targetWorldRef
  );
  if (!compatibility.ok) return compatibility;
  if (!compatibility.value.compatible) {
    return runtimeErr({ code: "adapter_incompatible", message: compatibility.value.blockers.join("; ") || "target world is incompatible" });
  }
  const contextRef = newShortTermContextRef();
  const invocationRef = newInvocationRef();
  const memoryReads = await recordMemoryReads(runtime, input, loaded.value.packageRecord, loaded.value.contract);
  if (!memoryReads.ok) return memoryReads;
  const now = new Date().toISOString();
  const invocation: RuntimeInvocation = {
    runtimeInvocationId: invocationRef.id,
    runtimeInvocationRef: invocationRef,
    hatchPackageRef: input.hatchPackageRef,
    runtimeContractRef: loaded.value.contract.runtimeContractRef,
    targetWorldRef: input.targetWorldRef,
    mode: input.mode,
    status: "running",
    worldInputRefs: [],
    runtimeMessageListRefs: [],
    llmRequestRefs: [],
    providerReceiptRefs: [],
    toolSettlementRefs: [],
    targetActionRequestRefs: [],
    runtimeOutputRefs: [],
    feedbackCandidateHintRefs: [],
    shortTermContextRef: contextRef,
    longTermMemoryReadRefs: memoryReads.value.map((item) => item.memoryReadRef),
    modelSelection: input.modelSelection,
    requiredCapabilities: input.requiredCapabilities ?? {},
    ...(input.toolCatalogQuery === undefined ? {} : { toolCatalogQuery: input.toolCatalogQuery }),
    ...(input.mode === "production" ? { productionLock: loaded.value.productionLock } : {}),
    maxTurns: Math.max(1, input.maxTurns ?? 16),
    startedAt: now,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    source: input.source,
    version: input.version,
    audit: input.audit,
    recordVersion: 1
  };
  const context: ShortTermContext = {
    shortTermContextId: contextRef.id,
    shortTermContextRef: contextRef,
    runtimeInvocationRef: invocationRef,
    turnRefs: [],
    worldInputRefs: [],
    runtimeOutputRefs: [],
    toolSettlementRefs: [],
    targetActionRefs: [],
    summary: "No runtime turns have completed.",
    retentionPolicy: "invocation_scoped",
    source: input.source,
    audit: input.audit,
    updatedAt: now,
    recordVersion: 1
  };
  const writeContext = await runtime.storage.writeShortTermContext(context, "create short term context");
  if (!writeContext.ok) return writeContext;
  const addContext = await runtime.storage.addShortTermContext(contextRef);
  if (!addContext.ok) return addContext;
  const writeInvocation = await runtime.storage.writeInvocation(invocation, "start runtime invocation");
  if (!writeInvocation.ok) return writeInvocation;
  const addInvocation = await runtime.storage.addInvocation(invocationRef);
  if (!addInvocation.ok) return addInvocation;
  const event = await appendRuntimeEvent({
    runtime,
    invocationRef,
    eventType: runtimeEventTypes.invocationStarted,
    body: { invocationRef, hatchPackageRef: input.hatchPackageRef, runtimeContractRef: invocation.runtimeContractRef, targetWorldRef: input.targetWorldRef, mode: input.mode },
    source: input.source,
    audit: input.audit,
    correlationId: input.correlationId
  });
  return event.ok ? ok(invocationRef) : event;
}

export async function completeRuntimeInvocationRecord(
  runtime: AgentRuntime,
  ref: RuntimeInvocationRef,
  reason: string
): Promise<Result<RuntimeInvocationReceipt>> {
  return finishInvocation(runtime, ref, "completed", reason, runtimeEventTypes.invocationCompleted);
}

export async function cancelRuntimeInvocationRecord(
  runtime: AgentRuntime,
  ref: RuntimeInvocationRef,
  reason: string
): Promise<Result<RuntimeInvocationReceipt>> {
  return finishInvocation(runtime, ref, "cancelled", reason, runtimeEventTypes.invocationCancelled);
}

export async function explainRuntimeInvocationRecord(
  runtime: AgentRuntime,
  ref: RuntimeInvocationRef
): Promise<Result<RuntimeInvocationExplanation>> {
  const record = await runtime.storage.readInvocation(ref);
  if (!record.ok) return record;
  return ok({
    runtimeInvocationRef: ref,
    summary: `${record.value.mode} ${record.value.status}`,
    facts: [
      `hatchPackage=${record.value.hatchPackageRef.id}`,
      `runtimeContract=${record.value.runtimeContractRef.id}`,
      `targetWorld=${record.value.targetWorldRef.id}`,
      `messageLists=${record.value.runtimeMessageListRefs.length}`,
      `providerReceipts=${record.value.providerReceiptRefs.length}`,
      `toolSettlements=${record.value.toolSettlementRefs.length}`,
      `targetActions=${record.value.targetActionRequestRefs.length}`,
      `outputs=${record.value.runtimeOutputRefs.length}`,
      `feedbackHints=${record.value.feedbackCandidateHintRefs.length}`
    ],
    ...(record.value.runtimeTraceRef === undefined ? {} : { traceRef: record.value.runtimeTraceRef })
  });
}

async function loadAndValidateStart(runtime: AgentRuntime, input: StartRuntimeInvocationInput): Promise<Result<{
  readonly packageRecord: HatchPackageRecord;
  readonly contract: RuntimeContractRecord;
  readonly productionLock?: ProductionVersionLock;
}>> {
  const packageRecord = await runtime.options.hatchBuilder.getHatchPackage(input.hatchPackageRef);
  if (!packageRecord.ok) return packageRecord;
  const packageOk = ensureRunnablePackage(packageRecord.value, input.mode === "production");
  if (!packageOk.ok) return packageOk;
  const contract = await runtime.options.runtimeContractRegistry.getRuntimeContract(packageRecord.value.runtimeContractRef);
  if (!contract.ok) return contract;
  const contractOk = ensureRunnableContract(contract.value, packageRecord.value);
  if (!contractOk.ok) return contractOk;
  const lock = input.mode === "production"
    ? await buildProductionLock(runtime, packageRecord.value)
    : ok(undefined);
  return lock.ok ? ok({ packageRecord: packageRecord.value, contract: contract.value, ...(lock.value === undefined ? {} : { productionLock: lock.value }) }) : lock;
}

async function buildProductionLock(runtime: AgentRuntime, record: HatchPackageRecord): Promise<Result<ProductionVersionLock>> {
  const refs = [record.artifactRef, record.manifestRef, ...record.includedResourceRefs];
  const hashes: string[] = [];
  for (const ref of refs) {
    const artifact = await runtime.options.artifactRegistry.resolveArtifact(ref);
    if (!artifact.ok) return artifact;
    if (artifact.value.contentHash === undefined) {
      return runtimeErr({ code: "production_lock_violation", message: `package resource ${ref.id} has no content hash` });
    }
    hashes.push(`${ref.id}:${artifact.value.contentHash}`);
  }
  return ok({
    hatchPackageRef: record.hatchPackageRef,
    runtimeContractRef: record.runtimeContractRef,
    runtimeKernelVersion: runtime.kernelVersion,
    packageResourceHashes: packageResourceHashes(record, refs).concat(hashes).sort(),
    skillVersionSummaries: [],
    lockedAt: new Date().toISOString()
  });
}

async function recordMemoryReads(
  runtime: AgentRuntime,
  input: StartRuntimeInvocationInput,
  packageRecord: HatchPackageRecord,
  contract: RuntimeContractRecord
): Promise<Result<readonly LongTermMemoryRead[]>> {
  const refs = input.longTermMemoryArtifactRefs ?? [];
  const allowed = new Set([
    ...packageRecord.includedResourceRefs.map((ref) => ref.id),
    ...contract.evidenceRefs.map((ref) => ref.id)
  ]);
  const records: LongTermMemoryRead[] = [];
  for (const artifactRef of refs) {
    if (!allowed.has(artifactRef.id)) {
      return runtimeErr({ code: "invalid_input", message: `long term memory ${artifactRef.id} is not packaged or accepted contract material` });
    }
    const memoryReadRef = newLongTermMemoryReadRef();
    const record: LongTermMemoryRead = {
      memoryReadId: memoryReadRef.id,
      memoryReadRef,
      hatchPackageRef: input.hatchPackageRef,
      runtimeContractRef: contract.runtimeContractRef,
      sourceArtifactRefs: [artifactRef],
      scope: "hatch_package_or_locked_contract",
      summary: `Read accepted runtime memory ${artifactRef.id}`,
      source: input.source,
      audit: input.audit,
      createdAt: new Date().toISOString()
    };
    const written = await runtime.storage.writeMemoryRead(record, "record long term memory read");
    if (!written.ok) return written;
    const indexed = await runtime.storage.addMemoryRead(memoryReadRef);
    if (!indexed.ok) return indexed;
    records.push(record);
  }
  return ok(records);
}

async function finishInvocation(
  runtime: AgentRuntime,
  ref: RuntimeInvocationRef,
  status: "completed" | "cancelled",
  reason: string,
  eventType: string
): Promise<Result<RuntimeInvocationReceipt>> {
  const record = await runtime.storage.readInvocation(ref);
  if (!record.ok) return record;
  if (terminalInvocationStatus(record.value.status)) {
    return runtimeErr({ code: "invalid_state", message: `runtime invocation is already ${record.value.status}` });
  }
  const trace = await recordRuntimeTraceRecord(runtime, ref);
  if (!trace.ok) return trace;
  const next = mutateInvocation(record.value, {
    status,
    runtimeTraceRef: trace.value,
    completedAt: new Date().toISOString()
  });
  const written = await runtime.storage.writeInvocation(next, `mark runtime invocation ${status}`);
  if (!written.ok) return written;
  const event = await appendRuntimeEvent({
    runtime,
    invocationRef: ref,
    eventType,
    body: { invocationRef: ref, reason, traceRef: trace.value },
    source: next.source,
    audit: next.audit,
    correlationId: next.correlationId
  });
  return event.ok
    ? ok({ runtimeInvocationRef: ref, from: record.value.status, to: status, reason, traceRef: trace.value, recordWriteReceipt: written.value, eventReceipt: event.value })
    : event;
}

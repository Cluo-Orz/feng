import { ok, type Result } from "../domain/result.js";
import type { RuntimeInvocationRef, RuntimeTraceRef } from "../agent-runtime-kernel/index.js";
import type { TargetDebugSignalRef } from "../target-world-adapter/index.js";
import { debugBridgeEventTypes } from "./events.js";
import { bridgeErr } from "./errors.js";
import { newCorrelationRef } from "./logic.js";
import { appendBridgeEvent, type DebugBridgeRuntime } from "./runtime.js";
import type { BridgeReceipt, OpenDebugCorrelationInput } from "./ports.js";
import type {
  CorrelationStatus,
  DebugCorrelation,
  DebugCorrelationRef
} from "./types.js";

export async function openDebugCorrelationRecord(
  runtime: DebugBridgeRuntime,
  input: OpenDebugCorrelationInput
): Promise<Result<DebugCorrelationRef>> {
  const pkg = await runtime.options.hatchBuilder.getHatchPackage(input.hatchPackageRef);
  if (!pkg.ok) return pkg;
  const contract = await runtime.options.runtimeContractRegistry.getRuntimeContract(input.runtimeContractRef);
  if (!contract.ok) return contract;
  if (pkg.value.runtimeContractRef.id !== input.runtimeContractRef.id) {
    return bridgeErr({ code: "contract_incompatible", message: "correlation package and runtime contract do not match" });
  }
  if (contract.value.shape.debug === undefined) {
    return bridgeErr({ code: "contract_incompatible", message: "runtime contract declares no debug contract for debug correlation" });
  }
  if (input.targetWorldRef !== undefined) {
    const world = await runtime.options.targetWorldAdapter.getTargetWorld(input.targetWorldRef);
    if (!world.ok) return world;
  }
  const ref = newCorrelationRef();
  const now = new Date().toISOString();
  const record: DebugCorrelation = {
    debugCorrelationId: ref.id,
    debugCorrelationRef: ref,
    originGrowUnitRef: input.originGrowUnitRef,
    ...(input.targetGrowUnitRef === undefined ? {} : { targetGrowUnitRef: input.targetGrowUnitRef }),
    hatchPackageRef: input.hatchPackageRef,
    runtimeContractRef: input.runtimeContractRef,
    ...(input.targetWorldRef === undefined ? {} : { targetWorldRef: input.targetWorldRef }),
    runtimeInvocationRefs: [],
    runtimeTraceRefs: [],
    debugSignalRefs: [],
    feedbackHintRefs: [],
    envelopeRefs: [],
    mode: input.mode,
    status: "created",
    privacyBoundary: input.privacyBoundary,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
    createdAt: now,
    updatedAt: now,
    source: input.source,
    audit: input.audit,
    recordVersion: 1
  };
  const write = await runtime.storage.writeCorrelation(record, "write debug correlation");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addCorrelation(ref);
  if (!indexed.ok) return indexed;
  const event = await appendBridgeEvent({
    runtime,
    correlationRef: ref,
    eventType: debugBridgeEventTypes.correlationOpened,
    body: { debugCorrelationRef: ref, mode: input.mode, originGrowUnitRef: input.originGrowUnitRef },
    source: input.source,
    audit: input.audit,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId })
  });
  return event.ok ? ok(ref) : event;
}

async function mutateCorrelation(
  runtime: DebugBridgeRuntime,
  ref: DebugCorrelationRef,
  eventType: string,
  reason: string,
  apply: (record: DebugCorrelation) => DebugCorrelation
): Promise<Result<BridgeReceipt>> {
  const current = await runtime.storage.readCorrelation(ref);
  if (!current.ok) return current;
  if (current.value.status === "closed" || current.value.status === "archived") {
    return bridgeErr({ code: "invalid_state", message: "debug correlation is closed" });
  }
  const next = apply(current.value);
  const write = await runtime.storage.writeCorrelation(next, reason);
  if (!write.ok) return write;
  const event = await appendBridgeEvent({
    runtime,
    correlationRef: ref,
    eventType,
    body: { debugCorrelationRef: ref, status: next.status },
    source: current.value.source,
    audit: current.value.audit,
    ...(current.value.correlationId === undefined ? {} : { correlationId: current.value.correlationId })
  });
  if (!event.ok) return event;
  return ok({ debugCorrelationRef: ref, status: next.status, eventReceipt: event.value, recordWriteReceipt: write.value });
}

export function linkRuntimeInvocationRecord(
  runtime: DebugBridgeRuntime,
  ref: DebugCorrelationRef,
  invocationRef: RuntimeInvocationRef
): Promise<Result<BridgeReceipt>> {
  return mutateCorrelation(runtime, ref, debugBridgeEventTypes.correlationLinkedRuntime, "link runtime invocation", (record) => ({
    ...record,
    runtimeInvocationRefs: appendUnique(record.runtimeInvocationRefs, invocationRef),
    status: collecting(record.status),
    updatedAt: new Date().toISOString()
  }));
}

export function linkRuntimeTraceRecord(
  runtime: DebugBridgeRuntime,
  ref: DebugCorrelationRef,
  traceRef: RuntimeTraceRef
): Promise<Result<BridgeReceipt>> {
  return mutateCorrelation(runtime, ref, debugBridgeEventTypes.correlationLinkedTrace, "link runtime trace", (record) => ({
    ...record,
    runtimeTraceRefs: appendUnique(record.runtimeTraceRefs, traceRef),
    status: collecting(record.status),
    updatedAt: new Date().toISOString()
  }));
}

export function linkDebugSignalRecord(
  runtime: DebugBridgeRuntime,
  ref: DebugCorrelationRef,
  signalRef: TargetDebugSignalRef
): Promise<Result<BridgeReceipt>> {
  return mutateCorrelation(runtime, ref, debugBridgeEventTypes.correlationLinkedSignal, "link debug signal", (record) => ({
    ...record,
    debugSignalRefs: appendUnique(record.debugSignalRefs, signalRef),
    status: collecting(record.status),
    updatedAt: new Date().toISOString()
  }));
}

export function closeDebugCorrelationRecord(
  runtime: DebugBridgeRuntime,
  ref: DebugCorrelationRef,
  reason: string
): Promise<Result<BridgeReceipt>> {
  return mutateCorrelation(runtime, ref, debugBridgeEventTypes.correlationClosed, reason, (record) => ({
    ...record,
    status: "closed",
    closedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }));
}

function collecting(status: CorrelationStatus): CorrelationStatus {
  return status === "created" ? "collecting" : status;
}

function appendUnique<T extends { readonly id: string }>(existing: readonly T[], ref: T): readonly T[] {
  return existing.some((item) => item.id === ref.id) ? existing : [...existing, ref];
}

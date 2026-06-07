import { ok, type Result } from "../domain/result.js";
import type { ArtifactRef, PrivacyLevel } from "../domain/index.js";
import type {
  RuntimeFeedbackCandidateHint,
  RuntimeFeedbackCandidateHintRef,
  RuntimeTraceRef
} from "../agent-runtime-kernel/index.js";
import type { TargetDebugSignalRef } from "../target-world-adapter/index.js";
import { debugBridgeEventTypes } from "./events.js";
import { bridgeErr } from "./errors.js";
import { bounded, newEnvelopeRef } from "./logic.js";
import { appendBridgeEvent, type DebugBridgeRuntime } from "./runtime.js";
import type { ManualObservationInput } from "./ports.js";
import type {
  BridgeLayer,
  DebugCorrelation,
  DebugCorrelationRef,
  ReportSourceKind,
  RuntimeReportEnvelope,
  RuntimeReportEnvelopeRef
} from "./types.js";

interface EnvelopeDraft {
  readonly sourceKind: ReportSourceKind;
  readonly summary: string;
  readonly privacyClass: PrivacyLevel;
  readonly sourceLayer: BridgeLayer;
  readonly targetLayerHint: BridgeLayer;
  readonly attributionHint: string;
  readonly evidenceRefs: readonly ArtifactRef[];
  readonly runtimeTraceRef?: RuntimeTraceRef;
  readonly debugSignalRef?: TargetDebugSignalRef;
  readonly feedbackHintRef?: RuntimeFeedbackCandidateHintRef;
}

async function readActiveCorrelation(
  runtime: DebugBridgeRuntime,
  ref: DebugCorrelationRef
): Promise<Result<DebugCorrelation>> {
  const current = await runtime.storage.readCorrelation(ref);
  if (!current.ok) return current;
  if (current.value.status === "closed" || current.value.status === "archived") {
    return bridgeErr({ code: "invalid_state", message: "debug correlation is closed" });
  }
  return current;
}

async function createEnvelope(
  runtime: DebugBridgeRuntime,
  correlation: DebugCorrelation,
  draft: EnvelopeDraft,
  linkCorrelation: (record: DebugCorrelation) => DebugCorrelation
): Promise<Result<RuntimeReportEnvelopeRef>> {
  const ref = newEnvelopeRef();
  const record: RuntimeReportEnvelope = {
    runtimeReportId: ref.id,
    runtimeReportRef: ref,
    debugCorrelationRef: correlation.debugCorrelationRef,
    sourceKind: draft.sourceKind,
    ...(draft.runtimeTraceRef === undefined ? {} : { runtimeTraceRef: draft.runtimeTraceRef }),
    ...(draft.debugSignalRef === undefined ? {} : { debugSignalRef: draft.debugSignalRef }),
    ...(draft.feedbackHintRef === undefined ? {} : { feedbackHintRef: draft.feedbackHintRef }),
    summary: bounded(draft.summary, 2_000),
    evidenceRefs: draft.evidenceRefs,
    privacyClass: draft.privacyClass,
    sourceLayer: draft.sourceLayer,
    targetLayerHint: draft.targetLayerHint,
    attributionHint: bounded(draft.attributionHint, 500),
    receivedAt: new Date().toISOString(),
    source: correlation.source,
    audit: correlation.audit,
    recordVersion: 1
  };
  const write = await runtime.storage.writeEnvelope(record, "write runtime report envelope");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addEnvelope(ref);
  if (!indexed.ok) return indexed;
  const nextCorrelation: DebugCorrelation = {
    ...linkCorrelation(correlation),
    envelopeRefs: appendUnique(correlation.envelopeRefs, ref),
    status: correlation.status === "created" || correlation.status === "collecting" ? "normalized" : correlation.status,
    updatedAt: new Date().toISOString()
  };
  const updated = await runtime.storage.writeCorrelation(nextCorrelation, "link runtime report envelope");
  if (!updated.ok) return updated;
  const event = await appendBridgeEvent({
    runtime,
    correlationRef: correlation.debugCorrelationRef,
    eventType: debugBridgeEventTypes.runtimeReportEnvelopeCreated,
    body: { runtimeReportRef: ref, sourceKind: draft.sourceKind, privacyClass: draft.privacyClass },
    source: correlation.source,
    audit: correlation.audit,
    ...(correlation.correlationId === undefined ? {} : { correlationId: correlation.correlationId })
  });
  return event.ok ? ok(ref) : event;
}

export async function ingestRuntimeTraceRecord(
  runtime: DebugBridgeRuntime,
  ref: DebugCorrelationRef,
  traceRef: RuntimeTraceRef
): Promise<Result<RuntimeReportEnvelopeRef>> {
  const correlation = await readActiveCorrelation(runtime, ref);
  if (!correlation.ok) return correlation;
  const trace = await runtime.options.agentRuntimeKernel.readRuntimeTrace(traceRef);
  let privacyClass: PrivacyLevel = correlation.value.privacyBoundary;
  let evidenceRefs: readonly ArtifactRef[] = [];
  let summary = `runtime trace ${traceRef.id}`;
  if (trace.ok) {
    privacyClass = trace.value.privacyClass;
    evidenceRefs = [trace.value.artifactRef];
    summary = `runtime trace with ${trace.value.turnRefs.length} turns and ${trace.value.debugSignalRefs.length} debug signals`;
  } else if (trace.error.code === "not_found" || trace.error.code === "runtime_trace_unavailable") {
    return bridgeErr({ code: "runtime_trace_unavailable", message: "runtime trace is unavailable for ingest" });
  } else if (trace.error.code !== "privacy_blocked") {
    return trace;
  }
  return createEnvelope(runtime, correlation.value, {
    sourceKind: "runtime_trace",
    summary,
    privacyClass,
    sourceLayer: "runtime_kernel",
    targetLayerHint: "runtime_kernel",
    attributionHint: "runtime trace produced by agent runtime kernel",
    evidenceRefs,
    runtimeTraceRef: traceRef
  }, (record) => ({
    ...record,
    runtimeTraceRefs: appendUnique(record.runtimeTraceRefs, traceRef)
  }));
}

export async function ingestTargetDebugSignalRecord(
  runtime: DebugBridgeRuntime,
  ref: DebugCorrelationRef,
  signalRef: TargetDebugSignalRef
): Promise<Result<RuntimeReportEnvelopeRef>> {
  const correlation = await readActiveCorrelation(runtime, ref);
  if (!correlation.ok) return correlation;
  const signal = await runtime.options.targetWorldAdapter.getTargetDebugSignal(signalRef);
  if (!signal.ok) return signal;
  return createEnvelope(runtime, correlation.value, {
    sourceKind: "target_debug_signal",
    summary: signal.value.summary,
    privacyClass: signal.value.privacyClass,
    sourceLayer: "target_world_adapter",
    targetLayerHint: "target_world_adapter",
    attributionHint: signal.value.feedbackCandidateHint ?? "target world debug signal",
    evidenceRefs: [signal.value.artifactRef],
    debugSignalRef: signalRef
  }, (record) => ({
    ...record,
    debugSignalRefs: appendUnique(record.debugSignalRefs, signalRef)
  }));
}

export async function ingestRuntimeFeedbackHintRecord(
  runtime: DebugBridgeRuntime,
  ref: DebugCorrelationRef,
  hintRef: RuntimeFeedbackCandidateHintRef
): Promise<Result<RuntimeReportEnvelopeRef>> {
  const correlation = await readActiveCorrelation(runtime, ref);
  if (!correlation.ok) return correlation;
  if (correlation.value.runtimeInvocationRefs.length === 0) {
    return bridgeErr({ code: "invalid_state", message: "link a runtime invocation before ingesting feedback hint" });
  }
  const hint = await findHint(runtime, correlation.value, hintRef);
  if (!hint.ok) return hint;
  return createEnvelope(runtime, correlation.value, {
    sourceKind: "runtime_feedback_hint",
    summary: hint.value.summary,
    privacyClass: hint.value.privacyClass,
    sourceLayer: "target_agent_project",
    targetLayerHint: "current_project",
    attributionHint: hint.value.attributionHint,
    evidenceRefs: hint.value.evidenceRefs,
    feedbackHintRef: hintRef
  }, (record) => ({
    ...record,
    feedbackHintRefs: appendUnique(record.feedbackHintRefs, hintRef)
  }));
}

export async function ingestManualObservationRecord(
  runtime: DebugBridgeRuntime,
  ref: DebugCorrelationRef,
  input: ManualObservationInput
): Promise<Result<RuntimeReportEnvelopeRef>> {
  const correlation = await readActiveCorrelation(runtime, ref);
  if (!correlation.ok) return correlation;
  if (input.summary.trim().length === 0) {
    return bridgeErr({ code: "invalid_input", message: "manual observation requires a summary" });
  }
  return createEnvelope(runtime, correlation.value, {
    sourceKind: "manual_observation",
    summary: input.summary,
    privacyClass: input.privacyClass,
    sourceLayer: input.sourceLayer ?? "current_project",
    targetLayerHint: input.targetLayerHint ?? "current_project",
    attributionHint: input.attributionHint ?? "manual debugging observation",
    evidenceRefs: input.evidenceRefs ?? []
  }, (record) => record);
}

async function findHint(
  runtime: DebugBridgeRuntime,
  correlation: DebugCorrelation,
  hintRef: RuntimeFeedbackCandidateHintRef
): Promise<Result<RuntimeFeedbackCandidateHint>> {
  for (const invocationRef of correlation.runtimeInvocationRefs) {
    const hints = await runtime.options.agentRuntimeKernel.listFeedbackCandidateHints(invocationRef);
    if (!hints.ok) return hints;
    const match = hints.value.records.find((record) => record.hintRef.id === hintRef.id);
    if (match !== undefined) return ok(match);
  }
  return bridgeErr({ code: "not_found", message: "runtime feedback candidate hint not found for correlation" });
}

function appendUnique<T extends { readonly id: string }>(existing: readonly T[], ref: T): readonly T[] {
  return existing.some((item) => item.id === ref.id) ? existing : [...existing, ref];
}

import { ok, type ArtifactRef, type Result } from "../domain/index.js";
import { runtimeErr } from "./errors.js";
import {
  mutateInvocation,
  newFeedbackHintRef,
  newRuntimeTraceRef,
  stableHash,
  uniqueRefs
} from "./logic.js";
import {
  appendRuntimeEvent,
  appendTraceEvent,
  evaluateRuntimePolicy,
  policyAllows,
  registerRuntimeArtifact,
  runtimeEventTypes,
  type AgentRuntime
} from "./runtime.js";
import type {
  RuntimeFeedbackCandidateHint,
  RuntimeFeedbackCandidateHintPage,
  RuntimeTrace
} from "./types.js";
import type {
  RuntimeFeedbackCandidateHintRef,
  RuntimeInvocationRef,
  RuntimeTraceRef
} from "./refs.js";
import type { PolicyContext } from "../policy-boundary/index.js";

export async function recordRuntimeTraceRecord(
  runtime: AgentRuntime,
  invocationRef: RuntimeInvocationRef
): Promise<Result<RuntimeTraceRef>> {
  const invocation = await runtime.storage.readInvocation(invocationRef);
  if (!invocation.ok) return invocation;
  const parentRefs = await traceParentArtifacts(runtime, invocation.value);
  if (!parentRefs.ok) return parentRefs;
  const turnRefs = await readTurnRefs(runtime, invocation.value.runtimeMessageListRefs);
  const traceRef = newRuntimeTraceRef();
  const content = {
    runtimeTraceRef: traceRef,
    runtimeInvocationRef: invocationRef,
    hatchPackageRef: invocation.value.hatchPackageRef,
    runtimeContractRef: invocation.value.runtimeContractRef,
    targetWorldRef: invocation.value.targetWorldRef,
    turnRefs,
    providerReceiptRefs: invocation.value.providerReceiptRefs,
    toolSettlementRefs: invocation.value.toolSettlementRefs,
    targetActionRequestRefs: invocation.value.targetActionRequestRefs,
    runtimeOutputRefs: invocation.value.runtimeOutputRefs,
    mode: invocation.value.mode,
    status: invocation.value.status
  };
  const artifact = await registerRuntimeArtifact({
    runtime,
    kind: "runtime_trace",
    content,
    privacyClass: invocation.value.mode === "debug" ? "contains_user_content" : "workspace_private",
    source: invocation.value.source,
    version: invocation.value.version,
    audit: invocation.value.audit,
    parentRefs: parentRefs.value,
    correlationId: invocation.value.correlationId
  });
  if (!artifact.ok) return artifact;
  const now = new Date().toISOString();
  const record: RuntimeTrace = {
    runtimeTraceId: traceRef.id,
    runtimeTraceRef: traceRef,
    runtimeInvocationRef: invocationRef,
    hatchPackageRef: invocation.value.hatchPackageRef,
    runtimeContractRef: invocation.value.runtimeContractRef,
    targetWorldRef: invocation.value.targetWorldRef,
    turnRefs,
    runtimeMessageListRefs: invocation.value.runtimeMessageListRefs,
    providerReceiptRefs: invocation.value.providerReceiptRefs,
    toolSettlementRefs: invocation.value.toolSettlementRefs,
    targetActionRequestRefs: invocation.value.targetActionRequestRefs,
    runtimeOutputRefs: invocation.value.runtimeOutputRefs,
    debugSignalRefs: [],
    failureMappingRefs: [],
    artifactRef: artifact.value,
    contentHash: stableHash(content),
    privacyClass: invocation.value.mode === "debug" ? "contains_user_content" : "workspace_private",
    source: invocation.value.source,
    audit: invocation.value.audit,
    createdAt: now,
    recordVersion: 1
  };
  const written = await runtime.storage.writeTrace(record, "write runtime trace");
  if (!written.ok) return written;
  const indexed = await runtime.storage.addTrace(traceRef);
  if (!indexed.ok) return indexed;
  const nextInvocation = mutateInvocation(invocation.value, { runtimeTraceRef: traceRef });
  const update = await runtime.storage.writeInvocation(nextInvocation, "link latest runtime trace");
  if (!update.ok) return update;
  const traceEvent = await appendTraceEvent({
    runtime,
    traceRef,
    eventType: runtimeEventTypes.traceRegistered,
    body: { traceRef, artifactRef: artifact.value, invocationRef },
    source: invocation.value.source,
    audit: invocation.value.audit,
    correlationId: invocation.value.correlationId
  });
  if (!traceEvent.ok) return traceEvent;
  const event = await appendRuntimeEvent({
    runtime,
    invocationRef,
    eventType: runtimeEventTypes.traceRegistered,
    body: { traceRef, artifactRef: artifact.value },
    source: invocation.value.source,
    audit: invocation.value.audit,
    correlationId: invocation.value.correlationId
  });
  return event.ok ? ok(traceRef) : event;
}

export async function readRuntimeTraceRecord(
  runtime: AgentRuntime,
  ref: RuntimeTraceRef,
  options: { readonly policyContext?: PolicyContext; readonly reason?: string } = {}
): Promise<Result<RuntimeTrace>> {
  const trace = await runtime.storage.readTrace(ref);
  if (!trace.ok) return trace;
  const invocation = await runtime.storage.readInvocation(trace.value.runtimeInvocationRef);
  if (!invocation.ok) return invocation;
  if (options.policyContext === undefined && trace.value.privacyClass !== "public") {
    return runtimeErr({ code: "privacy_blocked", message: "runtime trace read requires policy context" });
  }
  if (options.policyContext !== undefined) {
    const decision = await evaluateRuntimePolicy({
      runtime,
      invocation: invocation.value,
      capability: "artifact.read",
      operation: "read_runtime_trace",
      resourceSummary: `runtime trace ${ref.id}`,
      reason: options.reason ?? "read runtime trace",
      source: trace.value.source,
      context: options.policyContext
    });
    if (!decision.ok) return decision;
    if (!policyAllows(decision.value)) {
      return runtimeErr({ code: "privacy_blocked", message: `runtime trace read policy verdict is ${decision.value.verdict}` });
    }
  }
  return trace;
}

export async function recordFeedbackCandidateHintRecord(
  runtime: AgentRuntime,
  input: Omit<RuntimeFeedbackCandidateHint, "hintId" | "hintRef" | "createdAt" | "recordVersion">
): Promise<Result<RuntimeFeedbackCandidateHintRef>> {
  const invocation = await runtime.storage.readInvocation(input.runtimeInvocationRef);
  if (!invocation.ok) return invocation;
  const hintRef = newFeedbackHintRef();
  const record: RuntimeFeedbackCandidateHint = {
    ...input,
    hintId: hintRef.id,
    hintRef,
    createdAt: new Date().toISOString(),
    recordVersion: 1
  };
  const write = await runtime.storage.writeFeedbackHint(record, "write runtime feedback candidate hint");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addFeedbackHint(hintRef);
  if (!indexed.ok) return indexed;
  const next = mutateInvocation(invocation.value, {
    feedbackCandidateHintRefs: uniqueRefs(invocation.value.feedbackCandidateHintRefs, [hintRef])
  });
  const update = await runtime.storage.writeInvocation(next, "link feedback candidate hint");
  if (!update.ok) return update;
  const event = await appendRuntimeEvent({
    runtime,
    invocationRef: input.runtimeInvocationRef,
    eventType: runtimeEventTypes.feedbackHintRecorded,
    body: { hintRef, runtimeTraceRef: input.runtimeTraceRef, summary: input.summary },
    source: input.source,
    audit: input.audit,
    correlationId: invocation.value.correlationId
  });
  return event.ok ? ok(hintRef) : event;
}

export async function listFeedbackCandidateHintRecords(
  runtime: AgentRuntime,
  invocationRef: RuntimeInvocationRef
): Promise<Result<RuntimeFeedbackCandidateHintPage>> {
  const all = await runtime.storage.readAllFeedbackHints();
  if (!all.ok) return all;
  const records = all.value.filter((record) => record.runtimeInvocationRef.id === invocationRef.id);
  return ok({ records, total: records.length });
}

async function traceParentArtifacts(
  runtime: AgentRuntime,
  invocation: import("./types.js").RuntimeInvocation
): Promise<Result<readonly ArtifactRef[]>> {
  const messageListArtifacts: ArtifactRef[] = [];
  for (const ref of invocation.runtimeMessageListRefs) {
    const record = await runtime.storage.readMessageList(ref);
    if (!record.ok) return record;
    messageListArtifacts.push(record.value.artifactRef);
  }
  const outputArtifacts: ArtifactRef[] = [];
  for (const ref of invocation.runtimeOutputRefs) {
    const record = await runtime.storage.readOutput(ref);
    if (!record.ok) return record;
    outputArtifacts.push(record.value.artifactRef);
  }
  return ok([...messageListArtifacts, ...invocation.providerReceiptRefs, ...invocation.toolSettlementRefs, ...outputArtifacts]);
}

async function readTurnRefs(
  runtime: AgentRuntime,
  messageListRefs: readonly import("../domain/index.js").MessageListRef[]
) {
  const refs = [];
  for (const ref of messageListRefs) {
    const record = await runtime.storage.readMessageList(ref);
    if (record.ok) refs.push(record.value.turnRef);
  }
  return refs;
}

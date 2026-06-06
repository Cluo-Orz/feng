import { ok, type ArtifactRef, type MessageListRef, type Result } from "../domain/index.js";
import type { LLMRequestId, NormalizedLLMResponse } from "../llm-gateway/index.js";
import type { TargetActionRequestRef, WorldInputEnvelopeRef } from "../target-world-adapter/index.js";
import { runtimeErr } from "./errors.js";
import { callRuntimeLLM } from "./llm-flow.js";
import {
  mutateInvocation,
  newTurnRef,
  stableHash,
  terminalInvocationStatus,
  uniqueRefs
} from "./logic.js";
import { compileRuntimeMessageListRecord } from "./message-flow.js";
import { recordRuntimeOutputFromResponse } from "./output-flow.js";
import { appendRuntimeEvent, runtimeEventTypes, type AgentRuntime } from "./runtime.js";
import { settleRuntimeToolCalls } from "./tool-flow.js";
import { recordFeedbackCandidateHintRecord, recordRuntimeTraceRecord } from "./trace-flow.js";
import type {
  RuntimeInvocation,
  RuntimeOutput,
  RuntimeTurn,
  RuntimeTurnOptions,
  ShortTermContext
} from "./types.js";
import type { RuntimeInvocationRef, RuntimeTurnRef } from "./refs.js";

export async function runRuntimeTurnRecord(
  runtime: AgentRuntime,
  invocationRef: RuntimeInvocationRef,
  worldInputRef: WorldInputEnvelopeRef,
  options: RuntimeTurnOptions = {}
): Promise<Result<RuntimeTurn>> {
  const invocation = await runtime.storage.readInvocation(invocationRef);
  if (!invocation.ok) return invocation;
  const ready = await validateTurnStart(runtime, invocation.value, worldInputRef);
  if (!ready.ok) return ready;
  const turnRef = newTurnRef();
  const messageList = await compileRuntimeMessageListRecord({ runtime, invocationRef, turnRef, worldInputRef });
  if (!messageList.ok) return failInvocation(runtime, invocation.value, messageList.error.message, "runtime_message_compile_failed");
  const turn = await createTurn(runtime, invocation.value, turnRef, worldInputRef, messageList.value);
  if (!turn.ok) return turn;
  const response = await callRuntimeLLM({ runtime, invocation: invocation.value, messageListRef: messageList.value, options });
  if (!response.ok) return failInvocation(runtime, invocation.value, response.error.message, response.error.code);
  if (response.value === undefined) {
    return finishDryRun(runtime, invocation.value, turn.value, messageList.value);
  }
  const afterLlm = await writeTurn(runtime, {
    ...turn.value,
    llmRequestRef: response.value.requestId,
    ...(response.value.receiptRef === undefined ? {} : { providerReceiptRef: response.value.receiptRef }),
    status: "llm_completed"
  }, "record runtime llm response");
  if (!afterLlm.ok) return afterLlm;
  if (response.value.toolCallBlocks.length > 0) {
    return finishToolTurn(runtime, invocation.value, afterLlm.value, messageList.value, response.value, options);
  }
  return finishOutputTurn(runtime, invocation.value, afterLlm.value, messageList.value, response.value, options);
}

async function validateTurnStart(
  runtime: AgentRuntime,
  invocation: RuntimeInvocation,
  worldInputRef: WorldInputEnvelopeRef
): Promise<Result<void>> {
  if (terminalInvocationStatus(invocation.status)) {
    return runtimeErr({ code: "invalid_state", message: `runtime invocation is ${invocation.status}` });
  }
  if (invocation.runtimeMessageListRefs.length >= invocation.maxTurns) {
    return runtimeErr({ code: "invalid_state", message: "runtime invocation reached maxTurns" });
  }
  const worldInput = await runtime.options.targetWorldAdapter.getWorldInput(worldInputRef);
  if (!worldInput.ok) return worldInput;
  if (worldInput.value.targetWorldRef.id !== invocation.targetWorldRef.id) {
    return runtimeErr({ code: "target_unavailable", message: "world input target does not match invocation target" });
  }
  if (worldInput.value.runtimeContractRef.id !== invocation.runtimeContractRef.id) {
    return runtimeErr({ code: "contract_incompatible", message: "world input runtime contract does not match invocation" });
  }
  if (worldInput.value.hatchPackageRef.id !== invocation.hatchPackageRef.id) {
    return runtimeErr({ code: "package_unavailable", message: "world input hatch package does not match invocation" });
  }
  if (invocation.mode === "production") return verifyProductionLock(runtime, invocation);
  return ok(undefined);
}

async function createTurn(
  runtime: AgentRuntime,
  invocation: RuntimeInvocation,
  turnRef: RuntimeTurnRef,
  worldInputRef: WorldInputEnvelopeRef,
  messageListRef: MessageListRef
): Promise<Result<RuntimeTurn>> {
  const turn: RuntimeTurn = {
    runtimeTurnId: turnRef.id,
    runtimeTurnRef: turnRef,
    runtimeInvocationRef: invocation.runtimeInvocationRef,
    turnIndex: invocation.runtimeMessageListRefs.length,
    worldInputRef,
    runtimeMessageListRef: messageListRef,
    toolCallRefs: [],
    toolSettlementRefs: [],
    targetActionRequestRefs: [],
    status: "message_compiled",
    startedAt: new Date().toISOString(),
    source: invocation.source,
    audit: invocation.audit
  };
  const write = await runtime.storage.writeTurn(turn, "write runtime turn");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addTurn(turnRef);
  if (!indexed.ok) return indexed;
  const event = await appendRuntimeEvent({
    runtime,
    invocationRef: invocation.runtimeInvocationRef,
    eventType: runtimeEventTypes.turnStarted,
    body: { turnRef, turnIndex: turn.turnIndex, worldInputRef, messageListRef },
    source: invocation.source,
    audit: invocation.audit,
    correlationId: invocation.correlationId
  });
  return event.ok ? ok(turn) : event;
}

async function finishDryRun(
  runtime: AgentRuntime,
  invocation: RuntimeInvocation,
  turn: RuntimeTurn,
  messageListRef: MessageListRef
): Promise<Result<RuntimeTurn>> {
  const finalTurn = await writeTurn(runtime, {
    ...turn,
    status: "dry_run",
    completedAt: new Date().toISOString()
  }, "complete dry run turn");
  if (!finalTurn.ok) return finalTurn;
  const updated = await updateInvocationAndContext(runtime, invocation, finalTurn.value, messageListRef, {});
  if (!updated.ok) return updated;
  const trace = await recordRuntimeTraceRecord(runtime, invocation.runtimeInvocationRef);
  return trace.ok ? ok(finalTurn.value) : trace;
}

async function finishToolTurn(
  runtime: AgentRuntime,
  invocation: RuntimeInvocation,
  turn: RuntimeTurn,
  messageListRef: MessageListRef,
  response: NormalizedLLMResponse,
  options: RuntimeTurnOptions
): Promise<Result<RuntimeTurn>> {
  const settled = await settleRuntimeToolCalls({
    runtime,
    invocation,
    messageListRef,
    blocks: response.toolCallBlocks,
    options
  });
  if (!settled.ok) return failInvocation(runtime, invocation, settled.error.message, settled.error.code);
  const finalTurn = await writeTurn(runtime, {
    ...turn,
    toolCallRefs: response.toolCallBlocks.map((block) => block.callId as import("../tool-runtime/index.js").ToolCallId),
    toolSettlementRefs: settled.value.settlementRefs,
    status: "tool_settled",
    completedAt: new Date().toISOString()
  }, "record runtime tool settlements");
  if (!finalTurn.ok) return finalTurn;
  const updated = await updateInvocationAndContext(runtime, invocation, finalTurn.value, messageListRef, {
    llmRequestId: response.requestId,
    ...(response.receiptRef === undefined ? {} : { providerReceiptRef: response.receiptRef }),
    toolSettlementRefs: settled.value.settlementRefs
  });
  if (!updated.ok) return updated;
  const trace = await recordRuntimeTraceRecord(runtime, invocation.runtimeInvocationRef);
  if (!trace.ok) return trace;
  if (invocation.mode === "debug" && settled.value.settlements.some((item) => item.status !== "settled_success")) {
    const hint = await recordFeedbackCandidateHintRecord(runtime, {
      runtimeInvocationRef: invocation.runtimeInvocationRef,
      runtimeTraceRef: trace.value,
      targetWorldRef: invocation.targetWorldRef,
      summary: "Runtime tool settlement produced a non-success status.",
      attributionHint: "tool_settlement",
      evidenceRefs: settled.value.settlementRefs,
      privacyClass: "workspace_private",
      debugModeOnly: true,
      source: invocation.source,
      audit: invocation.audit
    });
    if (!hint.ok) return hint;
  }
  return ok(finalTurn.value);
}

async function finishOutputTurn(
  runtime: AgentRuntime,
  invocation: RuntimeInvocation,
  turn: RuntimeTurn,
  messageListRef: MessageListRef,
  response: NormalizedLLMResponse,
  options: RuntimeTurnOptions
): Promise<Result<RuntimeTurn>> {
  const output = await recordRuntimeOutputFromResponse({ runtime, invocation, turnRef: turn.runtimeTurnRef, response, options });
  if (!output.ok) return failInvocation(runtime, invocation, output.error.message, output.error.code);
  const finalTurn = await writeTurn(runtime, {
    ...turn,
    ...(output.value.output === undefined ? {} : { runtimeOutputRef: output.value.output.runtimeOutputRef }),
    targetActionRequestRefs: output.value.targetActionRefs,
    status: "completed",
    completedAt: new Date().toISOString()
  }, "complete runtime output turn");
  if (!finalTurn.ok) return finalTurn;
  const updated = await updateInvocationAndContext(runtime, invocation, finalTurn.value, messageListRef, {
    llmRequestId: response.requestId,
    ...(response.receiptRef === undefined ? {} : { providerReceiptRef: response.receiptRef }),
    ...(output.value.output === undefined ? {} : { runtimeOutput: output.value.output }),
    targetActionRefs: output.value.targetActionRefs
  });
  if (!updated.ok) return updated;
  const trace = await recordRuntimeTraceRecord(runtime, invocation.runtimeInvocationRef);
  if (!trace.ok) return trace;
  if (invocation.mode === "debug" && output.value.output?.status === "contract_invalid") {
    const hint = await recordFeedbackCandidateHintRecord(runtime, {
      runtimeInvocationRef: invocation.runtimeInvocationRef,
      runtimeTraceRef: trace.value,
      targetWorldRef: invocation.targetWorldRef,
      summary: output.value.output.validationSummary,
      attributionHint: "runtime_output_validation",
      evidenceRefs: [output.value.output.artifactRef],
      privacyClass: output.value.output.privacyClass,
      debugModeOnly: true,
      source: invocation.source,
      audit: invocation.audit
    });
    if (!hint.ok) return hint;
  }
  return ok(finalTurn.value);
}

async function updateInvocationAndContext(
  runtime: AgentRuntime,
  invocation: RuntimeInvocation,
  turn: RuntimeTurn,
  messageListRef: MessageListRef,
  refs: {
    readonly llmRequestId?: LLMRequestId;
    readonly providerReceiptRef?: ArtifactRef;
    readonly toolSettlementRefs?: readonly ArtifactRef[];
    readonly runtimeOutput?: RuntimeOutput;
    readonly targetActionRefs?: readonly TargetActionRequestRef[];
  }
): Promise<Result<void>> {
  const context = await runtime.storage.readShortTermContext(invocation.shortTermContextRef);
  if (!context.ok) return context;
  const toolSettlementRefs = refs.toolSettlementRefs ?? [];
  const targetActionRefs = refs.targetActionRefs ?? [];
  const outputRefs = refs.runtimeOutput === undefined ? [] : [refs.runtimeOutput.runtimeOutputRef];
  const nextContext = updateContext(context.value, turn, toolSettlementRefs, outputRefs, targetActionRefs);
  const writeContext = await runtime.storage.writeShortTermContext(nextContext, "update short term context");
  if (!writeContext.ok) return writeContext;
  const nextInvocation = mutateInvocation(invocation, {
    worldInputRefs: uniqueRefs(invocation.worldInputRefs, [turn.worldInputRef]),
    runtimeMessageListRefs: uniqueRefs(invocation.runtimeMessageListRefs, [messageListRef]),
    llmRequestRefs: uniqueStrings(invocation.llmRequestRefs, refs.llmRequestId === undefined ? [] : [refs.llmRequestId]),
    providerReceiptRefs: uniqueRefs(invocation.providerReceiptRefs, refs.providerReceiptRef === undefined ? [] : [refs.providerReceiptRef]),
    toolSettlementRefs: uniqueRefs(invocation.toolSettlementRefs, toolSettlementRefs),
    targetActionRequestRefs: uniqueRefs(invocation.targetActionRequestRefs, targetActionRefs),
    runtimeOutputRefs: uniqueRefs(invocation.runtimeOutputRefs, outputRefs)
  });
  const writeInvocation = await runtime.storage.writeInvocation(nextInvocation, "update runtime invocation after turn");
  return writeInvocation.ok ? ok(undefined) : writeInvocation;
}

function updateContext(
  context: ShortTermContext,
  turn: RuntimeTurn,
  toolSettlementRefs: readonly ArtifactRef[],
  runtimeOutputRefs: readonly import("./refs.js").RuntimeOutputRef[],
  targetActionRefs: readonly TargetActionRequestRef[]
): ShortTermContext {
  return {
    ...context,
    turnRefs: uniqueRefs(context.turnRefs, [turn.runtimeTurnRef]),
    worldInputRefs: uniqueRefs(context.worldInputRefs, [turn.worldInputRef]),
    runtimeOutputRefs: uniqueRefs(context.runtimeOutputRefs, runtimeOutputRefs),
    toolSettlementRefs: uniqueRefs(context.toolSettlementRefs, toolSettlementRefs),
    targetActionRefs: uniqueRefs(context.targetActionRefs, targetActionRefs),
    summary: `turns=${context.turnRefs.length + 1}; latest=${turn.status}; hash=${stableHash(turn).slice(0, 12)}`,
    updatedAt: new Date().toISOString(),
    recordVersion: context.recordVersion + 1
  };
}

async function writeTurn(runtime: AgentRuntime, turn: RuntimeTurn, reason: string): Promise<Result<RuntimeTurn>> {
  const written = await runtime.storage.writeTurn(turn, reason);
  return written.ok ? ok(turn) : written;
}

async function failInvocation(
  runtime: AgentRuntime,
  invocation: RuntimeInvocation,
  reason: string,
  code: import("../domain/index.js").DomainErrorCode = "llm_failed"
): Promise<Result<never>> {
  const next = mutateInvocation(invocation, { status: "failed", completedAt: new Date().toISOString() });
  const written = await runtime.storage.writeInvocation(next, "mark runtime invocation failed");
  if (!written.ok) return written;
  const event = await appendRuntimeEvent({
    runtime,
    invocationRef: invocation.runtimeInvocationRef,
    eventType: runtimeEventTypes.invocationFailed,
    body: { reason },
    source: invocation.source,
    audit: invocation.audit,
    correlationId: invocation.correlationId
  });
  return event.ok ? runtimeErr({ code, message: reason }) : event;
}

async function verifyProductionLock(runtime: AgentRuntime, invocation: RuntimeInvocation): Promise<Result<void>> {
  if (invocation.productionLock === undefined) {
    return runtimeErr({ code: "production_lock_violation", message: "production invocation is missing version lock" });
  }
  if (invocation.productionLock.runtimeKernelVersion !== runtime.kernelVersion) {
    return runtimeErr({ code: "production_lock_violation", message: "runtime kernel version changed during production invocation" });
  }
  const packageRecord = await runtime.options.hatchBuilder.getHatchPackage(invocation.hatchPackageRef);
  if (!packageRecord.ok) return packageRecord;
  const refs = [packageRecord.value.artifactRef, packageRecord.value.manifestRef, ...packageRecord.value.includedResourceRefs];
  const current: string[] = [];
  for (const ref of refs) {
    const artifact = await runtime.options.artifactRegistry.resolveArtifact(ref);
    if (!artifact.ok) return artifact;
    current.push(`${ref.id}:${artifact.value.contentHash ?? "missing"}`);
  }
  const locked = new Set(invocation.productionLock.packageResourceHashes);
  return current.every((item) => locked.has(item))
    ? ok(undefined)
    : runtimeErr({ code: "production_lock_violation", message: "package resource hash changed during production invocation" });
}

function uniqueStrings<T extends string>(existing: readonly T[], additions: readonly T[]): readonly T[] {
  return [...new Set([...existing, ...additions])];
}

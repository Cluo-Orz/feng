import type { AttemptRef } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import { attemptErr } from "./errors.js";
import { captureAttemptSnapshot, readPreparedInputs } from "./snapshot.js";
import { createExecutionPlan } from "./plan.js";
import { compileAttemptMessageList } from "./context.js";
import { callLLMForTurn } from "./llm.js";
import { registerCandidateOutputs, registerNormalizedResponseArtifact } from "./candidate.js";
import { settlementArtifacts, settleToolCalls } from "./tools.js";
import { checkpointAttempt } from "./checkpoint.js";
import { finalizeAttempt } from "./finalize.js";
import { appendAttemptEvent, attemptEventTypes, mutateAttempt, terminalStatus, type AttemptRuntime } from "./runtime.js";
import type {
  AttemptExecutionPlan,
  AttemptExitReason,
  AttemptOutcomeSummary,
  AttemptPreparedInputs,
  AttemptRecord,
  AttemptTurnRecord,
  RunAttemptOptions
} from "./types.js";

export async function runAttemptFlow(
  runtime: AttemptRuntime,
  attemptRef: AttemptRef,
  options: RunAttemptOptions,
  resume: boolean
): Promise<Result<AttemptOutcomeSummary>> {
  const loaded = await runtime.storage.readAttempt(attemptRef);
  if (!loaded.ok) return loaded;
  const terminal = await terminalOutcome(runtime, loaded.value, resume);
  if (terminal !== undefined) return terminal;
  const started = await ensureStarted(runtime, loaded.value, options);
  if (!started.ok) return started;
  let record = started.value;
  let preparedResult: Result<AttemptPreparedInputs>;
  if (record.inputSnapshotRef === undefined) {
    const captured = await captureAttemptSnapshot(runtime, record, options);
    if (!captured.ok) return await finishAfterFailure(runtime, record, "input_invalid", captured.error.message);
    record = captured.value.record;
    preparedResult = ok(captured.value.prepared);
    const checkpoint = await checkpointAttempt({
      runtime,
      record,
      phase: "after_snapshot",
      resumeInstructionSummary: "snapshot captured; create or read execution plan next"
    });
    if (!checkpoint.ok) return checkpoint;
    record = checkpoint.value.record;
  } else {
    preparedResult = await readPreparedInputs(runtime, record, options);
  }
  if (!preparedResult.ok) return preparedResult;
  let prepared = preparedResult.value;
  const planned = record.executionPlanRef === undefined
    ? await createExecutionPlan(runtime, record, prepared, options)
    : await readExistingPlan(runtime, record);
  if (!planned.ok) return planned;
  record = planned.value.record;
  let plan = planned.value.plan;
  let retryCount = 0;
  let continuationArtifacts: readonly import("../domain/index.js").ArtifactRef[] = [];
  for (let turnIndex = record.turnRefs.length; turnIndex < plan.maxTurns; turnIndex += 1) {
    const compiled = await compileAttemptMessageList({
      runtime,
      record,
      plan,
      prepared,
      options,
      turnIndex,
      continuationArtifactRefs: continuationArtifacts,
      reason: turnIndex === 0 ? "compile initial attempt message list" : "compile continuation after tool settlement"
    });
    if (!compiled.ok) {
      const handled = await handleRecoverableFailure(runtime, record, plan, retryCount, "context_compile_failed", compiled.error.message);
      if (!handled.ok) return handled;
      if (handled.value.done) return ok(handled.value.outcome);
      retryCount += 1;
      continue;
    }
    record = compiled.value.record;
    let turn = compiled.value.turn;
    const afterCompile = await checkpointAttempt({
      runtime,
      record,
      turn,
      phase: "after_compile",
      resumeInstructionSummary: "message list compiled; call LLM from latest MessageListRef"
    });
    if (!afterCompile.ok) return afterCompile;
    record = afterCompile.value.record;
    const called = await callLLMForTurn({ runtime, record, turn, plan, prepared, options });
    if (!called.ok) {
      const exit = exitReasonFromError(called.error.code);
      const handled = await handleRecoverableFailure(runtime, record, plan, retryCount, exit, called.error.message);
      if (!handled.ok) return handled;
      if (handled.value.done) return ok(handled.value.outcome);
      retryCount += 1;
      continue;
    }
    record = called.value.record;
    turn = called.value.turn;
    plan = called.value.plan;
    const normalized = await registerNormalizedResponseArtifact({
      runtime,
      record,
      turn,
      response: called.value.call.response,
      streamEventCount: called.value.call.streamEvents.length
    });
    if (!normalized.ok) return normalized;
    turn = { ...turn, normalizedResponseRef: normalized.value };
    const turnWrite = await runtime.storage.writeTurn(turn);
    if (!turnWrite.ok) return turnWrite;
    const afterLLM = await checkpointAttempt({
      runtime,
      record,
      turn,
      phase: "after_llm_response",
      resumeInstructionSummary: "LLM response recorded; register candidates and settle tool calls if present"
    });
    if (!afterLLM.ok) return afterLLM;
    record = afterLLM.value.record;
    const candidates = await registerCandidateOutputs({ runtime, record, turn, response: called.value.call.response });
    if (!candidates.ok) return candidates;
    record = candidates.value.record;
    turn = candidates.value.turn;
    const afterCandidate = await checkpointAttempt({
      runtime,
      record,
      turn,
      phase: "after_candidate_output",
      resumeInstructionSummary: "candidate outputs registered; inspect tool calls or finalize"
    });
    if (!afterCandidate.ok) return afterCandidate;
    record = afterCandidate.value.record;
    const toolBlocks = called.value.call.response.toolCallBlocks;
    if (toolBlocks.length === 0 || plan.toolUsePolicy.mode === "disable_model_tool_calls") {
      return finalizeWithCheckpoint(
        runtime,
        record,
        record.toolSettlementRefs.length === 0 ? "completed_no_tool_calls" : "completed_after_tool_settlement"
      );
    }
    if (record.toolCallRefs.length + toolBlocks.length > plan.maxToolCalls) {
      return finalizeWithCheckpoint(runtime, record, "max_tool_calls_reached", "failed");
    }
    const settled = await settleToolCalls({ runtime, record, turn, plan, prepared, blocks: toolBlocks, policyContext: options.policyContext });
    if (!settled.ok) return finalizeWithCheckpoint(runtime, record, "tool_failed", "failed");
    record = settled.value.record;
    turn = settled.value.turn;
    const afterTool = await checkpointAttempt({
      runtime,
      record,
      turn,
      phase: "after_tool_settlement",
      resumeInstructionSummary: "tool settlements recorded; compile continuation through Context Compiler"
    });
    if (!afterTool.ok) return afterTool;
    record = afterTool.value.record;
    if (settled.value.exitReason !== undefined) {
      return finalizeWithCheckpoint(runtime, record, settled.value.exitReason, "failed");
    }
    if (turnIndex + 1 >= plan.maxTurns) {
      return finalizeWithCheckpoint(runtime, record, "max_turns_reached", "failed");
    }
    continuationArtifacts = settlementArtifacts(settled.value.settlements);
    prepared = { ...prepared, toolSettlementArtifacts: continuationArtifacts };
  }
  return finalizeWithCheckpoint(runtime, record, "max_turns_reached", "failed");
}

async function ensureStarted(
  runtime: AttemptRuntime,
  record: AttemptRecord,
  options: RunAttemptOptions
): Promise<Result<AttemptRecord>> {
  if (record.startedAt !== undefined) return ok(record);
  const correlationId = options.correlationId ?? record.correlationId;
  const next = mutateAttempt(record, {
    status: "running",
    startedAt: new Date().toISOString(),
    ...(correlationId === undefined ? {} : { correlationId })
  });
  const write = await runtime.storage.writeAttempt(next, "start attempt");
  if (!write.ok) return write;
  const event = await appendAttemptEvent({
    runtime,
    record: next,
    eventType: attemptEventTypes.started,
    body: { startedAt: next.startedAt }
  });
  return event.ok ? ok(next) : event;
}

async function readExistingPlan(runtime: AttemptRuntime, record: AttemptRecord) {
  const plan = await runtime.storage.readPlan(record);
  return plan.ok ? ok({ record, plan: plan.value }) : plan;
}

async function terminalOutcome(runtime: AttemptRuntime, record: AttemptRecord, resume: boolean) {
  if (!terminalStatus(record.status)) return undefined;
  if (record.status === "interrupted" && resume) return undefined;
  const outcome = await runtime.storage.readOutcome(record);
  if (outcome.ok) return outcome;
  return attemptErr({ code: "invalid_state", message: `attempt is already ${record.status}` });
}

async function handleRecoverableFailure(
  runtime: AttemptRuntime,
  record: AttemptRecord,
  plan: AttemptExecutionPlan,
  retryCount: number,
  exitReason: AttemptExitReason,
  message: string
): Promise<Result<{ readonly done: true; readonly outcome: AttemptOutcomeSummary } | { readonly done: false }>> {
  if (retryCount < plan.retryPolicy.maxRetries && plan.retryPolicy.retryOnExitReasons.includes(exitReason)) {
    const checkpoint = await checkpointAttempt({
      runtime,
      record,
      phase: "before_retry",
      resumeInstructionSummary: `retry after ${exitReason}: ${message}`
    });
    if (!checkpoint.ok) return checkpoint;
    const event = await appendAttemptEvent({
      runtime,
      record: checkpoint.value.record,
      eventType: attemptEventTypes.retryRecorded,
      body: { exitReason, retryCount: retryCount + 1, message }
    });
    return event.ok ? ok({ done: false }) : event;
  }
  const finalReason = retryCount >= plan.retryPolicy.maxRetries && plan.retryPolicy.retryOnExitReasons.includes(exitReason)
    ? "retry_budget_exhausted"
    : exitReason;
  const outcome = await finalizeWithCheckpoint(runtime, record, finalReason, "failed");
  return outcome.ok ? ok({ done: true, outcome: outcome.value }) : outcome;
}

async function finishAfterFailure(
  runtime: AttemptRuntime,
  record: AttemptRecord,
  exitReason: AttemptExitReason,
  _message: string
) {
  return finalizeWithCheckpoint(runtime, record, exitReason, "failed");
}

async function finalizeWithCheckpoint(
  runtime: AttemptRuntime,
  record: AttemptRecord,
  exitReason: AttemptExitReason,
  status?: "completed" | "failed" | "cancelled" | "interrupted"
): Promise<Result<AttemptOutcomeSummary>> {
  const checkpoint = await checkpointAttempt({
    runtime,
    record,
    phase: "final",
    resumeInstructionSummary: `attempt finalizing with ${exitReason}`
  });
  if (!checkpoint.ok) return checkpoint;
  return finalizeAttempt({
    runtime,
    record: checkpoint.value.record,
    exitReason,
    ...(status === undefined ? {} : { status })
  });
}

function exitReasonFromError(code: string): AttemptExitReason {
  if (code === "approval_required") return "approval_required";
  if (code === "policy_blocked" || code === "permission_denied") return "policy_blocked";
  if (code === "artifact_unavailable") return "artifact_unavailable";
  if (code === "context_budget_exceeded") return "context_compile_failed";
  if ([
    "provider_unavailable",
    "llm_failed",
    "stream_interrupted",
    "unknown_provider_error",
    "network_failed",
    "timeout",
    "rate_limited",
    "auth_failed",
    "request_invalid",
    "response_invalid",
    "provider_internal_error"
  ].includes(code)) return "llm_failed";
  return "unknown_failure";
}

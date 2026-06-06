import { randomUUID } from "node:crypto";
import { ok, type Result } from "../domain/result.js";
import { makeAttemptTurnId } from "./brand.js";
import { attemptErr } from "./errors.js";
import { attemptTurnRef } from "./refs.js";
import { appendAttemptEvent, attemptEventTypes, mutateAttempt, type AttemptRuntime } from "./runtime.js";
import type {
  AttemptExecutionPlan,
  AttemptPreparedInputs,
  AttemptRecord,
  AttemptTurnRecord,
  RunAttemptOptions
} from "./types.js";

export async function compileAttemptMessageList(input: {
  readonly runtime: AttemptRuntime;
  readonly record: AttemptRecord;
  readonly plan: AttemptExecutionPlan;
  readonly prepared: AttemptPreparedInputs;
  readonly options: RunAttemptOptions;
  readonly turnIndex: number;
  readonly continuationArtifactRefs?: readonly import("../domain/index.js").ArtifactRef[];
  readonly reason: string;
}): Promise<Result<{ readonly record: AttemptRecord; readonly turn: AttemptTurnRecord }>> {
  const source = input.options.source ?? input.record.source;
  const version = input.options.version ?? input.record.version;
  const audit = input.options.audit ?? input.record.audit;
  const artifactCandidateRefs = uniqueArtifacts([
    ...input.prepared.attemptIntent.requiredContextRefs,
    ...input.prepared.attemptIntent.inputCandidateRefs.filter((ref): ref is import("../domain/index.js").ArtifactRef => ref.kind === "artifact"),
    ...(input.continuationArtifactRefs ?? [])
  ]);
  const messageList = await input.runtime.options.contextCompiler.compileMessageList({
    growUnitRef: input.record.growUnitRef,
    attemptIntentRef: input.record.attemptIntentRef,
    artifactCandidateRefs,
    toolSurfaceSummary: input.plan.toolUsePolicy.mode === "disable_model_tool_calls"
      ? []
      : input.prepared.contextToolSurface,
    compileReason: input.reason,
    ...(input.record.correlationId === undefined ? {} : { correlationId: input.record.correlationId }),
    source,
    version,
    audit
  });
  if (!messageList.ok) return attemptErr({
    code: messageList.error.code === "context_budget_exceeded" ? "context_budget_exceeded" : messageList.error.code,
    message: messageList.error.message,
    retryable: messageList.error.retryable,
    cause: messageList.error
  });
  const turnId = makeAttemptTurnId(`attempt-turn-${randomUUID()}`);
  const turn: AttemptTurnRecord = {
    turnId,
    turnRef: attemptTurnRef(turnId),
    attemptRef: input.record.attemptRef,
    turnIndex: input.turnIndex,
    messageListRef: messageList.value,
    toolCallRefs: [],
    toolSettlementRefs: [],
    candidateOutputRefs: [],
    status: "compiled",
    startedAt: new Date().toISOString(),
    source,
    audit
  };
  const turnWrite = await input.runtime.storage.writeTurn(turn);
  if (!turnWrite.ok) return turnWrite;
  const record = mutateAttempt(input.record, {
    status: "compiled",
    turnRefs: [...input.record.turnRefs, turn.turnRef],
    messageListRefs: [...input.record.messageListRefs, messageList.value]
  });
  const recordWrite = await input.runtime.storage.writeAttempt(record, "record compiled attempt message list");
  if (!recordWrite.ok) return recordWrite;
  const event = await appendAttemptEvent({
    runtime: input.runtime,
    record,
    eventType: attemptEventTypes.messageListCompiled,
    body: { messageListRef: messageList.value, turnRef: turn.turnRef, reason: input.reason }
  });
  if (!event.ok) return event;
  const started = await appendAttemptEvent({
    runtime: input.runtime,
    record,
    eventType: attemptEventTypes.turnStarted,
    body: { turnRef: turn.turnRef, turnIndex: turn.turnIndex, messageListRef: turn.messageListRef }
  });
  return started.ok ? ok({ record, turn }) : started;
}

function uniqueArtifacts(refs: readonly import("../domain/index.js").ArtifactRef[]) {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (seen.has(ref.id)) return false;
    seen.add(ref.id);
    return true;
  });
}

import { randomUUID } from "node:crypto";
import { ok, type Result } from "../domain/result.js";
import { makeAttemptCheckpointId } from "./brand.js";
import { attemptCheckpointRef } from "./refs.js";
import { appendAttemptEvent, attemptEventTypes, mutateAttempt, type AttemptRuntime } from "./runtime.js";
import type {
  AttemptCheckpoint,
  AttemptCheckpointPhase,
  AttemptRecord,
  AttemptTurnRecord
} from "./types.js";

export async function checkpointAttempt(input: {
  readonly runtime: AttemptRuntime;
  readonly record: AttemptRecord;
  readonly phase: AttemptCheckpointPhase;
  readonly turn?: AttemptTurnRecord;
  readonly resumeInstructionSummary: string;
  readonly traceFragmentRef?: AttemptCheckpoint["traceFragmentRef"];
}): Promise<Result<{ readonly record: AttemptRecord; readonly checkpoint: AttemptCheckpoint }>> {
  const id = makeAttemptCheckpointId(`attempt-checkpoint-${randomUUID()}`);
  const turn = input.turn;
  const latestMessageListRef = input.record.messageListRefs.at(-1);
  const latestProviderReceiptRef = input.record.providerReceiptRefs.at(-1);
  const checkpoint: AttemptCheckpoint = {
    checkpointId: id,
    checkpointRef: attemptCheckpointRef(id),
    attemptRef: input.record.attemptRef,
    phase: input.phase,
    status: input.record.status,
    ...(turn?.status === "completed" || turn?.status === "settled" ? { lastCompletedTurnRef: turn.turnRef } : {}),
    ...(latestMessageListRef === undefined ? {} : { latestMessageListRef }),
    ...(latestProviderReceiptRef === undefined ? {} : { latestProviderReceiptRef }),
    latestToolSettlementRefs: turn?.toolSettlementRefs ?? [],
    latestCandidateOutputRefs: turn?.candidateOutputRefs ?? [],
    ...(input.traceFragmentRef === undefined ? {} : { traceFragmentRef: input.traceFragmentRef }),
    resumeInstructionSummary: input.resumeInstructionSummary,
    createdAt: new Date().toISOString(),
    source: input.record.source,
    audit: input.record.audit
  };
  const write = await input.runtime.storage.writeCheckpoint(checkpoint);
  if (!write.ok) return write;
  const next = mutateAttempt(input.record, {
    checkpointRefs: [...input.record.checkpointRefs, checkpoint.checkpointRef]
  });
  const recordWrite = await input.runtime.storage.writeAttempt(next, "link attempt checkpoint");
  if (!recordWrite.ok) return recordWrite;
  const event = await appendAttemptEvent({
    runtime: input.runtime,
    record: next,
    eventType: attemptEventTypes.checkpointCreated,
    body: {
      checkpointRef: checkpoint.checkpointRef,
      phase: checkpoint.phase,
      status: checkpoint.status,
      resumeInstructionSummary: checkpoint.resumeInstructionSummary
    }
  });
  return event.ok ? ok({ record: next, checkpoint }) : event;
}

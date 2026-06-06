import type { AttemptRef } from "../domain/index.js";
import { makeLedgerStreamId, type LedgerStream } from "../event-ledger/index.js";

export const attemptEventTypes = {
  created: "attempt_created",
  inputSnapshotCaptured: "attempt_input_snapshot_captured",
  executionPlanCreated: "attempt_execution_plan_created",
  messageListCompiled: "attempt_message_list_compiled",
  started: "attempt_started",
  turnStarted: "attempt_turn_started",
  llmCallStarted: "attempt_llm_call_started",
  llmCallCompleted: "attempt_llm_call_completed",
  llmCallFailed: "attempt_llm_call_failed",
  toolCallRequested: "attempt_tool_call_requested",
  toolSettlementRecorded: "attempt_tool_settlement_recorded",
  candidateOutputRegistered: "attempt_candidate_output_registered",
  checkpointCreated: "attempt_checkpoint_created",
  retryRecorded: "attempt_retry_recorded",
  interrupted: "attempt_interrupted",
  cancelled: "attempt_cancelled",
  failed: "attempt_failed",
  completed: "attempt_completed",
  traceRegistered: "attempt_trace_registered",
  outcomeRecorded: "attempt_outcome_recorded"
} as const;

export function attemptStream(attemptRef: AttemptRef): LedgerStream {
  return { streamType: "attempt", streamId: makeLedgerStreamId(attemptRef.id) };
}

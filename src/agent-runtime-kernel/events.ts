import { makeLedgerStreamId, type LedgerStream } from "../event-ledger/index.js";
import type { RuntimeInvocationRef, RuntimeTraceRef } from "./refs.js";

export const runtimeEventTypes = {
  invocationStarted: "runtime_invocation_started",
  messageListCompiled: "runtime_message_list_compiled",
  turnStarted: "runtime_turn_started",
  llmCallCompleted: "runtime_llm_call_completed",
  toolSettlementRecorded: "runtime_tool_settlement_recorded",
  targetActionRequested: "runtime_target_action_requested",
  outputRecorded: "runtime_output_recorded",
  traceRegistered: "runtime_trace_registered",
  feedbackHintRecorded: "runtime_feedback_hint_recorded",
  invocationCompleted: "runtime_invocation_completed",
  invocationFailed: "runtime_invocation_failed",
  invocationCancelled: "runtime_invocation_cancelled"
} as const;

export function runtimeInvocationStream(ref: RuntimeInvocationRef): LedgerStream {
  return {
    streamType: "runtime_trace",
    streamId: makeLedgerStreamId(`runtime-invocation:${ref.id}`)
  };
}

export function runtimeTraceStream(ref: RuntimeTraceRef): LedgerStream {
  return {
    streamType: "runtime_trace",
    streamId: makeLedgerStreamId(`runtime-trace:${ref.id}`)
  };
}

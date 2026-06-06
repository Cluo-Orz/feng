import type { MessageListRef } from "../domain/index.js";
import type { WorldInputEnvelopeRef } from "../target-world-adapter/index.js";
import {
  cancelRuntimeInvocationRecord,
  completeRuntimeInvocationRecord,
  explainRuntimeInvocationRecord,
  startRuntimeInvocationRecord
} from "./invocation-flow.js";
import {
  compileRuntimeMessageListRecord,
  explainRuntimeMessageListRecord
} from "./message-flow.js";
import {
  listFeedbackCandidateHintRecords,
  readRuntimeTraceRecord,
  recordFeedbackCandidateHintRecord,
  recordRuntimeTraceRecord
} from "./trace-flow.js";
import { runRuntimeTurnRecord } from "./turn-flow.js";
import { createAgentRuntime, type AgentRuntime } from "./runtime.js";
import type {
  AgentRuntimeKernel,
  AgentRuntimeKernelOptions,
  RuntimeFeedbackCandidateHint,
  RuntimeTurnOptions,
  StartRuntimeInvocationInput
} from "./types.js";
import type { RuntimeInvocationRef, RuntimeTraceRef, RuntimeTurnRef } from "./refs.js";

export function createAgentRuntimeKernel(options: AgentRuntimeKernelOptions): AgentRuntimeKernel {
  return new NodeAgentRuntimeKernel(createAgentRuntime(options));
}

class NodeAgentRuntimeKernel implements AgentRuntimeKernel {
  constructor(private readonly runtime: AgentRuntime) {}

  startRuntimeInvocation(input: StartRuntimeInvocationInput) {
    return startRuntimeInvocationRecord(this.runtime, input);
  }

  runRuntimeTurn(ref: RuntimeInvocationRef, worldInputRef: WorldInputEnvelopeRef, options?: RuntimeTurnOptions) {
    return runRuntimeTurnRecord(this.runtime, ref, worldInputRef, options);
  }

  completeRuntimeInvocation(ref: RuntimeInvocationRef, reason: string) {
    return completeRuntimeInvocationRecord(this.runtime, ref, reason);
  }

  cancelRuntimeInvocation(ref: RuntimeInvocationRef, reason: string) {
    return cancelRuntimeInvocationRecord(this.runtime, ref, reason);
  }

  compileRuntimeMessageList(input: {
    readonly invocationRef: RuntimeInvocationRef;
    readonly turnRef: RuntimeTurnRef;
    readonly worldInputRef: WorldInputEnvelopeRef;
  }) {
    return compileRuntimeMessageListRecord({ runtime: this.runtime, ...input });
  }

  explainRuntimeMessageList(ref: MessageListRef) {
    return explainRuntimeMessageListRecord(this.runtime, ref);
  }

  recordRuntimeTrace(ref: RuntimeInvocationRef) {
    return recordRuntimeTraceRecord(this.runtime, ref);
  }

  readRuntimeTrace(ref: RuntimeTraceRef, options?: Parameters<AgentRuntimeKernel["readRuntimeTrace"]>[1]) {
    return readRuntimeTraceRecord(this.runtime, ref, options);
  }

  explainRuntimeInvocation(ref: RuntimeInvocationRef) {
    return explainRuntimeInvocationRecord(this.runtime, ref);
  }

  recordFeedbackCandidateHint(
    input: Omit<RuntimeFeedbackCandidateHint, "hintId" | "hintRef" | "createdAt" | "recordVersion">
  ) {
    return recordFeedbackCandidateHintRecord(this.runtime, input);
  }

  listFeedbackCandidateHints(ref: RuntimeInvocationRef) {
    return listFeedbackCandidateHintRecords(this.runtime, ref);
  }
}

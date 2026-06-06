import type {
  LongTermMemoryReadId,
  RuntimeFeedbackCandidateHintId,
  RuntimeInvocationId,
  RuntimeOutputId,
  RuntimeTraceId,
  RuntimeTurnId,
  ShortTermContextId
} from "./brand.js";

export interface ComponentRef<Kind extends string, Id extends string> {
  readonly kind: Kind;
  readonly id: Id;
  readonly uri?: string;
}

export type RuntimeInvocationRef = ComponentRef<"runtime_invocation", RuntimeInvocationId>;
export type RuntimeTurnRef = ComponentRef<"runtime_turn", RuntimeTurnId>;
export type RuntimeOutputRef = ComponentRef<"runtime_output", RuntimeOutputId>;
export type RuntimeTraceRef = ComponentRef<"runtime_trace", RuntimeTraceId>;
export type RuntimeFeedbackCandidateHintRef =
  ComponentRef<"runtime_feedback_candidate_hint", RuntimeFeedbackCandidateHintId>;
export type ShortTermContextRef = ComponentRef<"short_term_context", ShortTermContextId>;
export type LongTermMemoryReadRef = ComponentRef<"long_term_memory_read", LongTermMemoryReadId>;

export const runtimeInvocationRef = (id: RuntimeInvocationId): RuntimeInvocationRef => ({
  kind: "runtime_invocation",
  id
});
export const runtimeTurnRef = (id: RuntimeTurnId): RuntimeTurnRef => ({ kind: "runtime_turn", id });
export const runtimeOutputRef = (id: RuntimeOutputId): RuntimeOutputRef => ({ kind: "runtime_output", id });
export const runtimeTraceRef = (id: RuntimeTraceId): RuntimeTraceRef => ({ kind: "runtime_trace", id });
export const runtimeFeedbackCandidateHintRef = (
  id: RuntimeFeedbackCandidateHintId
): RuntimeFeedbackCandidateHintRef => ({ kind: "runtime_feedback_candidate_hint", id });
export const shortTermContextRef = (id: ShortTermContextId): ShortTermContextRef => ({
  kind: "short_term_context",
  id
});
export const longTermMemoryReadRef = (id: LongTermMemoryReadId): LongTermMemoryReadRef => ({
  kind: "long_term_memory_read",
  id
});

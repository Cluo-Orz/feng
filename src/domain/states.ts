import { domainErr, ok, type Result } from "./result.js";

export const growLifecycleStates = [
  "created",
  "clarifying",
  "planning",
  "growing",
  "waiting_input",
  "waiting_feedback",
  "verifying",
  "ready_to_hatch",
  "hatched",
  "blocked",
  "archived"
] as const;

export type GrowLifecycle = (typeof growLifecycleStates)[number];

export const attemptLifecycleStates = [
  "created",
  "compiled",
  "running",
  "waiting_tool",
  "settling",
  "completed",
  "failed",
  "interrupted",
  "cancelled"
] as const;

export type AttemptLifecycle = (typeof attemptLifecycleStates)[number];

export const feedbackStatuses = [
  "candidate",
  "accepted_local",
  "proposed_upstream",
  "accepted_upstream",
  "rejected",
  "ignored",
  "waiting_evidence",
  "waiting_human",
  "redacted"
] as const;

export type FeedbackStatus = (typeof feedbackStatuses)[number];

export const hatchLifecycles = [
  "requested",
  "building",
  "verifying_contract",
  "packaged",
  "published_local",
  "failed",
  "retracted"
] as const;

export type HatchLifecycle = (typeof hatchLifecycles)[number];

export const runtimeKernelTypes = [
  "standard_agent_kernel",
  "custom_agent_kernel",
  "non_llm_runtime",
  "hybrid_runtime"
] as const;

export type RuntimeKernelType = (typeof runtimeKernelTypes)[number];

export const readinessVerdicts = [
  "ready_to_hatch",
  "continue_grow",
  "waiting_input",
  "waiting_feedback",
  "waiting_validation",
  "blocked",
  "not_ready",
  "inconclusive"
] as const;

export type ReadinessVerdict = (typeof readinessVerdicts)[number];

function includes<const T extends readonly string[]>(values: T, value: string): value is T[number] {
  return values.includes(value);
}

export const isGrowLifecycle = (value: string): value is GrowLifecycle =>
  includes(growLifecycleStates, value);

export const isAttemptLifecycle = (value: string): value is AttemptLifecycle =>
  includes(attemptLifecycleStates, value);

export const isFeedbackStatus = (value: string): value is FeedbackStatus => includes(feedbackStatuses, value);

export const isHatchLifecycle = (value: string): value is HatchLifecycle => includes(hatchLifecycles, value);

export const isRuntimeKernelType = (value: string): value is RuntimeKernelType =>
  includes(runtimeKernelTypes, value);

export const isReadinessVerdict = (value: string): value is ReadinessVerdict =>
  includes(readinessVerdicts, value);

export function parseLiteralState<const T extends readonly string[]>(
  values: T,
  value: string,
  label: string
): Result<T[number]> {
  if (includes(values, value)) {
    return ok(value);
  }

  return domainErr({
    code: "version_unsupported",
    message: `Unsupported ${label}: ${value}`,
    module: "domain-model-contracts",
    retryable: false
  });
}


import { randomUUID } from "node:crypto";
import { ok, type Result } from "../domain/result.js";
import type { PolicyDecisionId } from "../domain/index.js";
import { makeAttemptExecutionPlanId } from "./brand.js";
import { attemptErr } from "./errors.js";
import { attemptExecutionPlanRef } from "./refs.js";
import { appendAttemptEvent, attemptEventTypes, mutateAttempt, type AttemptRuntime } from "./runtime.js";
import type {
  AttemptExecutionPlan,
  AttemptPreparedInputs,
  AttemptRecord,
  AttemptRetryPolicy,
  AttemptToolUsePolicy,
  RunAttemptOptions
} from "./types.js";

const defaultRetryReasons = ["llm_failed", "artifact_unavailable", "context_compile_failed"] as const;

export async function createExecutionPlan(
  runtime: AttemptRuntime,
  record: AttemptRecord,
  prepared: AttemptPreparedInputs,
  options: RunAttemptOptions
): Promise<Result<{ readonly record: AttemptRecord; readonly plan: AttemptExecutionPlan }>> {
  const modelSelection = options.modelSelection ?? record.modelSelectionHint;
  if (modelSelection === undefined) {
    return attemptErr({
      code: "invalid_input",
      message: "runAttempt requires modelSelection because the attempt has no persisted execution plan"
    });
  }
  const planId = makeAttemptExecutionPlanId(`attempt-plan-${randomUUID()}`);
  const toolUsePolicy = normalizeToolPolicy(options.toolUsePolicy);
  const requiredCapabilities = {
    ...(options.requiredCapabilities ?? record.requiredCapabilitiesHint ?? {}),
    ...(toolUsePolicy.mode === "allow_model_tool_calls" ? { toolCalls: true } : {})
  };
  const plan: AttemptExecutionPlan = {
    executionPlanId: planId,
    executionPlanRef: attemptExecutionPlanRef(planId),
    attemptRef: record.attemptRef,
    attemptIntentRef: record.attemptIntentRef,
    modelSelection,
    requiredCapabilities,
    modelRequirementSummary: `${modelSelection.provider}/${modelSelection.model}`,
    toolUsePolicy,
    maxTurns: Math.max(1, options.maxTurns ?? 3),
    maxToolCalls: Math.max(0, options.maxToolCalls ?? 8),
    timeoutPolicy: options.timeoutPolicy ?? {},
    retryPolicy: normalizeRetryPolicy(options.retryPolicy),
    streamingPreference: options.streamingPreference ?? "disabled",
    stopCondition: prepared.attemptIntent.stopCondition,
    toolCatalogQuery: options.toolCatalogQuery ?? record.toolCatalogQueryHint ?? {},
    policyDecisionRefs: [],
    source: options.source ?? record.source,
    audit: options.audit ?? record.audit,
    createdAt: new Date().toISOString()
  };
  const write = await runtime.storage.writePlan(plan);
  if (!write.ok) return write;
  const next = mutateAttempt(record, { executionPlanRef: plan.executionPlanRef });
  const recordWrite = await runtime.storage.writeAttempt(next, "link attempt execution plan");
  if (!recordWrite.ok) return recordWrite;
  const event = await appendAttemptEvent({
    runtime,
    record: next,
    eventType: attemptEventTypes.executionPlanCreated,
    body: {
      executionPlanRef: plan.executionPlanRef,
      modelRequirementSummary: plan.modelRequirementSummary,
      maxTurns: plan.maxTurns,
      maxToolCalls: plan.maxToolCalls,
      stopCondition: plan.stopCondition
    }
  });
  return event.ok ? ok({ record: next, plan }) : event;
}

export async function addPolicyDecisionToPlan(
  runtime: AttemptRuntime,
  plan: AttemptExecutionPlan,
  decisionId: PolicyDecisionId
): Promise<Result<AttemptExecutionPlan>> {
  if (plan.policyDecisionRefs.includes(decisionId)) return ok(plan);
  const next = { ...plan, policyDecisionRefs: [...plan.policyDecisionRefs, decisionId] };
  const write = await runtime.storage.writePlan(next);
  return write.ok ? ok(next) : write;
}

function normalizeRetryPolicy(input: Partial<AttemptRetryPolicy> | undefined): AttemptRetryPolicy {
  return {
    maxRetries: Math.max(0, input?.maxRetries ?? 1),
    retryOnExitReasons: input?.retryOnExitReasons ?? defaultRetryReasons
  };
}

function normalizeToolPolicy(input: Partial<AttemptToolUsePolicy> | undefined): AttemptToolUsePolicy {
  return {
    mode: input?.mode ?? "allow_model_tool_calls",
    continueAfterToolFailure: input?.continueAfterToolFailure ?? true
  };
}

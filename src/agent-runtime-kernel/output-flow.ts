import { ok, type Result } from "../domain/index.js";
import type { NormalizedLLMResponse } from "../llm-gateway/index.js";
import type { TargetActionRequestRef } from "../target-world-adapter/index.js";
import { runtimeErr } from "./errors.js";
import {
  firstOutputKind,
  newRuntimeOutputRef,
  parseRuntimeOutput
} from "./logic.js";
import { appendRuntimeEvent, registerRuntimeArtifact, runtimeEventTypes, type AgentRuntime } from "./runtime.js";
import type {
  RuntimeInvocation,
  RuntimeOutput,
  RuntimeOutputStatus,
  RuntimeTurnOptions
} from "./types.js";
import type { RuntimeTurnRef } from "./refs.js";

export interface RuntimeOutputResult {
  readonly output?: RuntimeOutput;
  readonly targetActionRefs: readonly TargetActionRequestRef[];
}

export async function recordRuntimeOutputFromResponse(input: {
  readonly runtime: AgentRuntime;
  readonly invocation: RuntimeInvocation;
  readonly turnRef: RuntimeTurnRef;
  readonly response: NormalizedLLMResponse | undefined;
  readonly options: RuntimeTurnOptions;
}): Promise<Result<RuntimeOutputResult>> {
  if (input.response === undefined) return ok({ targetActionRefs: [] });
  const contract = await input.runtime.options.runtimeContractRegistry.getRuntimeContract(input.invocation.runtimeContractRef);
  if (!contract.ok) return contract;
  const parsed = parseRuntimeOutput(input.response, input.options.outputKind ?? firstOutputKind(contract.value));
  const candidate = await registerRuntimeArtifact({
    runtime: input.runtime,
    kind: "candidate_output",
    content: parsed.normalizedOutput,
    privacyClass: "contains_model_output",
    source: input.invocation.source,
    version: input.invocation.version,
    audit: input.invocation.audit,
    parentRefs: input.response.receiptRef === undefined ? [] : [input.response.receiptRef],
    correlationId: input.invocation.correlationId
  });
  if (!candidate.ok) return candidate;
  const worldOutput = await input.runtime.options.targetWorldAdapter.normalizeRuntimeOutput({
    targetWorldRef: input.invocation.targetWorldRef,
    runtimeContractRef: input.invocation.runtimeContractRef,
    hatchPackageRef: input.invocation.hatchPackageRef,
    outputKind: parsed.outputKind,
    runtimeOutputRef: candidate.value,
    normalizedOutput: parsed.normalizedOutput,
    privacyClass: "contains_model_output",
    ...(input.invocation.correlationId === undefined ? {} : { correlationId: input.invocation.correlationId }),
    source: input.invocation.source,
    audit: input.invocation.audit
  });
  if (!worldOutput.ok) return worldOutput;
  const validation = await input.runtime.options.targetWorldAdapter.validateWorldOutput(worldOutput.value.worldOutputRef);
  if (!validation.ok) return validation;
  const actionResult = await prepareActions(input, worldOutput.value.worldOutputRef, parsed.actions);
  if (!actionResult.ok) return actionResult;
  const status = outputStatus(
    validation.value.result === "passed",
    actionResult.value.refs,
    input.options.dispatchTargetActions === true,
    actionResult.value.dispatchedCount
  );
  const outputRef = newRuntimeOutputRef();
  const record: RuntimeOutput = {
    runtimeOutputId: outputRef.id,
    runtimeOutputRef: outputRef,
    runtimeInvocationRef: input.invocation.runtimeInvocationRef,
    runtimeTurnRef: input.turnRef,
    runtimeContractRef: input.invocation.runtimeContractRef,
    worldOutputEnvelopeRef: worldOutput.value.worldOutputRef,
    artifactRef: candidate.value,
    status,
    validationSummary: validation.value.blockers.length === 0 ? validation.value.result : validation.value.blockers.join("; "),
    privacyClass: "contains_model_output",
    source: input.invocation.source,
    audit: input.invocation.audit,
    createdAt: new Date().toISOString(),
    recordVersion: 1
  };
  const written = await input.runtime.storage.writeOutput(record, "write runtime output");
  if (!written.ok) return written;
  const indexed = await input.runtime.storage.addOutput(outputRef);
  if (!indexed.ok) return indexed;
  const event = await appendRuntimeEvent({
    runtime: input.runtime,
    invocationRef: input.invocation.runtimeInvocationRef,
    eventType: runtimeEventTypes.outputRecorded,
    body: { runtimeOutputRef: outputRef, worldOutputRef: worldOutput.value.worldOutputRef, status },
    source: input.invocation.source,
    audit: input.invocation.audit,
    correlationId: input.invocation.correlationId
  });
  return event.ok ? ok({ output: record, targetActionRefs: actionResult.value.refs }) : event;
}

async function prepareActions(
  input: Parameters<typeof recordRuntimeOutputFromResponse>[0],
  worldOutputRef: import("../target-world-adapter/index.js").WorldOutputEnvelopeRef,
  actions: readonly import("./types.js").TargetActionCandidate[]
): Promise<Result<{ readonly refs: readonly TargetActionRequestRef[]; readonly dispatchedCount: number }>> {
  const refs: TargetActionRequestRef[] = [];
  let dispatchedCount = 0;
  for (const action of actions) {
    const prepared = await input.runtime.options.targetWorldAdapter.prepareTargetAction(worldOutputRef, {
      actionKind: action.actionKind,
      actionPayload: action.actionPayload,
      resourceSummary: action.resourceSummary,
      ...(action.requiredCapabilities === undefined ? {} : { requiredCapabilities: action.requiredCapabilities }),
      ...(input.options.externalEnforcement === undefined ? {} : { externalEnforcement: input.options.externalEnforcement }),
      ...(input.options.policyContext === undefined ? {} : { policyContext: input.options.policyContext }),
      reason: "runtime output requested target action",
      source: input.invocation.source,
      audit: input.invocation.audit
    });
    if (!prepared.ok) return prepared;
    refs.push(prepared.value.targetActionRequestRef);
    const event = await appendRuntimeEvent({
      runtime: input.runtime,
      invocationRef: input.invocation.runtimeInvocationRef,
      eventType: runtimeEventTypes.targetActionRequested,
      body: { targetActionRequestRef: prepared.value.targetActionRequestRef, actionKind: action.actionKind, status: prepared.value.dispatchStatus },
      source: input.invocation.source,
      audit: input.invocation.audit,
      correlationId: input.invocation.correlationId
    });
    if (!event.ok) return event;
    if (input.options.dispatchTargetActions === true && prepared.value.dispatchStatus === "validated") {
      const dispatched = await input.runtime.options.targetWorldAdapter.dispatchTargetAction(
        prepared.value.targetActionRequestRef,
        "runtime dispatch requested"
      );
      if (!dispatched.ok) return runtimeErr({ code: dispatched.error.code, message: dispatched.error.message, cause: dispatched.error });
      dispatchedCount += 1;
    }
  }
  return ok({ refs, dispatchedCount });
}

function outputStatus(
  valid: boolean,
  actions: readonly TargetActionRequestRef[],
  dispatchRequested: boolean,
  dispatchedCount: number
): RuntimeOutputStatus {
  if (!valid) return "contract_invalid";
  if (actions.length > 0 && dispatchRequested && dispatchedCount === actions.length) return "dispatched";
  return "contract_valid";
}

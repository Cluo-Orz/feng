import { ok, type Result } from "../domain/result.js";
import { targetErr } from "./errors.js";
import {
  appendTargetWorldEvent,
  evaluateTargetPolicy,
  policyAllows,
  registerTargetArtifact,
  targetWorldEventTypes,
  type TargetWorldRuntime
} from "./runtime.js";
import { contractAllowedActions, contractForbiddenActions, newActionReceiptRef, newActionRequestRef } from "./logic.js";
import type {
  TargetActionInput,
  TargetActionReceipt,
  TargetActionRequest,
  TargetActionRequestRef,
  TargetActionDispatchStatus
} from "./types.js";

export async function prepareTargetActionRecord(
  runtime: TargetWorldRuntime,
  outputEnvelopeRef: TargetActionRequest["worldOutputRef"],
  input: TargetActionInput
): Promise<Result<TargetActionRequest>> {
  const output = await runtime.storage.readWorldOutput(outputEnvelopeRef);
  if (!output.ok) return output;
  const target = await runtime.storage.readTargetWorld(output.value.targetWorldRef);
  if (!target.ok) return target;
  const contract = await runtime.options.runtimeContractRegistry.getRuntimeContract(output.value.runtimeContractRef);
  if (!contract.ok) return contract;
  const allowedActions = contractAllowedActions(contract.value);
  const forbiddenActions = contractForbiddenActions(contract.value);
  if (forbiddenActions.includes(input.actionKind)) {
    return targetErr({ code: "contract_incompatible", message: "target action is forbidden by runtime contract" });
  }
  if (allowedActions.length > 0 && !allowedActions.includes(input.actionKind)) {
    return targetErr({ code: "contract_incompatible", message: "target action is outside runtime contract boundary" });
  }
  if (!target.value.actionKinds.includes(input.actionKind)) {
    return targetErr({ code: "target_action_rejected", message: "target world does not support action kind" });
  }
  const payload = await registerTargetArtifact({
    runtime,
    kind: "summary",
    content: { actionKind: input.actionKind, actionPayload: input.actionPayload },
    privacyClass: output.value.privacyClass,
    source: input.source,
    audit: input.audit
  });
  if (!payload.ok) return payload;
  const decision = input.externalEnforcement === undefined && input.policyContext !== undefined
    ? await evaluateTargetPolicy({
        runtime,
        capability: "runtime.target_action",
        targetWorldRef: output.value.targetWorldRef,
        resourceSummary: input.resourceSummary,
        operation: "prepare target action",
        reason: input.reason,
        source: input.source,
        context: input.policyContext
      })
    : undefined;
  if (decision !== undefined && !decision.ok) return decision;
  const described = input.externalEnforcement === undefined && decision?.value === undefined
    ? runtime.options.policyBoundary.describeBoundary("runtime.target_action", {
        hostSandboxAvailable: false,
        networkAvailable: true,
        externalEnforcementAvailable: false,
        secretStoreAvailable: false
      })
    : undefined;
  if (described !== undefined && !described.ok) return described;
  const boundaryDeclaration = input.externalEnforcement === undefined
    ? decision?.value.boundaryDeclaration ?? described!.value
    : {
        capability: "runtime.target_action",
        level: "external_enforcement" as const,
        enforcedBy: input.externalEnforcement.enforcedBy,
        limitations: [input.externalEnforcement.summary]
      };
  const status = input.externalEnforcement !== undefined
    ? "validated"
    : decision === undefined
      ? "waiting_policy"
      : policyAllows(decision.value)
        ? "validated"
        : "policy_blocked";
  const ref = newActionRequestRef();
  const record: TargetActionRequest = {
    targetActionRequestId: ref.id,
    targetActionRequestRef: ref,
    worldOutputRef: outputEnvelopeRef,
    targetWorldRef: output.value.targetWorldRef,
    runtimeContractRef: output.value.runtimeContractRef,
    hatchPackageRef: output.value.hatchPackageRef,
    actionKind: input.actionKind,
    actionPayloadRef: payload.value,
    resourceSummary: input.resourceSummary,
    requiredCapabilities: input.requiredCapabilities ?? ["runtime.target_action"],
    ...(decision?.value === undefined ? {} : { policyDecisionId: decision.value.policyDecisionId, policyDecision: decision.value }),
    ...(input.externalEnforcement === undefined ? {} : { externalEnforcement: input.externalEnforcement }),
    boundaryDeclaration,
    dispatchStatus: status,
    blockers: decision !== undefined && decision.ok && !policyAllows(decision.value) ? [decision.value.explanation] : [],
    ...(output.value.correlationId === undefined ? {} : { correlationId: output.value.correlationId }),
    source: input.source,
    audit: input.audit,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    recordVersion: 1
  };
  const write = await runtime.storage.writeAction(record, "write target action request");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addAction(ref);
  if (!indexed.ok) return indexed;
  const outputWrite = await runtime.storage.writeWorldOutput({
    ...output.value,
    actionRequestRefs: [...output.value.actionRequestRefs, ref],
    recordVersion: output.value.recordVersion + 1
  }, "link target action request to world output");
  if (!outputWrite.ok) return outputWrite;
  const event = await appendTargetWorldEvent({
    runtime,
    targetWorldRef: output.value.targetWorldRef,
    eventType: targetWorldEventTypes.actionPrepared,
    body: { targetActionRequestRef: ref, actionKind: input.actionKind, status },
    source: input.source,
    audit: input.audit,
    ...(output.value.correlationId === undefined ? {} : { correlationId: output.value.correlationId })
  });
  return event.ok ? ok(record) : event;
}

export function dispatchTargetActionRecord(
  runtime: TargetWorldRuntime,
  ref: TargetActionRequestRef,
  reason: string
): Promise<Result<TargetActionReceipt>> {
  return transitionAction(runtime, ref, "dispatched", reason, targetWorldEventTypes.actionDispatched);
}

export function cancelTargetActionRecord(
  runtime: TargetWorldRuntime,
  ref: TargetActionRequestRef,
  reason: string
): Promise<Result<TargetActionReceipt>> {
  return transitionAction(runtime, ref, "cancelled", reason, targetWorldEventTypes.actionCancelled);
}

async function transitionAction(
  runtime: TargetWorldRuntime,
  ref: TargetActionRequestRef,
  to: TargetActionDispatchStatus,
  reason: string,
  eventType: string
): Promise<Result<TargetActionReceipt>> {
  const record = await runtime.storage.readAction(ref);
  if (!record.ok) return record;
  if (to === "dispatched" && record.value.dispatchStatus === "waiting_policy") {
    return targetErr({ code: "approval_required", message: "target action requires policy approval before dispatch" });
  }
  if (to === "dispatched" && record.value.dispatchStatus === "policy_blocked") {
    return targetErr({ code: "policy_blocked", message: record.value.blockers.join(";") || "target action policy blocked" });
  }
  if (to === "dispatched" && record.value.dispatchStatus !== "validated") {
    return targetErr({ code: "invalid_state", message: "target action is not dispatchable from current status" });
  }
  if (record.value.dispatchStatus === "dispatched" || record.value.dispatchStatus === "cancelled") {
    return targetErr({ code: "invalid_state", message: "target action is already terminal" });
  }
  const updated = {
    ...record.value,
    dispatchStatus: to,
    updatedAt: new Date().toISOString(),
    recordVersion: record.value.recordVersion + 1
  };
  const write = await runtime.storage.writeAction(updated, reason);
  if (!write.ok) return write;
  const event = await appendTargetWorldEvent({
    runtime,
    targetWorldRef: updated.targetWorldRef,
    eventType,
    body: { targetActionRequestRef: ref, from: record.value.dispatchStatus, to, reason },
    source: updated.source,
    audit: { ...updated.audit, reason },
    ...(updated.correlationId === undefined ? {} : { correlationId: updated.correlationId })
  });
  if (!event.ok) return event;
  return ok({
    receiptRef: newActionReceiptRef(),
    targetActionRequestRef: ref,
    from: record.value.dispatchStatus,
    to,
    reason,
    recordWriteReceipt: write.value,
    eventReceipt: event.value
  });
}

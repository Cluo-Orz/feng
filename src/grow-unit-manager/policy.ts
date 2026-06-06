import { randomUUID } from "node:crypto";
import { makePolicyRequestId, type PolicyContext, type PolicyDecision } from "../policy-boundary/index.js";
import type { EventAppendReceipt } from "../event-ledger/index.js";
import type { WriteReceipt } from "../file-store/index.js";
import type {
  GrowUnitManagerOptions,
  GrowUnitRecord,
  GrowUnitReasonInput,
  GrowUnitTransitionReceipt
} from "./types.js";
import { growUnitErr } from "./errors.js";
import type { Result } from "../domain/result.js";
import { ok } from "../domain/result.js";

export async function evaluateArchivePolicy(
  options: GrowUnitManagerOptions,
  record: GrowUnitRecord,
  input: GrowUnitReasonInput
): Promise<Result<PolicyDecision>> {
  const decision = await options.policyBoundary.evaluateAction({
    requestId: makePolicyRequestId(`grow-archive-${randomUUID()}`),
    capability: "file.delete",
    requestedByModule: "grow-unit-manager",
    workspace: record.workspace,
    growUnit: record.growUnitId,
    resourceSummary: `grow-unit:${record.growUnitId}`,
    operation: "archive-grow-unit",
    reason: input.reason,
    source: input.source,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId })
  }, input.policyContext ?? defaultPolicyContext());
  if (!decision.ok) return decision;
  if (decision.value.verdict === "allow" || decision.value.verdict === "allow_with_constraints") {
    return ok(decision.value);
  }
  return growUnitErr({
    code: decision.value.verdict === "ask" ? "approval_required" : "policy_blocked",
    message: `archive blocked by policy verdict: ${decision.value.verdict}`
  });
}

export function transitionReceipt(
  previous: GrowUnitRecord,
  updated: GrowUnitRecord,
  reason: string,
  eventReceipt: EventAppendReceipt,
  recordWriteReceipt: WriteReceipt,
  policyDecision?: PolicyDecision
): GrowUnitTransitionReceipt {
  return {
    growUnitRef: updated.growUnitRef,
    from: previous.lifecycle,
    to: updated.lifecycle,
    reason,
    recordVersion: updated.recordVersion,
    eventReceipt,
    recordWriteReceipt,
    ...(policyDecision === undefined ? {} : { policyDecision })
  };
}

function defaultPolicyContext(): PolicyContext {
  return {
    caller: "grow-unit-manager",
    environment: {
      hostSandboxAvailable: false,
      networkAvailable: false,
      externalEnforcementAvailable: false,
      secretStoreAvailable: false
    }
  };
}

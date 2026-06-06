import { randomUUID } from "node:crypto";
import { makePolicyRequestId, type PolicyBoundary, type PolicyContext, type PolicyDecision } from "../policy-boundary/index.js";
import { ok, type Result } from "../domain/result.js";
import { toolRuntimeErr } from "./errors.js";
import type { ToolCallRequest, ToolDefinition, ToolPolicyCheck } from "./types.js";

const allowedVerdicts = new Set(["allow", "allow_with_constraints", "allow_with_redaction"]);

export async function evaluateToolPolicy(input: {
  readonly policyBoundary: PolicyBoundary;
  readonly definition: ToolDefinition;
  readonly request: ToolCallRequest;
  readonly context: PolicyContext;
}): Promise<Result<ToolPolicyCheck>> {
  const capabilities = capabilitiesFor(input.definition, input.request);
  const decisions: PolicyDecision[] = [];
  for (const capability of capabilities) {
    const decision = await input.policyBoundary.evaluateAction({
      requestId: makePolicyRequestId(`tool-policy-${randomUUID()}`),
      capability,
      requestedByModule: "tool-runtime",
      ...(input.request.growUnitRef === undefined ? {} : { growUnit: input.request.growUnitRef.id }),
      ...(input.request.attemptRef === undefined ? {} : { attempt: input.request.attemptRef.id }),
      ...(input.request.inputArtifactRef === undefined ? {} : { artifactRefs: [input.request.inputArtifactRef] }),
      resourceSummary: resourceSummary(input.definition),
      operation: "execute-tool",
      reason: input.request.reason,
      source: input.request.source,
      ...(input.request.correlationId === undefined ? {} : { correlationId: input.request.correlationId })
    }, input.context);
    if (!decision.ok) return decision;
    decisions.push(decision.value);
  }
  const blockedBy = decisions.find((decision) => !allowedVerdicts.has(decision.verdict));
  const check: ToolPolicyCheck = {
    decisions,
    executable: blockedBy === undefined,
    ...(blockedBy === undefined ? {} : { blockedBy }),
    constraints: unique(decisions.flatMap((decision) => decision.constraints)),
    redactionRequired: decisions.some((decision) => decision.verdict === "allow_with_redaction" || decision.requiredRedaction !== undefined)
  };
  return ok(check);
}

export function assertPolicyExecutable(check: ToolPolicyCheck): Result<void> {
  if (check.executable) return ok(undefined);
  const blocked = check.blockedBy;
  if (blocked === undefined) return toolRuntimeErr({ code: "policy_blocked", message: "tool execution blocked by policy" });
  const code = blocked.verdict === "deny"
    ? "permission_denied"
    : blocked.verdict === "unsupported"
      ? "boundary_unsupported"
      : "policy_blocked";
  return toolRuntimeErr({
    code,
    message: `tool execution policy verdict is ${blocked.verdict}`,
    retryable: false
  });
}

function capabilitiesFor(definition: ToolDefinition, request: ToolCallRequest): readonly string[] {
  const requested = request.requestedCapabilities ?? [];
  const declared = definition.declaredCapabilities;
  const merged = unique([...requested, ...declared]);
  return merged.length === 0 ? ["runtime.target_action"] : merged;
}

function resourceSummary(definition: ToolDefinition): string {
  return `${definition.namespace}/${definition.name}@${definition.version.schemaVersion}`;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

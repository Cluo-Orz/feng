import type { PolicyDecision } from "../policy-boundary/index.js";
import { ok, type Result } from "../domain/result.js";
import { llmGatewayErr } from "./errors.js";
import type { LLMGatewayRuntime } from "./runtime.js";
import type { LLMRequest } from "./types.js";

const allowedVerdicts = new Set(["allow", "allow_with_constraints", "allow_with_redaction"]);
const allowedCapabilities = new Set(["network.request", "external_service.call"]);

export async function verifyProviderPolicy(
  runtime: LLMGatewayRuntime,
  request: LLMRequest
): Promise<Result<PolicyDecision>> {
  const explained = await runtime.options.policyBoundary.explainDecision(request.policyDecisionId);
  if (!explained.ok) {
    return llmGatewayErr({
      code: explained.error.code === "not_found" ? "policy_blocked" : explained.error.code,
      message: explained.error.code === "not_found" ? "policy decision not found" : explained.error.message,
      retryable: false,
      cause: explained.error
    });
  }
  const decision = explained.value.decision;
  if (!allowedVerdicts.has(decision.verdict)) {
    return llmGatewayErr({
      code: decision.verdict === "deny" ? "permission_denied" : "policy_blocked",
      message: `provider call policy verdict is ${decision.verdict}`,
      retryable: false
    });
  }
  if (!allowedCapabilities.has(decision.capability)) {
    return llmGatewayErr({
      code: "policy_blocked",
      message: `policy decision capability ${decision.capability} does not allow provider calls`,
      retryable: false
    });
  }
  if (decision.expiresAt !== undefined && Date.parse(decision.expiresAt) <= Date.now()) {
    return llmGatewayErr({ code: "permission_denied", message: "policy decision has expired", retryable: false });
  }
  return ok(decision);
}

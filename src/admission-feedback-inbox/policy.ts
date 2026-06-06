import { randomUUID } from "node:crypto";
import { makePolicyRequestId, type ArtifactPolicySummary, type PolicyDecision } from "../policy-boundary/index.js";
import type { ArtifactRef, GrowUnitRef, PolicyDecisionId, SourceDescriptor } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import type { ArtifactRegistry } from "../artifact-registry/index.js";
import type { PolicyBoundary, PolicyContext } from "../policy-boundary/index.js";
import { admissionErr } from "./errors.js";

export async function artifactPolicySummary(
  artifactRegistry: ArtifactRegistry,
  ref: ArtifactRef
): Promise<Result<ArtifactPolicySummary>> {
  const record = await artifactRegistry.resolveArtifact(ref);
  if (!record.ok) return record.error.code === "not_found"
    ? admissionErr({ code: "artifact_unavailable", message: "artifact metadata is unavailable" })
    : record;
  return ok({
    artifactRef: ref,
    privacyClass: record.value.privacyClass,
    retentionClass: record.value.retentionClass,
    lifecycle: record.value.lifecycle,
    sourceKind: record.value.source.kind
  });
}

export async function evaluateUpstreamPolicy(input: {
  readonly policyBoundary: PolicyBoundary;
  readonly artifactRegistry: ArtifactRegistry;
  readonly fromGrowUnitRef: GrowUnitRef;
  readonly targetGrowUnitRef: GrowUnitRef;
  readonly redactedSummaryRef: ArtifactRef;
  readonly source: SourceDescriptor;
  readonly reason: string;
  readonly policyContext?: PolicyContext;
}): Promise<Result<PolicyDecision>> {
  const summary = await artifactPolicySummary(input.artifactRegistry, input.redactedSummaryRef);
  if (!summary.ok) return summary;
  if (summary.value.privacyClass === "unknown") {
    return admissionErr({
      code: "privacy_blocked",
      message: "unknown privacy cannot be proposed upstream"
    });
  }
  const request = {
    requestId: makePolicyRequestId(`feedback-upstream-${randomUUID()}`),
    capability: "feedback.upstream",
    requestedByModule: "admission-feedback-inbox",
    growUnit: input.fromGrowUnitRef.id,
    artifactRefs: [input.redactedSummaryRef],
    resourceSummary: `feedback:${input.fromGrowUnitRef.id}->${input.targetGrowUnitRef.id}`,
    operation: "create-upstream-proposal",
    reason: input.reason,
    source: input.source
  };
  const context = {
    ...(input.policyContext ?? {}),
    caller: input.policyContext?.caller ?? "admission-feedback-inbox",
    environment: input.policyContext?.environment ?? {
      hostSandboxAvailable: false,
      networkAvailable: false,
      externalEnforcementAvailable: false,
      secretStoreAvailable: false
    },
    artifactSummaries: [summary.value]
  };
  const decision = await input.policyBoundary.evaluateAction(request, context);
  if (!decision.ok) return decision;
  if (decision.value.verdict === "allow" || decision.value.verdict === "allow_with_constraints" || decision.value.verdict === "allow_with_redaction") {
    return ok(decision.value);
  }
  return admissionErr({
    code: decision.value.verdict === "ask" ? "upstream_policy_required" : "policy_blocked",
    message: `upstream proposal blocked by policy verdict: ${decision.value.verdict}`
  });
}

export function requirePolicyDecisionId(decision: PolicyDecision | PolicyDecisionId | undefined): Result<PolicyDecisionId> {
  if (decision === undefined) return admissionErr({ code: "upstream_policy_required", message: "policyDecisionId is required" });
  return ok(typeof decision === "string" ? decision : decision.policyDecisionId);
}

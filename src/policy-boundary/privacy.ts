import { ok, type Result } from "../domain/result.js";
import type { ArtifactRegistry } from "../artifact-registry/index.js";
import { policyErr } from "./errors.js";
import type { ActionRequest, ArtifactPolicySummary, PolicyContext, PolicyDecision } from "./types.js";

export interface PrivacyDecisionInput {
  readonly verdict: PolicyDecision["verdict"];
  readonly constraints: readonly string[];
  readonly explanation: string;
}

export async function evaluatePrivacyBoundary(
  request: ActionRequest,
  context: PolicyContext,
  artifactRegistry: ArtifactRegistry
): Promise<Result<PrivacyDecisionInput | undefined>> {
  if (!artifactRelevant(request.capability)) return ok(undefined);
  const summaries = await collectArtifactSummaries(request, context, artifactRegistry);
  if (!summaries.ok) return summaries;
  if (request.capability === "artifact.read") return evaluateReadPrivacy(summaries.value);
  if (!privacySensitive(request.capability)) return ok(undefined);
  return evaluateCrossBoundaryPrivacy(request.capability, summaries.value);
}

function evaluateReadPrivacy(summaries: readonly ArtifactPolicySummary[]): Result<PrivacyDecisionInput | undefined> {
  if (summaries.some((item) => item.lifecycle === "redacted" || item.privacyClass === "redacted")) {
    return ok({
      verdict: "deny",
      constraints: ["redacted artifact cannot be read as original content"],
      explanation: "artifact read denied because the artifact is redacted"
    });
  }
  if (summaries.some((item) => item.lifecycle === "unavailable" || item.lifecycle === "deleted" || item.lifecycle === "retracted")) {
    return ok({
      verdict: "unsupported",
      constraints: ["artifact content is unavailable in the registry"],
      explanation: "artifact read is unsupported for unavailable content"
    });
  }
  if (summaries.some((item) => item.privacyClass === "contains_secret")) {
    return ok({
      verdict: "ask",
      constraints: ["secret artifact read requires explicit approval"],
      explanation: "artifact read needs approval because metadata marks it as secret-bearing"
    });
  }
  return ok(undefined);
}

function evaluateCrossBoundaryPrivacy(
  capability: string,
  summaries: readonly ArtifactPolicySummary[]
): Result<PrivacyDecisionInput | undefined> {
  if (summaries.some((item) => item.lifecycle !== "active" && item.lifecycle !== "registered")) {
    return ok({
      verdict: "deny",
      constraints: ["inactive artifact cannot cross project boundary"],
      explanation: `${capability} denied because at least one artifact is not active`
    });
  }
  if (summaries.some((item) => item.privacyClass === "contains_secret" || item.privacyClass === "redacted")) {
    return ok({
      verdict: "deny",
      constraints: ["contains_secret artifact must be replaced by a redacted artifact first"],
      explanation: `${capability} denied because secret-bearing artifacts cannot cross boundaries`
    });
  }
  if (summaries.some((item) => item.privacyClass === "project_private" || item.privacyClass === "contains_user_content")) {
    const verdict = capability === "artifact.export" ? "allow_with_redaction" : "ask";
    return ok({
      verdict,
      constraints: ["redacted artifact and explicit boundary reason required"],
      explanation: `${capability} requires redaction because project-private or user-provided content is present`
    });
  }
  return ok(undefined);
}

async function collectArtifactSummaries(
  request: ActionRequest,
  context: PolicyContext,
  artifactRegistry: ArtifactRegistry
): Promise<Result<readonly ArtifactPolicySummary[]>> {
  const summaries = [...(context.artifactSummaries ?? [])];
  for (const ref of request.artifactRefs ?? []) {
    if (summaries.some((summary) => summary.artifactRef.id === ref.id)) continue;
    const record = await artifactRegistry.resolveArtifact(ref);
    if (!record.ok) return policyErr({ code: "artifact_unavailable", message: "artifact metadata unavailable" });
    summaries.push({
      artifactRef: record.value.artifactRef,
      privacyClass: record.value.privacyClass,
      retentionClass: record.value.retentionClass,
      lifecycle: record.value.lifecycle,
      sourceKind: record.value.source.kind
    });
  }
  return ok(summaries);
}

function artifactRelevant(capability: string): boolean {
  return capability === "artifact.read" || privacySensitive(capability);
}

function privacySensitive(capability: string): boolean {
  return capability === "artifact.export" ||
    capability === "feedback.upstream" ||
    capability === "hatch.publish" ||
    capability === "debug_trace.upload";
}

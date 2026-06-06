import { describe, expect, test } from "vitest";
import {
  makeGrowUnitId,
  makePolicyDecisionId,
  makeTargetWorldId
} from "../../src/domain/index.js";
import { describeCapabilityBoundary, requireCapabilityBoundary, defaultConstraints } from "../../src/policy-boundary/boundary.js";
import { grantCoversRequest, grantMatchesFilter, normalizeGrantScope, requestGrantScope } from "../../src/policy-boundary/grants.js";
import { decisionFromPayload, grantFromPayload, toEventPayload } from "../../src/policy-boundary/payloads.js";
import { defaultVerdictForCapability, wildcard } from "../../src/policy-boundary/rules.js";
import { makeCapabilityGrantId } from "../../src/policy-boundary/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import { audit, source } from "../event-ledger/helpers.js";
import { actionRequest, makePolicyFixture, policyContext } from "./helpers.js";
import type { ArtifactPolicySummary, CapabilityGrant } from "../../src/policy-boundary/index.js";

describe("Policy boundary helper behavior", () => {
  test("matches wildcard policy rules and classifies default verdicts", () => {
    expect(wildcard("npm *", "npm test")).toBe(true);
    expect(wildcard("file.+", "fileX+")).toBe(false);
    expect(wildcard("*", "anything")).toBe(true);
    expect(defaultVerdictForCapability("file.read")).toBe("allow_with_constraints");
    expect(defaultVerdictForCapability("skill.activate")).toBe("ask");
    expect(defaultVerdictForCapability("secret.read")).toBe("unsupported");
    expect(defaultVerdictForCapability("file.write")).toBe("ask");
    expect(defaultVerdictForCapability("network.request")).toBe("ask");
    expect(defaultVerdictForCapability("external_service.call")).toBe("ask");
    expect(defaultVerdictForCapability("artifact.export")).toBe("ask");
    expect(defaultVerdictForCapability("hatch.publish")).toBe("ask");
    expect(defaultVerdictForCapability("unknown")).toBe("unsupported");
  });

  test("declares concrete boundary levels and constraints for each capability family", () => {
    const env = {
      hostSandboxAvailable: true,
      networkAvailable: true,
      externalEnforcementAvailable: true,
      secretStoreAvailable: true
    };
    expect(describeCapabilityBoundary("network.request", env).ok).toBe(true);
    const noNetwork = describeCapabilityBoundary("external_service.call", { ...env, networkAvailable: false });
    expect(noNetwork.ok).toBe(true);
    if (noNetwork.ok) expect(noNetwork.value.level).toBe("unsupported");
    const secret = describeCapabilityBoundary("secret.read", env);
    expect(secret.ok).toBe(true);
    if (secret.ok) expect(secret.value.level).toBe("human_approval");
    const satisfied = requireCapabilityBoundary("command.run", "host_sandbox_required", env);
    expect(satisfied.ok).toBe(true);
    const advisory = requireCapabilityBoundary("runtime.target_action", "advisory_only", {
      ...env,
      externalEnforcementAvailable: false
    });
    expect(advisory.ok).toBe(true);

    expect(defaultConstraints("runtime.target_action", { capability: "runtime.target_action", level: "advisory_only", enforcedBy: "caller", limitations: [] })).toHaveLength(1);
    expect(defaultConstraints("feedback.upstream", { capability: "feedback.upstream", level: "policy_decision", enforcedBy: "policy", limitations: [] })).toHaveLength(1);
    expect(defaultConstraints("hatch.publish", { capability: "hatch.publish", level: "policy_decision", enforcedBy: "policy", limitations: [] })).toHaveLength(1);
  });

  test("normalizes grant scopes without broadening the approved request", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makePolicyFixture(workspace);
      const request = actionRequest(fixture, "command.run", {
        growUnit: makeGrowUnitId("grow-1"),
        runtime: "runtime-1",
        targetWorld: makeTargetWorldId("world-1"),
        resourceSummary: "npm test"
      });
      const normalized = normalizeGrantScope(request, { capability: "command.run", resourcePattern: "npm *" });
      expect(normalized.ok).toBe(true);
      if (!normalized.ok) throw new Error(normalized.error.message);
      expect(normalized.value.workspace).toBe(fixture.workspace.id);

      const conflict = normalizeGrantScope(request, { capability: "file.read" });
      expect(conflict.ok).toBe(false);
      const tooBroad = normalizeGrantScope(request, { capability: "command.run", resourcePattern: "git *" });
      expect(tooBroad.ok).toBe(false);

      const grant = grantFor(fixture, normalized.value, "2999-01-01T00:00:00.000Z");
      expect(grantCoversRequest(requestGrantScope(request), grant)).toBe(true);
      expect(grantCoversRequest({ ...requestGrantScope(request), runtime: "runtime-2" }, grant)).toBe(false);
      expect(grantMatchesFilter({ resourcePattern: "git *" }, grant)).toBe(false);
      expect(grantMatchesFilter({ workspace: fixture.workspace.id }, { ...grant, expiresAt: "2000-01-01T00:00:00.000Z" })).toBe(false);
    });
  });

  test("serializes policy payloads as ledger-compatible summaries", () => {
    const payload = toEventPayload({
      keep: "yes",
      skipUndefined: undefined,
      skipFunction: () => "no",
      skipSymbol: Symbol("no"),
      nested: [1, null, { ok: true }]
    });
    expect(payload).toEqual({ keep: "yes", nested: [1, null, { ok: true }] });
    expect(toEventPayload(undefined)).toBe("undefined");
    expect(decisionFromPayload("bad")).toBeUndefined();
    expect(grantFromPayload({ grantId: "grant-1" })).toBeDefined();
    expect(decisionFromPayload({ policyDecisionId: makePolicyDecisionId("policy-1") })).toBeDefined();
  });

  test("covers validation and specialized privacy branches", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makePolicyFixture(workspace);
      const invalid = await fixture.policy.evaluateAction(
        actionRequest(fixture, "file.read", { reason: " " }),
        policyContext()
      );
      expect(invalid.ok).toBe(false);

      const noRefsExport = await fixture.policy.evaluateAction(actionRequest(fixture, "artifact.export"), policyContext());
      expect(noRefsExport.ok).toBe(true);
      if (noRefsExport.ok) expect(noRefsExport.value.verdict).toBe("ask");

      const publicSummary = artifactSummary("public", "active");
      const readPublic = await fixture.policy.evaluateArtifactAccess(
        actionRequest(fixture, "artifact.read"),
        publicSummary
      );
      expect(readPublic.ok).toBe(true);
      if (readPublic.ok) expect(readPublic.value.verdict).toBe("allow_with_constraints");

      const readSecret = await fixture.policy.evaluateArtifactAccess(
        actionRequest(fixture, "artifact.read"),
        artifactSummary("contains_secret", "active")
      );
      expect(readSecret.ok).toBe(true);
      if (readSecret.ok) expect(readSecret.value.verdict).toBe("ask");

      const unavailable = await fixture.policy.evaluateArtifactAccess(
        actionRequest(fixture, "artifact.read"),
        artifactSummary("workspace_private", "unavailable")
      );
      expect(unavailable.ok).toBe(true);
      if (unavailable.ok) expect(unavailable.value.verdict).toBe("unsupported");

      const hatch = await fixture.policy.evaluateHatchPublish(
        actionRequest(fixture, "hatch.publish"),
        artifactSummary("project_private", "active")
      );
      expect(hatch.ok).toBe(true);
      if (hatch.ok) expect(hatch.value.verdict).toBe("ask");
    });
  });
});

function grantFor(
  fixture: ReturnType<typeof makePolicyFixture>,
  scope: CapabilityGrant["scope"],
  expiresAt: string
): CapabilityGrant {
  return {
    grantId: makeCapabilityGrantId("grant-test"),
    capability: scope.capability ?? "command.run",
    scope,
    subject: "tool-runtime",
    approvedBy: "developer",
    reason: "test grant",
    constraints: [],
    createdAt: "2026-06-06T00:00:00.000Z",
    expiresAt,
    source: source(fixture.workspace),
    audit: audit("grant")
  };
}

function artifactSummary(
  privacyClass: ArtifactPolicySummary["privacyClass"],
  lifecycle: ArtifactPolicySummary["lifecycle"]
): ArtifactPolicySummary {
  return {
    artifactRef: {
      kind: "artifact",
      id: "artifact-summary" as ArtifactPolicySummary["artifactRef"]["id"],
      uri: "artifact://artifact-summary"
    },
    privacyClass,
    retentionClass: "grow_scoped",
    lifecycle,
    sourceKind: "user"
  };
}

import { describe, expect, test } from "vitest";
import { makeArtifactId, makeRef, makeWorkspaceId } from "../../src/domain/index.js";
import { policyStream } from "../../src/policy-boundary/events.js";
import { withWorkspace } from "../file-store/helpers.js";
import { audit, source } from "../event-ledger/helpers.js";
import { textArtifact } from "../artifact-registry/helpers.js";
import { actionRequest, approvalInput, makePolicyFixture, policyContext } from "./helpers.js";

describe("Policy & Capability Boundary", () => {
  test("records default decisions and explains them from the policy stream", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makePolicyFixture(workspace);
      const request = actionRequest(fixture, "file.read");
      const decision = await fixture.policy.evaluateAction(request, policyContext());
      expect(decision.ok).toBe(true);
      if (!decision.ok) throw new Error(decision.error.message);
      expect(decision.value.verdict).toBe("allow_with_constraints");
      expect(decision.value.boundaryDeclaration.level).toBe("structural_guard");

      const explained = await fixture.policy.explainDecision(decision.value.policyDecisionId);
      expect(explained.ok).toBe(true);
      if (explained.ok) expect(explained.value.decision.requestId).toBe(request.requestId);

      const replay = await fixture.ledger.replayStream(policyStream, { reason: "test replay" });
      expect(replay.ok).toBe(true);
      if (replay.ok) expect(replay.value.events.some((event) => event.eventType === "policy_decision_recorded")).toBe(true);

      const unknown = await fixture.policy.evaluateAction(actionRequest(fixture, "unknown.capability"), policyContext());
      expect(unknown.ok).toBe(true);
      if (unknown.ok) expect(unknown.value.verdict).toBe("unsupported");
    });
  });

  test("asks for risky actions, applies scoped grants, and stops using revoked grants", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makePolicyFixture(workspace);
      const request = actionRequest(fixture, "command.run", { resourceSummary: "npm test" });
      const first = await fixture.policy.evaluateAction(request, policyContext());
      expect(first.ok).toBe(true);
      if (first.ok) expect(first.value.verdict).toBe("ask");

      const approval = await fixture.policy.recordApproval(request, approvalInput);
      expect(approval.ok).toBe(true);
      if (!approval.ok) throw new Error(approval.error.message);
      const grant = await fixture.policy.createGrant({
        approval: approval.value,
        scope: { workspace: fixture.workspace.id, capability: "command.run", resourcePattern: "npm *" },
        expiresAt: "2999-01-01T00:00:00.000Z",
        subject: "tool-runtime"
      });
      expect(grant.ok).toBe(true);
      if (!grant.ok) throw new Error(grant.error.message);

      const listed = await fixture.policy.listActiveGrants({ workspace: fixture.workspace.id, capability: "command.run" });
      expect(listed.ok).toBe(true);
      if (listed.ok) expect(listed.value.grants).toHaveLength(1);

      const allowed = await fixture.policy.evaluateAction(request, policyContext());
      expect(allowed.ok).toBe(true);
      if (allowed.ok) expect(allowed.value.verdict).toBe("allow");

      const otherWorkspace = actionRequest(fixture, "command.run", {
        workspace: makeWorkspaceId("workspace-other"),
        resourceSummary: "npm test"
      });
      const notCrossWorkspace = await fixture.policy.evaluateAction(otherWorkspace, policyContext());
      expect(notCrossWorkspace.ok).toBe(true);
      if (notCrossWorkspace.ok) expect(notCrossWorkspace.value.verdict).toBe("ask");

      const revoked = await fixture.policy.revokeGrant(grant.value.grantId, "test revoke");
      expect(revoked.ok).toBe(true);
      const afterRevoke = await fixture.policy.evaluateAction(request, policyContext());
      expect(afterRevoke.ok).toBe(true);
      if (afterRevoke.ok) expect(afterRevoke.value.verdict).toBe("ask");
    });
  });

  test("uses artifact metadata for export, upstream, publish, and read privacy decisions", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makePolicyFixture(workspace);
      const secret = await fixture.registry.registerArtifact({
        ...textArtifact(workspace, "secret"),
        privacyClass: "contains_secret"
      });
      expect(secret.ok).toBe(true);
      if (!secret.ok) throw new Error(secret.error.message);
      const secretExport = await fixture.policy.evaluateAction(
        actionRequest(fixture, "artifact.export", { artifactRefs: [secret.value] }),
        policyContext()
      );
      expect(secretExport.ok).toBe(true);
      if (secretExport.ok) expect(secretExport.value.verdict).toBe("deny");

      const userContent = await fixture.registry.registerArtifact({
        ...textArtifact(workspace, "chapter"),
        privacyClass: "contains_user_content",
        source: { ...source(workspace.workspace), kind: "user", userProvided: true }
      });
      expect(userContent.ok).toBe(true);
      if (!userContent.ok) throw new Error(userContent.error.message);
      const exportDecision = await fixture.policy.evaluateAction(
        actionRequest(fixture, "artifact.export", { artifactRefs: [userContent.value] }),
        policyContext()
      );
      expect(exportDecision.ok).toBe(true);
      if (exportDecision.ok) {
        expect(exportDecision.value.verdict).toBe("allow_with_redaction");
        expect(exportDecision.value.requiredRedaction).toContain("artifact.export");
      }

      const upstreamDecision = await fixture.policy.evaluateFeedbackUpstream(
        actionRequest(fixture, "feedback.upstream", { artifactRefs: [userContent.value] }),
        {
          artifactRef: userContent.value,
          privacyClass: "contains_user_content",
          retentionClass: "grow_scoped",
          lifecycle: "active",
          sourceKind: "user"
        }
      );
      expect(upstreamDecision.ok).toBe(true);
      if (upstreamDecision.ok) expect(upstreamDecision.value.verdict).toBe("ask");

      const redacted = await fixture.registry.redactArtifact(userContent.value, "redact");
      expect(redacted.ok).toBe(true);
      const readRedacted = await fixture.policy.evaluateAction(
        actionRequest(fixture, "artifact.read", { artifactRefs: [userContent.value] }),
        policyContext()
      );
      expect(readRedacted.ok).toBe(true);
      if (readRedacted.ok) expect(readRedacted.value.verdict).toBe("deny");
    });
  });

  test("declares unsupported or advisory boundaries instead of pretending to enforce them", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makePolicyFixture(workspace);
      const noSandbox = policyContext({ environment: { ...policyContext().environment, hostSandboxAvailable: false } });
      const command = await fixture.policy.evaluateAction(actionRequest(fixture, "command.run"), noSandbox);
      expect(command.ok).toBe(true);
      if (command.ok) {
        expect(command.value.verdict).toBe("unsupported");
        expect(command.value.boundaryDeclaration.level).toBe("unsupported");
      }

      const requiredSandbox = fixture.policy.requireBoundary("command.run", "host_sandbox_required", noSandbox.environment);
      expect(requiredSandbox.ok).toBe(false);
      if (!requiredSandbox.ok) expect(requiredSandbox.error.code).toBe("boundary_unsupported");

      const noTargetBoundary = policyContext({
        environment: { ...policyContext().environment, externalEnforcementAvailable: false }
      });
      const targetRequired = fixture.policy.requireBoundary(
        "runtime.target_action",
        "external_enforcement",
        noTargetBoundary.environment
      );
      expect(targetRequired.ok).toBe(false);
      if (!targetRequired.ok) expect(targetRequired.error.code).toBe("external_enforcement_unavailable");
    });
  });

  test("policy allow does not bypass File Store containment checks", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makePolicyFixture(workspace);
      const request = actionRequest(fixture, "file.write", { resourceSummary: "../outside.txt" });
      const decision = await fixture.policy.evaluateAction(
        request,
        policyContext({
          rules: [{ capability: "file.write", resource: "../outside.txt", verdict: "allow" }]
        })
      );
      expect(decision.ok).toBe(true);
      if (decision.ok) expect(decision.value.verdict).toBe("allow");

      const write = await fixture.store.writeTextAtomic(fixture.workspace, "../outside.txt", "escape", {
        reason: "policy allow still cannot escape"
      });
      expect(write.ok).toBe(false);
      if (!write.ok) expect(write.error.code).toBe("path_escape_rejected");
    });
  });

  test("rejects invalid grants and missing artifact metadata for high-risk actions", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makePolicyFixture(workspace);
      const request = actionRequest(fixture, "command.run");
      const approval = await fixture.policy.recordApproval(request, {
        ...approvalInput,
        audit: audit("approve invalid grant")
      });
      expect(approval.ok).toBe(true);
      if (!approval.ok) throw new Error(approval.error.message);
      const expired = await fixture.policy.createGrant({
        approval: approval.value,
        scope: { workspace: fixture.workspace.id, capability: "command.run", resourcePattern: "npm *" },
        expiresAt: "2000-01-01T00:00:00.000Z"
      });
      expect(expired.ok).toBe(false);
      if (!expired.ok) expect(expired.error.code).toBe("grant_expired");

      const missingRef = makeRef("artifact", makeArtifactId("artifact-missing"), {
        uri: "artifact://artifact-missing"
      });
      const missing = await fixture.policy.evaluateAction(
        actionRequest(fixture, "hatch.publish", { artifactRefs: [missingRef] }),
        policyContext()
      );
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.error.code).toBe("artifact_unavailable");
    });
  });
});

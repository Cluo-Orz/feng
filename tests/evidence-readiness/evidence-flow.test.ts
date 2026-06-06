import { describe, expect, test } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import {
  allowPolicy,
  audit,
  createGrowAgendaAndDoD,
  denyPolicy,
  makeEvidenceFixture,
  reportArtifactInput,
  source,
  support,
  version
} from "./helpers.js";

describe("Evidence Readiness evidence flow", () => {
  test("keeps candidates separate from accepted evidence and supports stale/reject transitions", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeEvidenceFixture(workspace);
      const setup = await createGrowAgendaAndDoD(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);

      const candidate = await fixture.evidence.recordEvidenceCandidate({
        growUnitRef: setup.value.growUnitRef,
        sourceKind: "validation_report",
        summary: "sample world states passed",
        content: "{\"passed\":true}",
        artifactKind: "validation_report",
        mediaType: "application/json",
        relationHints: support(setup.value.dodRef),
        quality: { trustLevel: "strong", observationKind: "test_reported" },
        source: source(fixture, "tool"),
        version,
        audit: audit("record candidate")
      });
      expect(candidate.ok).toBe(true);
      if (!candidate.ok) throw new Error(candidate.error.message);

      const before = await fixture.evidence.classifyEvidence(candidate.value);
      expect(before.ok).toBe(true);
      if (before.ok) {
        expect(before.value.status).toBe("candidate");
        expect(before.value.usableForReadiness).toBe(false);
      }

      const accepted = await fixture.evidence.acceptEvidenceForEvaluation(candidate.value, {
        reason: "accept scoped validation report",
        source: source(fixture, "system"),
        audit: audit("accept evidence"),
        policyContext: allowPolicy()
      });
      expect(accepted.ok).toBe(true);
      if (accepted.ok) expect(accepted.value.to).toBe("accepted_for_evaluation");

      const after = await fixture.evidence.classifyEvidence(candidate.value);
      expect(after.ok).toBe(true);
      if (after.ok) expect(after.value.usableForReadiness).toBe(true);

      const summary = await fixture.evidence.buildEvidenceSummary(setup.value.growUnitRef);
      expect(summary.ok).toBe(true);
      if (summary.ok) {
        expect(summary.value.total).toBe(1);
        expect(summary.value.accepted).toBe(1);
      }

      const stale = await fixture.evidence.markEvidenceStale(candidate.value, {
        reason: "DoD scope changed",
        source: source(fixture, "system"),
        audit: audit("mark stale")
      });
      expect(stale.ok).toBe(true);
      const staleClass = await fixture.evidence.classifyEvidence(candidate.value);
      expect(staleClass.ok).toBe(true);
      if (staleClass.ok) expect(staleClass.value.usableForReadiness).toBe(false);

      const rejectedCandidate = await fixture.evidence.recordEvidenceCandidate({
        growUnitRef: setup.value.growUnitRef,
        sourceKind: "manual_review",
        summary: "review outside scope",
        scope: "outdated boss contract",
        content: "outdated review",
        source: source(fixture, "user"),
        version,
        audit: audit("record manual review")
      });
      expect(rejectedCandidate.ok).toBe(true);
      if (!rejectedCandidate.ok) throw new Error(rejectedCandidate.error.message);
      const rejected = await fixture.evidence.rejectEvidence(rejectedCandidate.value, {
        reason: "wrong scope",
        source: source(fixture, "system"),
        audit: audit("reject")
      });
      expect(rejected.ok).toBe(true);
      if (rejected.ok) expect(rejected.value.to).toBe("rejected");
    });
  });

  test("blocks acceptance on policy deny, redacted content, and unavailable artifact lifecycle", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeEvidenceFixture(workspace);
      const setup = await createGrowAgendaAndDoD(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);

      const deniedArtifact = await fixture.artifacts.registerArtifact(reportArtifactInput(fixture));
      expect(deniedArtifact.ok).toBe(true);
      if (!deniedArtifact.ok) throw new Error(deniedArtifact.error.message);
      const deniedEvidence = await fixture.evidence.recordEvidenceCandidate({
        growUnitRef: setup.value.growUnitRef,
        sourceKind: "validation_report",
        summary: "policy denied report",
        artifactRef: deniedArtifact.value,
        relationHints: support(setup.value.dodRef),
        source: source(fixture, "tool"),
        version,
        audit: audit("record denied")
      });
      expect(deniedEvidence.ok).toBe(true);
      if (!deniedEvidence.ok) throw new Error(deniedEvidence.error.message);
      const denied = await fixture.evidence.acceptEvidenceForEvaluation(deniedEvidence.value, {
        reason: "deny evidence read",
        source: source(fixture, "system"),
        audit: audit("deny"),
        policyContext: denyPolicy()
      });
      expect(denied.ok).toBe(false);
      if (!denied.ok) expect(denied.error.code).toBe("policy_blocked");

      const redactedArtifact = await fixture.artifacts.registerArtifact(reportArtifactInput(fixture));
      expect(redactedArtifact.ok).toBe(true);
      if (!redactedArtifact.ok) throw new Error(redactedArtifact.error.message);
      await fixture.artifacts.redactArtifact(redactedArtifact.value, "redact evidence");
      const redactedEvidence = await fixture.evidence.recordEvidenceCandidate({
        growUnitRef: setup.value.growUnitRef,
        sourceKind: "validation_report",
        summary: "redacted report",
        artifactRef: redactedArtifact.value,
        relationHints: support(setup.value.dodRef),
        source: source(fixture, "tool"),
        version,
        audit: audit("record redacted")
      });
      expect(redactedEvidence.ok).toBe(true);
      if (!redactedEvidence.ok) throw new Error(redactedEvidence.error.message);
      const redacted = await fixture.evidence.acceptEvidenceForEvaluation(redactedEvidence.value, {
        reason: "accept redacted evidence",
        source: source(fixture, "system"),
        audit: audit("redacted"),
        policyContext: allowPolicy()
      });
      expect(redacted.ok).toBe(false);
      if (!redacted.ok) expect(redacted.error.code).toBe("privacy_blocked");

      const missingArtifact = await fixture.artifacts.registerArtifact(reportArtifactInput(fixture));
      expect(missingArtifact.ok).toBe(true);
      if (!missingArtifact.ok) throw new Error(missingArtifact.error.message);
      await fixture.artifacts.markUnavailable(missingArtifact.value, "external report disappeared");
      const missingEvidence = await fixture.evidence.recordEvidenceCandidate({
        growUnitRef: setup.value.growUnitRef,
        sourceKind: "validation_report",
        summary: "unavailable report",
        artifactRef: missingArtifact.value,
        relationHints: support(setup.value.dodRef),
        source: source(fixture, "tool"),
        version,
        audit: audit("record unavailable")
      });
      expect(missingEvidence.ok).toBe(true);
      if (!missingEvidence.ok) throw new Error(missingEvidence.error.message);
      const unavailable = await fixture.evidence.acceptEvidenceForEvaluation(missingEvidence.value, {
        reason: "accept unavailable evidence",
        source: source(fixture, "system"),
        audit: audit("unavailable"),
        policyContext: allowPolicy()
      });
      expect(unavailable.ok).toBe(false);
      if (!unavailable.ok) expect(unavailable.error.code).toBe("artifact_unavailable");

      const page = await fixture.evidence.listEvidence(setup.value.growUnitRef);
      expect(page.ok).toBe(true);
      if (page.ok) expect(page.value.total).toBe(3);
    });
  });

  test("validates manual review scope and content-source exclusivity", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeEvidenceFixture(workspace);
      const setup = await createGrowAgendaAndDoD(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const artifact = await fixture.artifacts.registerArtifact(reportArtifactInput(fixture));
      expect(artifact.ok).toBe(true);
      if (!artifact.ok) throw new Error(artifact.error.message);

      const noScope = await fixture.evidence.recordEvidenceCandidate({
        growUnitRef: setup.value.growUnitRef,
        sourceKind: "manual_review",
        summary: "approved by reviewer",
        content: "approved",
        source: source(fixture, "user"),
        version,
        audit: audit("manual without scope")
      });
      expect(noScope.ok).toBe(false);
      if (!noScope.ok) expect(noScope.error.code).toBe("invalid_input");

      const both = await fixture.evidence.recordEvidenceCandidate({
        growUnitRef: setup.value.growUnitRef,
        sourceKind: "validation_report",
        summary: "bad input",
        content: "bad",
        artifactRef: artifact.value,
        source: source(fixture, "tool"),
        version,
        audit: audit("both content artifact")
      });
      expect(both.ok).toBe(false);
      if (!both.ok) expect(both.error.code).toBe("invalid_input");
    });
  });
});

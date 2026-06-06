import { describe, expect, test } from "vitest";
import type { GrowUnitRef } from "../../src/domain/index.js";
import type { DoDRef } from "../../src/agenda-dod-manager/index.js";
import { makeArtifactId, makeRef } from "../../src/domain/index.js";
import { makeDoDId, makeDoDRef } from "../../src/agenda-dod-manager/index.js";
import {
  makeDoDEvaluationId,
  makeDoDEvaluationRef,
  makeEvidenceId,
  makeEvidenceRef,
  makeReadinessAssessmentId,
  makeReadinessAssessmentRef,
  makeReadinessVerdictId,
  makeReadinessVerdictRef,
  parseJson,
  EvidenceStorage
} from "../../src/evidence-readiness/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import {
  allowPolicy,
  audit,
  createGrowAgendaAndDoD,
  makeEvidenceFixture,
  policyContext,
  reportArtifactInput,
  source,
  support,
  version,
  type EvidenceFixture
} from "./helpers.js";

describe("Evidence Readiness edge behavior", () => {
  test("rejects missing artifacts, no-artifact acceptance, restricted producer, and archived grow mutation", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeEvidenceFixture(workspace);
      const setup = await createGrowAgendaAndDoD(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);

      const missingArtifact = await fixture.evidence.recordEvidenceCandidate({
        growUnitRef: setup.value.growUnitRef,
        sourceKind: "validation_report",
        summary: "missing artifact",
        artifactRef: makeRef("artifact", makeArtifactId("artifact-missing")),
        source: source(fixture, "tool"),
        version,
        audit: audit("missing artifact")
      });
      expect(missingArtifact.ok).toBe(false);
      if (!missingArtifact.ok) expect(missingArtifact.error.code).toBe("artifact_unavailable");

      const noArtifact = await fixture.evidence.recordEvidenceCandidate({
        growUnitRef: setup.value.growUnitRef,
        sourceKind: "artifact_metadata",
        summary: "metadata only evidence",
        source: source(fixture, "system"),
        version,
        audit: audit("metadata only")
      });
      expect(noArtifact.ok).toBe(true);
      if (!noArtifact.ok) throw new Error(noArtifact.error.message);
      const noArtifactAccept = await fixture.evidence.acceptEvidenceForEvaluation(noArtifact.value, {
        reason: "cannot accept metadata without artifact",
        source: source(fixture, "system"),
        audit: audit("no artifact")
      });
      expect(noArtifactAccept.ok).toBe(false);
      if (!noArtifactAccept.ok) expect(noArtifactAccept.error.code).toBe("evidence_unavailable");

      const fakeTool = await fixture.evidence.recordEvidenceCandidate({
        growUnitRef: setup.value.growUnitRef,
        sourceKind: "tool_result",
        summary: "tool result forged by evidence module",
        content: "{\"ok\":true}",
        source: source(fixture, "tool"),
        version,
        audit: audit("fake tool result")
      });
      expect(fakeTool.ok).toBe(false);
      if (!fakeTool.ok) expect(fakeTool.error.code).toBe("invalid_state");

      const archived = await fixture.grow.archiveGrowUnit(setup.value.growUnitRef, {
        reason: "archive",
        source: source(fixture, "system"),
        audit: audit("archive"),
        policyContext: policyContext([{ capability: "file.delete", resource: "grow-unit:*", verdict: "allow" }])
      });
      expect(archived.ok).toBe(true);
      const afterArchive = await fixture.evidence.recordEvidenceCandidate({
        growUnitRef: setup.value.growUnitRef,
        sourceKind: "validation_report",
        summary: "after archive",
        content: "late",
        source: source(fixture, "tool"),
        version,
        audit: audit("after archive")
      });
      expect(afterArchive.ok).toBe(false);
      if (!afterArchive.ok) expect(afterArchive.error.code).toBe("grow_unit_archived");
    });
  });

  test("handles ask policy, secret grant redaction, pagination, and inferred DoD grow unit", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeEvidenceFixture(workspace);
      const setup = await createGrowAgendaAndDoD(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);

      const askArtifact = await fixture.artifacts.registerArtifact(reportArtifactInput(fixture, "{\"ask\":true}"));
      expect(askArtifact.ok).toBe(true);
      if (!askArtifact.ok) throw new Error(askArtifact.error.message);
      const askEvidence = await fixture.evidence.recordEvidenceCandidate({
        growUnitRef: setup.value.growUnitRef,
        sourceKind: "validation_report",
        summary: "ask policy report",
        artifactRef: askArtifact.value,
        relationHints: support(setup.value.dodRef),
        source: source(fixture, "tool"),
        version,
        audit: audit("ask evidence")
      });
      expect(askEvidence.ok).toBe(true);
      if (!askEvidence.ok) throw new Error(askEvidence.error.message);
      const asked = await fixture.evidence.acceptEvidenceForEvaluation(askEvidence.value, {
        reason: "ask policy",
        source: source(fixture, "system"),
        audit: audit("ask"),
        policyContext: policyContext([{ capability: "artifact.read", resource: "artifact:*", verdict: "ask" }])
      });
      expect(asked.ok).toBe(false);
      if (!asked.ok) expect(asked.error.code).toBe("approval_required");

      const secretArtifact = await fixture.artifacts.registerArtifact(reportArtifactInput(fixture, "{\"secret\":true}", {
        privacyClass: "contains_secret"
      }));
      expect(secretArtifact.ok).toBe(true);
      if (!secretArtifact.ok) throw new Error(secretArtifact.error.message);
      const secretEvidence = await fixture.evidence.recordEvidenceCandidate({
        growUnitRef: setup.value.growUnitRef,
        sourceKind: "validation_report",
        summary: "secret validation report",
        artifactRef: secretArtifact.value,
        relationHints: support(setup.value.dodRef),
        source: source(fixture, "tool"),
        version,
        audit: audit("secret evidence")
      });
      expect(secretEvidence.ok).toBe(true);
      if (!secretEvidence.ok) throw new Error(secretEvidence.error.message);
      const secret = await fixture.evidence.acceptEvidenceForEvaluation(secretEvidence.value, {
        reason: "secret grant still redacts",
        source: source(fixture, "system"),
        audit: audit("secret"),
        policyContext: {
          ...allowPolicy(),
          activeGrants: [{
            grantId: "grant-secret" as never,
            capability: "artifact.read",
            scope: {
              workspace: fixture.workspace.id,
              growUnit: setup.value.growUnitRef.id,
              capability: "artifact.read",
              resourcePattern: "artifact:*"
            },
            subject: "evidence-readiness",
            approvedBy: "test",
            reason: "test grant",
            constraints: [],
            createdAt: "2026-06-06T00:00:00.000Z",
            expiresAt: "2027-06-07T00:00:00.000Z",
            source: source(fixture, "system"),
            audit: audit("grant")
          }]
        }
      });
      expect(secret.ok).toBe(false);
      if (!secret.ok) expect(secret.error.code).toBe("privacy_blocked");

      const page = await fixture.evidence.listEvidence(setup.value.growUnitRef, {
        status: "waiting_policy",
        sourceKind: "validation_report",
        text: "policy",
        limit: 1
      });
      expect(page.ok).toBe(true);
      if (page.ok) {
        expect(page.value.records).toHaveLength(1);
        expect(page.value.truncated).toBe(false);
      }

      const accepted = await recordAccepted(fixture, setup.value.growUnitRef, setup.value.dodRef);
      expect(accepted.ok).toBe(true);
      if (!accepted.ok) throw new Error(accepted.error.message);
      const defaultPolicyEvidence = await fixture.evidence.recordEvidenceCandidate({
        growUnitRef: setup.value.growUnitRef,
        sourceKind: "validation_report",
        summary: "default policy evidence",
        content: "{\"passed\":true}",
        artifactKind: "validation_report",
        relationHints: support(setup.value.dodRef),
        source: source(fixture, "tool"),
        version,
        audit: audit("default policy evidence")
      });
      expect(defaultPolicyEvidence.ok).toBe(true);
      if (!defaultPolicyEvidence.ok) throw new Error(defaultPolicyEvidence.error.message);
      const defaultAccepted = await fixture.evidence.acceptEvidenceForEvaluation(defaultPolicyEvidence.value, {
        reason: "default policy context",
        source: source(fixture, "system"),
        audit: audit("default policy context")
      });
      expect(defaultAccepted.ok).toBe(true);

      const inferred = await fixture.evidence.evaluateDoD(setup.value.dodRef, {
        evidenceRefs: [accepted.value],
        source: source(fixture, "system"),
        audit: audit("infer grow unit")
      });
      expect(inferred.ok).toBe(true);
      if (inferred.ok) expect(inferred.value.status).toBe("passed");
    });
  });

  test("surfaces missing refs and invalid JSON parse failures", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeEvidenceFixture(workspace);
      const setup = await createGrowAgendaAndDoD(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const missingEvidenceRef = makeEvidenceRef(makeEvidenceId("evidence-missing"));
      const missingClass = await fixture.evidence.classifyEvidence(missingEvidenceRef);
      expect(missingClass.ok).toBe(false);
      if (!missingClass.ok) expect(missingClass.error.code).toBe("not_found");

      const invalidEval = await fixture.evidence.evaluateDoD(makeDoDRef(makeDoDId("dod-missing")), {
        growUnitRef: setup.value.growUnitRef,
        source: source(fixture, "system"),
        audit: audit("missing dod")
      });
      expect(invalidEval.ok).toBe(false);
      if (!invalidEval.ok) expect(invalidEval.error.code).toBe("dod_missing");
      const invalidInputEval = await fixture.evidence.evaluateDoD(setup.value.dodRef, {
        source: source(fixture, "system"),
        audit: audit("invalid input")
      });
      expect(invalidInputEval.ok).toBe(false);
      if (!invalidInputEval.ok) expect(invalidInputEval.error.code).toBe("invalid_input");

      const missingExplain = await fixture.evidence.explainDoDEvaluation(
        makeDoDEvaluationRef(makeDoDEvaluationId("eval-missing"))
      );
      expect(missingExplain.ok).toBe(false);
      const missingVerdict = await fixture.evidence.explainReadinessVerdict(
        makeReadinessVerdictRef(makeReadinessVerdictId("verdict-missing"))
      );
      expect(missingVerdict.ok).toBe(false);
      const missingAssessmentVerdict = await fixture.evidence.produceReadinessVerdict(
        makeReadinessAssessmentRef(makeReadinessAssessmentId("assessment-missing"))
      );
      expect(missingAssessmentVerdict.ok).toBe(false);

      const invalid = parseJson("{", "bad json");
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) expect(invalid.error.code).toBe("schema_incompatible");
      const storage = new EvidenceStorage(fixture.store, fixture.workspace);
      const assessments = await storage.readAllAssessments();
      expect(assessments.ok).toBe(true);
      if (assessments.ok) expect(assessments.value).toHaveLength(0);
      const emptyEvidenceSummary = await fixture.evidence.buildEvidenceSummary(setup.value.growUnitRef);
      expect(emptyEvidenceSummary.ok).toBe(true);

      const readinessSummary = await fixture.evidence.buildReadinessSummary(setup.value.growUnitRef);
      expect(readinessSummary.ok).toBe(true);
      if (readinessSummary.ok) {
        expect(readinessSummary.value.readyToHatch).toBe(false);
        expect(readinessSummary.value.latestVerdictRef).toBeUndefined();
      }
    });
  });
});

async function recordAccepted(
  fixture: EvidenceFixture,
  growUnitRef: GrowUnitRef,
  dodRef: DoDRef
) {
  const evidence = await fixture.evidence.recordEvidenceCandidate({
    growUnitRef,
    sourceKind: "validation_report",
    summary: "accepted inferred evidence",
    content: "{\"passed\":true}",
    artifactKind: "validation_report",
    relationHints: support(dodRef),
    quality: { trustLevel: "strong" },
    source: source(fixture, "tool"),
    version,
    audit: audit("record accepted")
  });
  if (!evidence.ok) return evidence;
  const accepted = await fixture.evidence.acceptEvidenceForEvaluation(evidence.value, {
    reason: "accept",
    source: source(fixture, "system"),
    audit: audit("accept"),
    policyContext: allowPolicy()
  });
  return accepted.ok ? evidence : accepted;
}

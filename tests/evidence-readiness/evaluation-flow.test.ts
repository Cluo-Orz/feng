import { describe, expect, test } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import {
  allowPolicy,
  audit,
  contradict,
  createGrowAgendaAndDoD,
  denyPolicy,
  makeEvidenceFixture,
  reportArtifactInput,
  source,
  support,
  version
} from "./helpers.js";

describe("Evidence Readiness DoD evaluation", () => {
  test("does not pass DoD from model self-claim or unrelated tool success", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeEvidenceFixture(workspace);
      const setup = await createGrowAgendaAndDoD(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);

      const selfClaim = await fixture.evidence.recordEvidenceCandidate({
        growUnitRef: setup.value.growUnitRef,
        sourceKind: "candidate_output",
        summary: "model says the boss agent is done",
        content: "done",
        relationHints: support(setup.value.dodRef),
        source: source(fixture, "llm"),
        version,
        audit: audit("record self claim")
      });
      expect(selfClaim.ok).toBe(true);
      if (!selfClaim.ok) throw new Error(selfClaim.error.message);
      await fixture.evidence.acceptEvidenceForEvaluation(selfClaim.value, {
        reason: "accept candidate as weak evidence",
        source: source(fixture, "system"),
        audit: audit("accept self claim"),
        policyContext: allowPolicy()
      });
      const weakEval = await fixture.evidence.evaluateDoD(setup.value.dodRef, {
        growUnitRef: setup.value.growUnitRef,
        evidenceRefs: [selfClaim.value],
        source: source(fixture, "system"),
        audit: audit("evaluate weak")
      });
      expect(weakEval.ok).toBe(true);
      if (weakEval.ok) {
        expect(weakEval.value.status).toBe("needs_validation");
        expect(weakEval.value.missingEvidence).toHaveLength(1);
      }

      const toolArtifact = await fixture.artifacts.registerArtifact({
        ...reportArtifactInput(fixture, "{\"tool\":\"ok\"}"),
        kind: "tool_result",
        producerModule: "grow-attempt-runner"
      });
      expect(toolArtifact.ok).toBe(true);
      if (!toolArtifact.ok) throw new Error(toolArtifact.error.message);
      const toolEvidence = await fixture.evidence.recordEvidenceCandidate({
        growUnitRef: setup.value.growUnitRef,
        sourceKind: "tool_result",
        summary: "tool command succeeded but has no DoD relation",
        artifactRef: toolArtifact.value,
        source: source(fixture, "tool"),
        version,
        audit: audit("record tool")
      });
      expect(toolEvidence.ok).toBe(true);
      if (!toolEvidence.ok) throw new Error(toolEvidence.error.message);
      await fixture.evidence.acceptEvidenceForEvaluation(toolEvidence.value, {
        reason: "accept unrelated tool result",
        source: source(fixture, "system"),
        audit: audit("accept tool"),
        policyContext: allowPolicy()
      });
      const toolEval = await fixture.evidence.evaluateDoD(setup.value.dodRef, {
        growUnitRef: setup.value.growUnitRef,
        evidenceRefs: [toolEvidence.value],
        source: source(fixture, "system"),
        audit: audit("evaluate tool")
      });
      expect(toolEval.ok).toBe(true);
      if (toolEval.ok) {
        expect(toolEval.value.status).toBe("needs_validation");
        expect(toolEval.value.supportingEvidenceRefs).toHaveLength(0);
      }
    });
  });

  test("passes with scoped validation report and explains the evaluation", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeEvidenceFixture(workspace);
      const setup = await createGrowAgendaAndDoD(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);

      const evidence = await fixture.evidence.recordEvidenceCandidate({
        growUnitRef: setup.value.growUnitRef,
        sourceKind: "validation_report",
        summary: "legal actions validated for sample world states",
        content: "{\"passed\":true,\"cases\":3}",
        artifactKind: "validation_report",
        mediaType: "application/json",
        relationHints: support(setup.value.dodRef),
        quality: { trustLevel: "strong", observationKind: "test_reported" },
        source: source(fixture, "tool"),
        version,
        audit: audit("record validation")
      });
      expect(evidence.ok).toBe(true);
      if (!evidence.ok) throw new Error(evidence.error.message);
      await fixture.evidence.acceptEvidenceForEvaluation(evidence.value, {
        reason: "accept validation",
        source: source(fixture, "system"),
        audit: audit("accept validation"),
        policyContext: allowPolicy()
      });

      const evaluation = await fixture.evidence.evaluateDoD(setup.value.dodRef, {
        growUnitRef: setup.value.growUnitRef,
        evidenceRefs: [evidence.value],
        source: source(fixture, "system"),
        audit: audit("evaluate validation")
      });
      expect(evaluation.ok).toBe(true);
      if (!evaluation.ok) throw new Error(evaluation.error.message);
      expect(evaluation.value.status).toBe("passed");
      expect(evaluation.value.supportingEvidenceRefs).toHaveLength(1);

      const active = await fixture.evidence.evaluateActiveDoD(setup.value.growUnitRef, {
        source: source(fixture, "system"),
        audit: audit("evaluate active")
      });
      expect(active.ok).toBe(true);
      if (active.ok) {
        expect(active.value.evaluations).toHaveLength(1);
        expect(active.value.evaluations[0]?.status).toBe("passed");
      }

      const explanation = await fixture.evidence.explainDoDEvaluation(evaluation.value.dodEvaluationRef);
      expect(explanation.ok).toBe(true);
      if (explanation.ok) expect(explanation.value.facts.join("\n")).toContain("status=passed");
    });
  });

  test("keeps critical contradicting evidence visible and fails the DoD", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeEvidenceFixture(workspace);
      const setup = await createGrowAgendaAndDoD(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);

      const good = await fixture.evidence.recordEvidenceCandidate({
        growUnitRef: setup.value.growUnitRef,
        sourceKind: "validation_report",
        summary: "one case passed",
        content: "{\"passed\":true}",
        artifactKind: "validation_report",
        relationHints: support(setup.value.dodRef),
        quality: { trustLevel: "strong" },
        source: source(fixture, "tool"),
        version,
        audit: audit("good evidence")
      });
      const bad = await fixture.evidence.recordEvidenceCandidate({
        growUnitRef: setup.value.growUnitRef,
        sourceKind: "external_test_report",
        summary: "sample world state emitted illegal action",
        content: "{\"failed\":true}",
        artifactKind: "validation_report",
        relationHints: contradict(setup.value.dodRef),
        quality: { trustLevel: "strong", contradictionRisk: "critical" },
        source: source(fixture, "tool"),
        version,
        audit: audit("bad evidence")
      });
      expect(good.ok).toBe(true);
      expect(bad.ok).toBe(true);
      if (!good.ok || !bad.ok) throw new Error("record failed");
      for (const ref of [good.value, bad.value]) {
        await fixture.evidence.acceptEvidenceForEvaluation(ref, {
          reason: "accept evidence",
          source: source(fixture, "system"),
          audit: audit("accept"),
          policyContext: allowPolicy()
        });
      }
      const evaluation = await fixture.evidence.evaluateDoD(setup.value.dodRef, {
        growUnitRef: setup.value.growUnitRef,
        evidenceRefs: [good.value, bad.value],
        source: source(fixture, "system"),
        audit: audit("evaluate contradiction")
      });
      expect(evaluation.ok).toBe(true);
      if (evaluation.ok) {
        expect(evaluation.value.status).toBe("failed");
        expect(evaluation.value.contradictingEvidenceRefs).toHaveLength(1);
      }
    });
  });

  test("reports policy-blocked evidence as blocked evaluation", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeEvidenceFixture(workspace);
      const setup = await createGrowAgendaAndDoD(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const artifact = await fixture.artifacts.registerArtifact(reportArtifactInput(fixture));
      expect(artifact.ok).toBe(true);
      if (!artifact.ok) throw new Error(artifact.error.message);
      const evidence = await fixture.evidence.recordEvidenceCandidate({
        growUnitRef: setup.value.growUnitRef,
        sourceKind: "validation_report",
        summary: "blocked validation report",
        artifactRef: artifact.value,
        relationHints: support(setup.value.dodRef),
        source: source(fixture, "tool"),
        version,
        audit: audit("record blocked")
      });
      expect(evidence.ok).toBe(true);
      if (!evidence.ok) throw new Error(evidence.error.message);
      const accepted = await fixture.evidence.acceptEvidenceForEvaluation(evidence.value, {
        reason: "blocked by policy",
        source: source(fixture, "system"),
        audit: audit("policy blocked"),
        policyContext: denyPolicy()
      });
      expect(accepted.ok).toBe(false);

      const evaluation = await fixture.evidence.evaluateDoD(setup.value.dodRef, {
        growUnitRef: setup.value.growUnitRef,
        evidenceRefs: [evidence.value],
        source: source(fixture, "system"),
        audit: audit("evaluate blocked")
      });
      expect(evaluation.ok).toBe(true);
      if (evaluation.ok) {
        expect(evaluation.value.status).toBe("blocked");
        expect(evaluation.value.blockedReasons.join("\n")).toContain("waiting_policy");
      }
    });
  });
});

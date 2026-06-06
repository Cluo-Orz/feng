import { describe, expect, test } from "vitest";
import type { GrowUnitRef } from "../../src/domain/index.js";
import type { DoDRef } from "../../src/agenda-dod-manager/index.js";
import type { EvidenceFixture } from "./helpers.js";
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

describe("Evidence Readiness readiness flow", () => {
  test("assesses without an agenda by registering a fallback agenda summary artifact", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeEvidenceFixture(workspace);
      const grow = await fixture.grow.createGrowUnit({
        title: "fallback-agent",
        goalBoundarySummary: "Grow without agenda to test fallback summary.",
        targetBehaviorSummary: "No target behavior yet.",
        source: source(fixture, "system"),
        version,
        audit: audit("create fallback grow")
      });
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);
      const assessment = await fixture.evidence.assessReadiness(grow.value, {
        source: source(fixture, "system"),
        audit: audit("assess fallback")
      });
      expect(assessment.ok).toBe(true);
      if (assessment.ok) expect(assessment.value.agendaSummaryRef.kind).toBe("artifact");
    });
  });

  test("does not produce ready_to_hatch without active DoD", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeEvidenceFixture(workspace);
      const grow = await fixture.grow.createGrowUnit({
        title: "novel-agent",
        goalBoundarySummary: "Grow a novel-writing agent.",
        targetBehaviorSummary: "Produce chapters with bounded style rules.",
        source: source(fixture, "system"),
        version,
        audit: audit("create grow without dod")
      });
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);
      await fixture.agenda.createAgenda(grow.value, {
        goalBoundarySummary: "agenda exists but DoD is missing",
        currentFocus: "define DoD",
        source: source(fixture, "system"),
        version,
        audit: audit("create agenda")
      });

      const assessment = await fixture.evidence.assessReadiness(grow.value, {
        source: source(fixture, "system"),
        audit: audit("assess no dod")
      });
      expect(assessment.ok).toBe(true);
      if (!assessment.ok) throw new Error(assessment.error.message);
      expect(assessment.value.activeDoDRefs).toHaveLength(0);
      expect(assessment.value.readinessGapRefs).toHaveLength(1);

      const verdict = await fixture.evidence.produceReadinessVerdict(assessment.value.readinessAssessmentRef);
      expect(verdict.ok).toBe(true);
      if (verdict.ok) {
        expect(verdict.value.verdict).toBe("waiting_validation");
        expect(verdict.value.requiredInput.join("\n")).toContain("active DoD");
      }
    });
  });

  test("produces ready verdict artifact without mutating grow unit until explicitly applied", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeEvidenceFixture(workspace);
      const setup = await createGrowAgendaAndDoD(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const evidence = await recordAcceptedValidation(fixture, setup.value.growUnitRef, setup.value.dodRef);
      expect(evidence.ok).toBe(true);
      if (!evidence.ok) throw new Error(evidence.error.message);

      const assessment = await fixture.evidence.assessReadiness(setup.value.growUnitRef, {
        evidenceRefs: [evidence.value],
        source: source(fixture, "system"),
        audit: audit("assess ready")
      });
      expect(assessment.ok).toBe(true);
      if (!assessment.ok) throw new Error(assessment.error.message);
      const verdict = await fixture.evidence.produceReadinessVerdict(assessment.value.readinessAssessmentRef);
      expect(verdict.ok).toBe(true);
      if (!verdict.ok) throw new Error(verdict.error.message);
      expect(verdict.value.verdict).toBe("ready_to_hatch");

      const growBeforeApply = await fixture.grow.getGrowUnit(setup.value.growUnitRef);
      expect(growBeforeApply.ok).toBe(true);
      if (growBeforeApply.ok) expect(growBeforeApply.value.lifecycle).toBe("created");

      await fixture.grow.transitionGrowUnit(setup.value.growUnitRef, {
        to: "planning",
        reason: "move to planning",
        source: source(fixture, "system"),
        audit: audit("planning")
      });
      await fixture.grow.transitionGrowUnit(setup.value.growUnitRef, {
        to: "growing",
        reason: "move to growing",
        source: source(fixture, "system"),
        audit: audit("growing")
      });
      const applied = await fixture.grow.applyReadinessVerdict(setup.value.growUnitRef, {
        reason: "apply evidence readiness verdict",
        source: source(fixture, "system"),
        audit: audit("apply readiness"),
        readinessVerdictRef: verdict.value.artifactRef,
        verdict: {
          verdict: verdict.value.verdict,
          reason: verdict.value.reason,
          evidenceRefs: verdict.value.evidenceArtifactRefs
        }
      });
      expect(applied.ok).toBe(true);
      if (applied.ok) expect(applied.value.to).toBe("ready_to_hatch");

      const explanation = await fixture.evidence.explainReadinessVerdict(verdict.value.readinessVerdictRef);
      expect(explanation.ok).toBe(true);
      if (explanation.ok) expect(explanation.value.facts.join("\n")).toContain("activeDoD=1");
    });
  });

  test("returns not_ready when accepted critical contradiction is present", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeEvidenceFixture(workspace);
      const setup = await createGrowAgendaAndDoD(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const good = await recordAcceptedValidation(fixture, setup.value.growUnitRef, setup.value.dodRef);
      expect(good.ok).toBe(true);
      if (!good.ok) throw new Error(good.error.message);
      const bad = await fixture.evidence.recordEvidenceCandidate({
        growUnitRef: setup.value.growUnitRef,
        sourceKind: "external_test_report",
        summary: "boss emitted illegal action",
        content: "{\"failed\":true}",
        artifactKind: "validation_report",
        relationHints: contradict(setup.value.dodRef),
        quality: { trustLevel: "strong" },
        source: source(fixture, "tool"),
        version,
        audit: audit("record contradiction")
      });
      expect(bad.ok).toBe(true);
      if (!bad.ok) throw new Error(bad.error.message);
      await fixture.evidence.acceptEvidenceForEvaluation(bad.value, {
        reason: "accept contradiction",
        source: source(fixture, "system"),
        audit: audit("accept contradiction"),
        policyContext: allowPolicy()
      });

      const assessment = await fixture.evidence.assessReadiness(setup.value.growUnitRef, {
        evidenceRefs: [good.value, bad.value],
        source: source(fixture, "system"),
        audit: audit("assess contradiction")
      });
      expect(assessment.ok).toBe(true);
      if (!assessment.ok) throw new Error(assessment.error.message);
      const verdict = await fixture.evidence.produceReadinessVerdict(assessment.value.readinessAssessmentRef);
      expect(verdict.ok).toBe(true);
      if (verdict.ok) {
        expect(verdict.value.verdict).toBe("not_ready");
        expect(verdict.value.blockingGaps).toHaveLength(1);
      }
    });
  });

  test("returns waiting_validation when active DoD only has weak self-claim evidence", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeEvidenceFixture(workspace);
      const setup = await createGrowAgendaAndDoD(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const weak = await fixture.evidence.recordEvidenceCandidate({
        growUnitRef: setup.value.growUnitRef,
        sourceKind: "candidate_output",
        summary: "model says ready",
        content: "ready",
        relationHints: support(setup.value.dodRef),
        source: source(fixture, "llm"),
        version,
        audit: audit("record weak")
      });
      expect(weak.ok).toBe(true);
      if (!weak.ok) throw new Error(weak.error.message);
      await fixture.evidence.acceptEvidenceForEvaluation(weak.value, {
        reason: "accept weak",
        source: source(fixture, "system"),
        audit: audit("accept weak"),
        policyContext: allowPolicy()
      });
      const assessment = await fixture.evidence.assessReadiness(setup.value.growUnitRef, {
        evidenceRefs: [weak.value],
        source: source(fixture, "system"),
        audit: audit("assess weak")
      });
      expect(assessment.ok).toBe(true);
      if (!assessment.ok) throw new Error(assessment.error.message);
      const verdict = await fixture.evidence.produceReadinessVerdict(assessment.value.readinessAssessmentRef);
      expect(verdict.ok).toBe(true);
      if (verdict.ok) expect(verdict.value.verdict).toBe("waiting_validation");
    });
  });

  test("returns blocked when evidence needed for readiness is policy blocked", async () => {
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
        summary: "policy blocked validation",
        artifactRef: artifact.value,
        relationHints: support(setup.value.dodRef),
        source: source(fixture, "tool"),
        version,
        audit: audit("record policy blocked")
      });
      expect(evidence.ok).toBe(true);
      if (!evidence.ok) throw new Error(evidence.error.message);
      await fixture.evidence.acceptEvidenceForEvaluation(evidence.value, {
        reason: "deny read",
        source: source(fixture, "system"),
        audit: audit("deny"),
        policyContext: denyPolicy()
      });
      const assessment = await fixture.evidence.assessReadiness(setup.value.growUnitRef, {
        evidenceRefs: [evidence.value],
        source: source(fixture, "system"),
        audit: audit("assess blocked")
      });
      expect(assessment.ok).toBe(true);
      if (!assessment.ok) throw new Error(assessment.error.message);
      const verdict = await fixture.evidence.produceReadinessVerdict(assessment.value.readinessAssessmentRef);
      expect(verdict.ok).toBe(true);
      if (verdict.ok) expect(verdict.value.verdict).toBe("blocked");

      const summary = await fixture.evidence.buildReadinessSummary(setup.value.growUnitRef);
      expect(summary.ok).toBe(true);
      if (summary.ok) {
        expect(summary.value.readyToHatch).toBe(false);
        expect(summary.value.blockingGapCount).toBeGreaterThan(0);
      }
    });
  });

  test("records privacy blocked gap for redacted evidence", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeEvidenceFixture(workspace);
      const setup = await createGrowAgendaAndDoD(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const artifact = await fixture.artifacts.registerArtifact(reportArtifactInput(fixture));
      expect(artifact.ok).toBe(true);
      if (!artifact.ok) throw new Error(artifact.error.message);
      await fixture.artifacts.redactArtifact(artifact.value, "redact before readiness");
      const evidence = await fixture.evidence.recordEvidenceCandidate({
        growUnitRef: setup.value.growUnitRef,
        sourceKind: "validation_report",
        summary: "redacted validation",
        artifactRef: artifact.value,
        relationHints: support(setup.value.dodRef),
        source: source(fixture, "tool"),
        version,
        audit: audit("record redacted readiness")
      });
      expect(evidence.ok).toBe(true);
      if (!evidence.ok) throw new Error(evidence.error.message);
      await fixture.evidence.acceptEvidenceForEvaluation(evidence.value, {
        reason: "redacted evidence",
        source: source(fixture, "system"),
        audit: audit("redacted evidence"),
        policyContext: allowPolicy()
      });
      const assessment = await fixture.evidence.assessReadiness(setup.value.growUnitRef, {
        evidenceRefs: [evidence.value],
        source: source(fixture, "system"),
        audit: audit("assess redacted")
      });
      expect(assessment.ok).toBe(true);
      if (!assessment.ok) throw new Error(assessment.error.message);
      const explanation = await fixture.evidence.produceReadinessVerdict(assessment.value.readinessAssessmentRef);
      expect(explanation.ok).toBe(true);
      if (explanation.ok) expect(explanation.value.verdict).toBe("blocked");
    });
  });
});

async function recordAcceptedValidation(
  fixture: EvidenceFixture,
  growUnitRef: GrowUnitRef,
  dodRef: DoDRef
) {
  const evidence = await fixture.evidence.recordEvidenceCandidate({
    growUnitRef,
    sourceKind: "validation_report",
    summary: "sample world states passed legal-action validation",
    content: "{\"passed\":true}",
    artifactKind: "validation_report",
    mediaType: "application/json",
    relationHints: support(dodRef),
    quality: { trustLevel: "strong", observationKind: "test_reported" },
    source: source(fixture, "tool"),
    version,
    audit: audit("record validation")
  });
  if (!evidence.ok) return evidence;
  const accepted = await fixture.evidence.acceptEvidenceForEvaluation(evidence.value, {
    reason: "accept validation",
    source: source(fixture, "system"),
    audit: audit("accept validation"),
    policyContext: allowPolicy()
  });
  return accepted.ok ? evidence : accepted;
}

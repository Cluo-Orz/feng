import { describe, expect, test } from "vitest";
import { makeReadinessVerdictId, makeReadinessVerdictRef } from "../../src/evidence-readiness/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import {
  allowHatchPublish,
  contractInput,
  createGrowAgendaDod,
  hatchInput,
  makeHatchFixture,
  readyVerdict,
  source,
  version
} from "./helpers.js";

describe("Hatch Builder gates", () => {
  test("does not build a plan when readiness verdict is missing", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeHatchFixture(workspace);
      const setup = await createGrowAgendaDod(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const contract = await fixture.contracts.registerRuntimeContract(contractInput(fixture, setup.value.growUnitRef));
      expect(contract.ok).toBe(true);
      if (!contract.ok) throw new Error(contract.error.message);
      const missingReadiness = makeReadinessVerdictRef(makeReadinessVerdictId("readiness-missing"));
      const request = await fixture.hatch.requestHatch(hatchInput(fixture, {
        growUnitRef: setup.value.growUnitRef,
        readinessVerdictRef: missingReadiness,
        runtimeContractRef: contract.value
      }));
      expect(request.ok).toBe(true);
      if (!request.ok) throw new Error(request.error.message);
      const plan = await fixture.hatch.buildHatchPlan(request.value, allowHatchPublish());
      expect(plan.ok).toBe(false);
      if (!plan.ok) expect(plan.error.code).toBe("readiness_missing");
    });
  });

  test("does not build a plan when runtime contract is not locked", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeHatchFixture(workspace);
      const setup = await createGrowAgendaDod(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const verdict = await readyVerdict(fixture, setup.value.growUnitRef, setup.value.dodRef);
      expect(verdict.ok).toBe(true);
      if (!verdict.ok) throw new Error(verdict.error.message);
      const contract = await fixture.contracts.registerRuntimeContract(contractInput(fixture, setup.value.growUnitRef, {
        evidenceRefs: verdict.value.evidenceArtifactRefs,
        readinessVerdictRef: verdict.value.readinessVerdictRef,
        version
      }));
      expect(contract.ok).toBe(true);
      if (!contract.ok) throw new Error(contract.error.message);
      const request = await fixture.hatch.requestHatch(hatchInput(fixture, {
        growUnitRef: setup.value.growUnitRef,
        readinessVerdictRef: verdict.value.readinessVerdictRef,
        runtimeContractRef: contract.value
      }, { source: source(fixture, "system") }));
      expect(request.ok).toBe(true);
      if (!request.ok) throw new Error(request.error.message);
      const plan = await fixture.hatch.buildHatchPlan(request.value, allowHatchPublish());
      expect(plan.ok).toBe(false);
      if (!plan.ok) expect(plan.error.code).toBe("contract_not_ready");
    });
  });

  test("does not build a plan when readiness verdict is not ready_to_hatch", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeHatchFixture(workspace);
      const setup = await createGrowAgendaDod(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const weakEvidence = await fixture.evidence.recordEvidenceCandidate({
        growUnitRef: setup.value.growUnitRef,
        sourceKind: "candidate_output",
        summary: "model says ready",
        content: "ready",
        relationHints: [{ relation: "supports", relatedDoDRef: setup.value.dodRef, criticality: "normal", reason: "weak" }],
        source: source(fixture, "llm"),
        version,
        audit: { createdAt: "2026-06-06T00:00:00.000Z", createdBy: "hatch-test", reason: "weak" }
      });
      expect(weakEvidence.ok).toBe(true);
      if (!weakEvidence.ok) throw new Error(weakEvidence.error.message);
      await fixture.evidence.acceptEvidenceForEvaluation(weakEvidence.value, {
        reason: "accept weak",
        source: source(fixture, "system"),
        audit: { createdAt: "2026-06-06T00:00:00.000Z", createdBy: "hatch-test", reason: "accept weak" }
      });
      const assessment = await fixture.evidence.assessReadiness(setup.value.growUnitRef, {
        evidenceRefs: [weakEvidence.value],
        source: source(fixture, "system"),
        audit: { createdAt: "2026-06-06T00:00:00.000Z", createdBy: "hatch-test", reason: "assess weak" }
      });
      expect(assessment.ok).toBe(true);
      if (!assessment.ok) throw new Error(assessment.error.message);
      const notReady = await fixture.evidence.produceReadinessVerdict(assessment.value.readinessAssessmentRef);
      expect(notReady.ok).toBe(true);
      if (!notReady.ok) throw new Error(notReady.error.message);
      const contract = await fixture.contracts.registerRuntimeContract(contractInput(fixture, setup.value.growUnitRef));
      expect(contract.ok).toBe(true);
      if (!contract.ok) throw new Error(contract.error.message);
      const request = await fixture.hatch.requestHatch(hatchInput(fixture, {
        growUnitRef: setup.value.growUnitRef,
        readinessVerdictRef: notReady.value.readinessVerdictRef,
        runtimeContractRef: contract.value
      }));
      expect(request.ok).toBe(true);
      if (!request.ok) throw new Error(request.error.message);
      const plan = await fixture.hatch.buildHatchPlan(request.value, allowHatchPublish());
      expect(plan.ok).toBe(false);
      if (!plan.ok) expect(plan.error.code).toBe("readiness_failed");
    });
  });

  test("requires hatch publish policy before planning", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeHatchFixture(workspace);
      const setup = await createGrowAgendaDod(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const verdict = await readyVerdict(fixture, setup.value.growUnitRef, setup.value.dodRef);
      expect(verdict.ok).toBe(true);
      if (!verdict.ok) throw new Error(verdict.error.message);
      const contract = await fixture.contracts.registerRuntimeContract(contractInput(fixture, setup.value.growUnitRef, {
        evidenceRefs: verdict.value.evidenceArtifactRefs,
        readinessVerdictRef: verdict.value.readinessVerdictRef
      }));
      expect(contract.ok).toBe(true);
      if (!contract.ok) throw new Error(contract.error.message);
      await fixture.contracts.verifyRuntimeContractForHatch(contract.value, verdict.value.readinessVerdictRef);
      await fixture.contracts.lockRuntimeContractForHatch(contract.value, {
        reason: "lock",
        policyContext: allowHatchPublish()
      });
      const request = await fixture.hatch.requestHatch(hatchInput(fixture, {
        growUnitRef: setup.value.growUnitRef,
        readinessVerdictRef: verdict.value.readinessVerdictRef,
        runtimeContractRef: contract.value
      }));
      expect(request.ok).toBe(true);
      if (!request.ok) throw new Error(request.error.message);
      const plan = await fixture.hatch.buildHatchPlan(request.value);
      expect(plan.ok).toBe(false);
      if (!plan.ok) expect(plan.error.code).toBe("approval_required");
    });
  });

  test("refuses hatch requests for archived grow units", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeHatchFixture(workspace);
      const setup = await createGrowAgendaDod(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const verdict = await readyVerdict(fixture, setup.value.growUnitRef, setup.value.dodRef);
      expect(verdict.ok).toBe(true);
      if (!verdict.ok) throw new Error(verdict.error.message);
      const contract = await fixture.contracts.registerRuntimeContract(contractInput(fixture, setup.value.growUnitRef));
      expect(contract.ok).toBe(true);
      if (!contract.ok) throw new Error(contract.error.message);
      await fixture.grow.archiveGrowUnit(setup.value.growUnitRef, {
        reason: "archive",
        source: source(fixture, "system"),
        audit: { createdAt: "2026-06-06T00:00:00.000Z", createdBy: "hatch-test", reason: "archive" },
        policyContext: { caller: "hatch-test", environment: { hostSandboxAvailable: false, networkAvailable: false, externalEnforcementAvailable: false, secretStoreAvailable: false }, rules: [{ capability: "file.delete", resource: "*", verdict: "allow" }] }
      });
      const request = await fixture.hatch.requestHatch(hatchInput(fixture, {
        growUnitRef: setup.value.growUnitRef,
        readinessVerdictRef: verdict.value.readinessVerdictRef,
        runtimeContractRef: contract.value
      }));
      expect(request.ok).toBe(false);
      if (!request.ok) expect(request.error.code).toBe("grow_unit_archived");
    });
  });
});

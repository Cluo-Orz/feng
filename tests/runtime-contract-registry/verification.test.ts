import { describe, expect, test } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import {
  allowHatchPublish,
  audit,
  completeShape,
  contractInput,
  createGrowAgendaDod,
  makeContractFixture,
  readyVerdict,
  source,
  version
} from "./helpers.js";

describe("Runtime Contract Registry verification", () => {
  test("reports incomplete contracts and refuses to lock before hatch verification", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContractFixture(workspace);
      const setup = await createGrowAgendaDod(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const incomplete = await fixture.contracts.registerRuntimeContract({
        growUnitRef: setup.value.growUnitRef,
        name: "incomplete",
        version,
        runtimeKernelType: "hybrid_runtime",
        source: source(fixture, "system"),
        audit: audit("incomplete")
      });
      expect(incomplete.ok).toBe(true);
      if (!incomplete.ok) throw new Error(incomplete.error.message);
      const report = await fixture.contracts.validateRuntimeContract(incomplete.value);
      expect(report.ok).toBe(true);
      if (report.ok) {
        expect(report.value.complete).toBe(false);
        expect(report.value.missing.join("\n")).toContain("input contract");
      }
      const locked = await fixture.contracts.lockRuntimeContractForHatch(incomplete.value, {
        reason: "lock too early",
        policyContext: allowHatchPublish()
      });
      expect(locked.ok).toBe(false);
      if (!locked.ok) expect(locked.error.code).toBe("contract_not_ready");
    });
  });

  test("validates, verifies against ready verdict, and locks without creating hatch package", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContractFixture(workspace);
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
      const completeness = await fixture.contracts.validateRuntimeContract(contract.value);
      expect(completeness.ok).toBe(true);
      if (completeness.ok) expect(completeness.value.complete).toBe(true);

      const verification = await fixture.contracts.verifyRuntimeContractForHatch(contract.value, verdict.value.readinessVerdictRef);
      expect(verification.ok).toBe(true);
      if (!verification.ok) throw new Error(verification.error.message);
      expect(verification.value.verifiedForHatch).toBe(true);

      const locked = await fixture.contracts.lockRuntimeContractForHatch(contract.value, {
        reason: "lock for hatch",
        policyContext: allowHatchPublish()
      });
      expect(locked.ok).toBe(true);
      if (locked.ok) expect(locked.value.to).toBe("locked_for_hatch");
      const record = await fixture.contracts.getRuntimeContract(contract.value);
      expect(record.ok).toBe(true);
      if (record.ok) {
        expect(record.value.lifecycle).toBe("locked_for_hatch");
        expect(record.value.hatchPackageRef).toBeUndefined();
      }
    });
  });

  test("fails hatch verification for non-ready readiness and unsupported capabilities", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContractFixture(workspace);
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
        audit: audit("weak")
      });
      expect(weakEvidence.ok).toBe(true);
      if (!weakEvidence.ok) throw new Error(weakEvidence.error.message);
      await fixture.evidence.acceptEvidenceForEvaluation(weakEvidence.value, {
        reason: "accept weak",
        source: source(fixture, "system"),
        audit: audit("accept weak")
      });
      const assessment = await fixture.evidence.assessReadiness(setup.value.growUnitRef, {
        evidenceRefs: [weakEvidence.value],
        source: source(fixture, "system"),
        audit: audit("assess weak")
      });
      expect(assessment.ok).toBe(true);
      if (!assessment.ok) throw new Error(assessment.error.message);
      const notReady = await fixture.evidence.produceReadinessVerdict(assessment.value.readinessAssessmentRef);
      expect(notReady.ok).toBe(true);
      if (!notReady.ok) throw new Error(notReady.error.message);

      const contract = await fixture.contracts.registerRuntimeContract(contractInput(fixture, setup.value.growUnitRef));
      expect(contract.ok).toBe(true);
      if (!contract.ok) throw new Error(contract.error.message);
      const verification = await fixture.contracts.verifyRuntimeContractForHatch(contract.value, notReady.value.readinessVerdictRef);
      expect(verification.ok).toBe(true);
      if (verification.ok) {
        expect(verification.value.verifiedForHatch).toBe(false);
        expect(verification.value.blockers.join("\n")).toContain("not ready_to_hatch");
      }

      const unsupported = await fixture.contracts.registerRuntimeContract(contractInput(fixture, setup.value.growUnitRef, {
        shape: completeShape(false),
        capabilityRequirements: ["secret.read"]
      }));
      expect(unsupported.ok).toBe(true);
      if (!unsupported.ok) throw new Error(unsupported.error.message);
      const unsupportedVerification = await fixture.contracts.verifyRuntimeContractForHatch(unsupported.value, notReady.value.readinessVerdictRef);
      expect(unsupportedVerification.ok).toBe(false);
      if (!unsupportedVerification.ok) expect(unsupportedVerification.error.code).toBe("capability_unsupported");
    });
  });
});

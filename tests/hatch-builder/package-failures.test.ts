import { describe, expect, test } from "vitest";
import {
  hatchBuildPlanPath,
  HatchBuilderStorage,
  makeHatchPackageRef,
  newHatchBuildReceiptRef,
  newHatchExclusionRef,
  type HatchPackageRecord
} from "../../src/hatch-builder/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import {
  allowHatchPublish,
  hatchInput,
  lockedContractSetup,
  makeHatchFixture,
  policy
} from "./helpers.js";

describe("Hatch Builder package failure paths", () => {
  test("requires publish policy and refuses publishing retracted packages", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeHatchFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const packageRef = await buildPackage(fixture, hatchInput(fixture, setup.value));
      expect(packageRef.ok).toBe(true);
      if (!packageRef.ok) throw new Error(packageRef.error.message);

      const withoutPolicy = await fixture.hatch.publishLocalHatchPackage(packageRef.value, { reason: "publish" });
      expect(withoutPolicy.ok).toBe(false);
      if (!withoutPolicy.ok) expect(withoutPolicy.error.code).toBe("approval_required");
      const denied = await fixture.hatch.publishLocalHatchPackage(packageRef.value, {
        reason: "deny publish",
        policyContext: policy([{ capability: "hatch.publish", resource: "*", verdict: "deny" }])
      });
      expect(denied.ok).toBe(false);
      if (!denied.ok) expect(denied.error.code).toBe("policy_blocked");
      const retracted = await fixture.hatch.retractHatchPackage(packageRef.value, "withdraw");
      expect(retracted.ok).toBe(true);
      const publishRetracted = await fixture.hatch.publishLocalHatchPackage(packageRef.value, {
        reason: "publish retracted",
        policyContext: allowHatchPublish()
      });
      expect(publishRetracted.ok).toBe(false);
      if (!publishRetracted.ok) expect(publishRetracted.error.code).toBe("invalid_state");
    });
  });

  test("verification reports unreadable package artifacts and missing explanation refs", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeHatchFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const packageRef = await buildPackage(fixture, hatchInput(fixture, setup.value));
      expect(packageRef.ok).toBe(true);
      if (!packageRef.ok) throw new Error(packageRef.error.message);
      const record = await fixture.hatch.getHatchPackage(packageRef.value);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);
      await fixture.artifacts.redactArtifact(record.value.artifactRef, "hide package");
      const verification = await fixture.hatch.verifyHatchPackage(packageRef.value);
      expect(verification.ok).toBe(true);
      if (verification.ok) expect(verification.value.passed).toBe(false);

      const missingInclusion = await fixture.hatch.explainResourceInclusion({ kind: "hatch_resource", id: "missing" as never });
      expect(missingInclusion.ok).toBe(false);
      if (!missingInclusion.ok) expect(missingInclusion.error.code).toBe("not_found");
      const missingExclusion = await fixture.hatch.explainResourceExclusion({ kind: "hatch_exclusion", id: "missing" as never });
      expect(missingExclusion.ok).toBe(false);
      if (!missingExclusion.ok) expect(missingExclusion.error.code).toBe("not_found");
    });
  });

  test("verification and publish reject malformed hatch package documents", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeHatchFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const packageRef = await buildPackage(fixture, hatchInput(fixture, setup.value));
      expect(packageRef.ok).toBe(true);
      if (!packageRef.ok) throw new Error(packageRef.error.message);
      const record = await fixture.hatch.getHatchPackage(packageRef.value);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);
      const artifact = await fixture.artifacts.resolveArtifact(record.value.artifactRef);
      expect(artifact.ok).toBe(true);
      if (!artifact.ok) throw new Error(artifact.error.message);
      expect(artifact.value.contentLocation.kind).toBe("managed");
      if (artifact.value.contentLocation.kind === "managed") {
        const corrupt = await fixture.store.writeTextAtomic(fixture.workspace, artifact.value.contentLocation.logicalPath, "{", {
          reason: "corrupt hatch package document",
          createParents: true
        });
        expect(corrupt.ok).toBe(true);
      }

      const verification = await fixture.hatch.verifyHatchPackage(packageRef.value);
      expect(verification.ok).toBe(true);
      if (verification.ok) {
        expect(verification.value.passed).toBe(false);
        expect(verification.value.blockers.join("\n")).toContain("package contains no secret-like material");
      }
      const publish = await fixture.hatch.publishLocalHatchPackage(packageRef.value, {
        reason: "publish corrupt package",
        policyContext: allowHatchPublish()
      });
      expect(publish.ok).toBe(false);
      if (!publish.ok) expect(publish.error.code).toBe("package_verification_failed");
    });
  });

  test("package explanations surface bad plans and sparse exclusion facts", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeHatchFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const request = await fixture.hatch.requestHatch(hatchInput(fixture, setup.value, {
        packageName: "explain-package",
        requestedVersion: { schemaVersion: "3.0.0", producerVersion: "hatch-test" }
      }));
      expect(request.ok).toBe(true);
      if (!request.ok) throw new Error(request.error.message);
      const plan = await fixture.hatch.buildHatchPlan(request.value, allowHatchPublish());
      expect(plan.ok).toBe(true);
      if (!plan.ok) throw new Error(plan.error.message);
      const sparseExclusion = {
        exclusionRef: newHatchExclusionRef(),
        required: false,
        reason: "temporary_context",
        detail: "manual sparse exclusion for explanation",
        policyDecisionRefs: [],
        source: plan.value.source,
        audit: plan.value.audit
      };
      const sparsePlan = {
        ...plan.value,
        excludedResources: [...plan.value.excludedResources, sparseExclusion]
      };
      const sparseWrite = await fixture.store.writeTextAtomic(
        fixture.workspace,
        hatchBuildPlanPath(plan.value.hatchBuildPlanRef.id),
        JSON.stringify(sparsePlan, null, 2),
        { reason: "write sparse hatch build plan", createParents: true }
      );
      expect(sparseWrite.ok).toBe(true);
      const sparseExplanation = await fixture.hatch.explainResourceExclusion(sparseExclusion.exclusionRef);
      expect(sparseExplanation.ok).toBe(true);
      if (sparseExplanation.ok) {
        expect(sparseExplanation.value.facts).toContain("artifact=none");
        expect(sparseExplanation.value.facts).toContain("role=unknown");
        expect(sparseExplanation.value.facts).toContain("sourceModule=unknown");
      }
      const packageRef = await fixture.hatch.buildHatchPackage(plan.value.hatchBuildPlanRef);
      expect(packageRef.ok).toBe(true);
      if (!packageRef.ok) throw new Error(packageRef.error.message);
      const corruptPlan = await fixture.store.writeTextAtomic(
        fixture.workspace,
        hatchBuildPlanPath(plan.value.hatchBuildPlanRef.id),
        "{",
        { reason: "corrupt hatch build plan", createParents: true }
      );
      expect(corruptPlan.ok).toBe(true);
      const explanation = await fixture.hatch.explainHatchPackage(packageRef.value);
      expect(explanation.ok).toBe(false);
      if (!explanation.ok) expect(explanation.error.code).toBe("schema_incompatible");
    });
  });

  test("build package refuses versions claimed after plan creation", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeHatchFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const request = await fixture.hatch.requestHatch(hatchInput(fixture, setup.value, {
        packageName: "late-conflict",
        requestedVersion: { schemaVersion: "5.0.0", producerVersion: "hatch-test" }
      }));
      expect(request.ok).toBe(true);
      if (!request.ok) throw new Error(request.error.message);
      const plan = await fixture.hatch.buildHatchPlan(request.value, allowHatchPublish());
      expect(plan.ok).toBe(true);
      if (!plan.ok) throw new Error(plan.error.message);
      const storage = new HatchBuilderStorage(fixture.store, fixture.workspace);
      const blockerRef = makeHatchPackageRef("hatch-package-late-conflict");
      const now = new Date().toISOString();
      const existing: HatchPackageRecord = {
        hatchPackageId: blockerRef.id,
        hatchPackageRef: blockerRef,
        packageName: "late-conflict",
        hatchRequestRef: plan.value.hatchRequestRef,
        hatchBuildPlanRef: plan.value.hatchBuildPlanRef,
        growUnitRef: plan.value.growUnitRef,
        runtimeContractRef: plan.value.runtimeContractRef,
        readinessVerdictRef: plan.value.readinessVerdictRef,
        version: plan.value.versionPlan,
        lifecycle: "packaged",
        artifactRef: plan.value.includedResources[0]!.artifactRef,
        manifestRef: plan.value.includedResources[0]!.artifactRef,
        includedResourceRefs: [],
        excludedResourceRefs: [],
        policyDecisionRefs: [],
        validationSummaryRefs: [],
        buildReceiptRef: newHatchBuildReceiptRef(),
        source: plan.value.source,
        audit: plan.value.audit,
        createdAt: now,
        updatedAt: now,
        recordVersion: 1
      };
      const written = await storage.writePackage(existing, "write late conflict package");
      expect(written.ok).toBe(true);
      const indexed = await storage.addPackage(blockerRef);
      expect(indexed.ok).toBe(true);

      const packageRef = await fixture.hatch.buildHatchPackage(plan.value.hatchBuildPlanRef);
      expect(packageRef.ok).toBe(false);
      if (!packageRef.ok) expect(packageRef.error.code).toBe("package_version_conflict");
    });
  });
});

async function buildPackage(fixture: ReturnType<typeof makeHatchFixture>, input: Parameters<typeof fixture.hatch.requestHatch>[0]) {
  const request = await fixture.hatch.requestHatch(input);
  if (!request.ok) return request;
  const plan = await fixture.hatch.buildHatchPlan(request.value, allowHatchPublish());
  if (!plan.ok) return plan;
  return fixture.hatch.buildHatchPackage(plan.value.hatchBuildPlanRef);
}

import { describe, expect, test } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import {
  allowHatchPublish,
  hatchInput,
  lockedContractSetup,
  makeHatchFixture,
  registerActiveSkill,
  registerTextArtifact
} from "./helpers.js";

describe("Hatch Builder happy path", () => {
  test("plans, builds, verifies, publishes, and explains a self-contained hatch package", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeHatchFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);

      const asset = await registerTextArtifact(fixture, { content: "boss config" });
      expect(asset.ok).toBe(true);
      if (!asset.ok) throw new Error(asset.error.message);
      const skill = await registerActiveSkill(fixture, setup.value.growUnitRef, [asset.value]);
      expect(skill.ok).toBe(true);
      if (!skill.ok) throw new Error(String(skill.error));

      const request = await fixture.hatch.requestHatch(hatchInput(fixture, setup.value, {
        resourceCandidates: [{
          artifactRef: asset.value,
          role: "configuration_template",
          required: false,
          targetPathHint: "config/boss.txt",
          inclusionReason: "stable boss configuration"
        }]
      }));
      expect(request.ok).toBe(true);
      if (!request.ok) throw new Error(request.error.message);

      const plan = await fixture.hatch.buildHatchPlan(request.value, allowHatchPublish());
      expect(plan.ok).toBe(true);
      if (!plan.ok) throw new Error(plan.error.message);
      expect(plan.value.includedResources.map((item) => item.role)).toContain("runtime_contract");
      expect(plan.value.includedResources.map((item) => item.role)).toContain("skill_body");
      expect(plan.value.skillVersions).toHaveLength(1);
      const includedExplanation = await fixture.hatch.explainResourceInclusion(plan.value.includedResources[0]!.resourceRef);
      expect(includedExplanation.ok).toBe(true);
      if (includedExplanation.ok) expect(includedExplanation.value.facts.join("\n")).toContain("artifact=");

      const packageRef = await fixture.hatch.buildHatchPackage(plan.value.hatchBuildPlanRef);
      expect(packageRef.ok).toBe(true);
      if (!packageRef.ok) throw new Error(packageRef.error.message);
      const record = await fixture.hatch.getHatchPackage(packageRef.value);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);
      expect(record.value.lifecycle).toBe("packaged");
      expect(record.value.runtimeContractRef.id).toBe(setup.value.runtimeContractRef.id);

      const materialized = await fixture.artifacts.materializeArtifact(record.value.artifactRef, {
        reason: "read built package",
        maxBytes: 1024 * 1024
      });
      expect(materialized.ok).toBe(true);
      if (materialized.ok && typeof materialized.value.content === "string") {
        expect(materialized.value.content).toContain("\"manifest\"");
        expect(materialized.value.content).toContain("Use tick state");
        expect(materialized.value.content).toContain("boss config");
      }

      const verification = await fixture.hatch.verifyHatchPackage(packageRef.value);
      expect(verification.ok).toBe(true);
      if (verification.ok) expect(verification.value.passed).toBe(true);
      const published = await fixture.hatch.publishLocalHatchPackage(packageRef.value, {
        reason: "make local package available",
        policyContext: allowHatchPublish()
      });
      expect(published.ok).toBe(true);
      if (published.ok) expect(published.value.to).toBe("published_local");
      const explanation = await fixture.hatch.explainHatchPackage(packageRef.value);
      expect(explanation.ok).toBe(true);
      if (explanation.ok) expect(explanation.value.facts.join("\n")).toContain("included=");
    });
  });

  test("uses the grow unit as the default package name when request omits packageName", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeHatchFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const { packageName: _packageName, ...input } = hatchInput(fixture, setup.value, {
        requestedVersion: { schemaVersion: "4.0.0", producerVersion: "hatch-test" }
      });
      const request = await fixture.hatch.requestHatch(input);
      expect(request.ok).toBe(true);
      if (!request.ok) throw new Error(request.error.message);
      const plan = await fixture.hatch.buildHatchPlan(request.value, allowHatchPublish());
      expect(plan.ok).toBe(true);
      if (!plan.ok) throw new Error(plan.error.message);
      const packageRef = await fixture.hatch.buildHatchPackage(plan.value.hatchBuildPlanRef);
      expect(packageRef.ok).toBe(true);
      if (!packageRef.ok) throw new Error(packageRef.error.message);
      const record = await fixture.hatch.getHatchPackage(packageRef.value);
      expect(record.ok).toBe(true);
      if (record.ok) expect(record.value.packageName).toBe(`hatch-${setup.value.growUnitRef.id}`);
    });
  });
});

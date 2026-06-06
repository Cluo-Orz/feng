import { describe, expect, test } from "vitest";
import {
  allowHatchPublish,
  audit,
  hatchInput,
  lockedContractSetup,
  makeHatchFixture,
  source,
  version
} from "./helpers.js";
import { withWorkspace } from "../file-store/helpers.js";

describe("Hatch Builder additional edge paths", () => {
  test("selectHatchResources supports explicit skill refs and excludes hashless external handles", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeHatchFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const skill = await fixture.skills.registerSkill({
        name: "explicit-skill",
        family: "explicit",
        version,
        sourceKind: "workspace_local",
        source: source(fixture, "system"),
        scope: { workspace: fixture.workspace.id, growUnit: setup.value.growUnitRef.id },
        description: "Explicitly selected skill.",
        triggerSummary: "Selected by hatch request.",
        body: "Explicit skill body.",
        privacyClass: "workspace_private",
        audit: audit("register explicit skill")
      });
      expect(skill.ok).toBe(true);
      if (!skill.ok) throw new Error(skill.error.message);
      const external = await fixture.artifacts.registerExternalHandle({
        kind: "source_material",
        handle: "external://missing-hash",
        mediaType: "text/plain",
        source: source(fixture, "system"),
        version,
        audit: audit("external without hash"),
        privacyClass: "workspace_private",
        retentionClass: "hatch_scoped",
        producerModule: "human",
        trusted: true
      });
      expect(external.ok).toBe(true);
      if (!external.ok) throw new Error(external.error.message);

      const selection = await fixture.hatch.selectHatchResources(hatchInput(fixture, setup.value, {
        skillRefs: [skill.value],
        resourceCandidates: [{ artifactRef: external.value, role: "source_material_snapshot" }]
      }), allowHatchPublish());
      expect(selection.ok).toBe(true);
      if (selection.ok) {
        expect(selection.value.skillVersions.map((item) => item.skillRef.id)).toContain(skill.value.id);
        expect(selection.value.excludedResources.map((item) => item.reason)).toContain("privacy_unknown");
      }
    });
  });

  test("buildHatchPlan refuses a retracted runtime contract", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeHatchFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const retracted = await fixture.contracts.retractRuntimeContract(setup.value.runtimeContractRef, "bad contract");
      expect(retracted.ok).toBe(true);
      const request = await fixture.hatch.requestHatch(hatchInput(fixture, setup.value, {
        packageName: "retracted-contract",
        requestedVersion: { schemaVersion: "2.0.0", producerVersion: "hatch-test" }
      }));
      expect(request.ok).toBe(true);
      if (!request.ok) throw new Error(request.error.message);
      const plan = await fixture.hatch.buildHatchPlan(request.value, allowHatchPublish());
      expect(plan.ok).toBe(false);
      if (!plan.ok) expect(plan.error.code).toBe("contract_retracted");
    });
  });
});

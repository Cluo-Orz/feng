import { describe, expect, test } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import { contractInput, completeShape } from "../runtime-contract-registry/helpers.js";
import {
  audit,
  lockedContractSetup,
  makeTargetFixture,
  registerGameWorld,
  source
} from "./helpers.js";

describe("Target World Adapter compatibility edge cases", () => {
  test("reports warnings for contracts without explicit target modes", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeTargetFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const target = await registerGameWorld(fixture);
      expect(target.ok).toBe(true);
      if (!target.ok) throw new Error(target.error.message);
      const noShape = await fixture.contracts.registerRuntimeContract(contractInput(fixture, setup.value.growUnitRef, {
        name: "shape-less-contract",
        version: { schemaVersion: "20.0.0", producerVersion: "target-test" },
        shape: {},
        capabilityRequirements: []
      }));
      expect(noShape.ok).toBe(true);
      if (!noShape.ok) throw new Error(noShape.error.message);
      const report = await fixture.target.checkRuntimeContractCompatibility(noShape.value, target.value.targetWorldRef);
      expect(report.ok).toBe(true);
      if (!report.ok) throw new Error(report.error.message);
      expect(report.value.compatible).toBe(true);
      expect(report.value.warnings).toContain("contract has no explicit input modes");
      expect(report.value.warnings).toContain("contract has no explicit output modes");
      expect(report.value.warnings).toContain("contract declares no target actions");
      const explanation = await fixture.target.explainCompatibility(report.value.reportRef);
      expect(explanation.ok).toBe(true);
      if (explanation.ok) expect(explanation.value.join("\n")).toContain("actions=none");
    });
  });

  test("reports concrete blockers for incompatible contract boundaries", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeTargetFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const target = await registerGameWorld(fixture);
      expect(target.ok).toBe(true);
      if (!target.ok) throw new Error(target.error.message);
      const base = completeShape(false);
      const incompatible = await fixture.contracts.registerRuntimeContract(contractInput(fixture, setup.value.growUnitRef, {
        name: "incompatible-contract",
        version: { schemaVersion: "21.0.0", producerVersion: "target-test" },
        shape: {
          ...base,
          input: { ...base.input!, inputModes: ["sensor_frame"] },
          output: { ...base.output!, outputModes: ["text_result"] },
          actionBoundary: { ...base.actionBoundary!, allowedActionKinds: ["teleport"], forbiddenActionKinds: [] }
        }
      }));
      expect(incompatible.ok).toBe(true);
      if (!incompatible.ok) throw new Error(incompatible.error.message);
      const report = await fixture.target.checkRuntimeContractCompatibility(incompatible.value, target.value.targetWorldRef);
      expect(report.ok).toBe(true);
      if (!report.ok) throw new Error(report.error.message);
      expect(report.value.compatible).toBe(false);
      expect(report.value.blockers).toContain("no shared input kind");
      expect(report.value.blockers).toContain("no shared output kind");
      expect(report.value.blockers).toContain("target action unsupported:teleport");
    });
  });

  test("reports action contradictions and retracted contracts", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeTargetFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const target = await registerGameWorld(fixture);
      expect(target.ok).toBe(true);
      if (!target.ok) throw new Error(target.error.message);
      const base = completeShape(false);
      const contradictory = await fixture.contracts.registerRuntimeContract(contractInput(fixture, setup.value.growUnitRef, {
        name: "contradictory-contract",
        version: { schemaVersion: "22.0.0", producerVersion: "target-test" },
        shape: {
          ...base,
          actionBoundary: { ...base.actionBoundary!, allowedActionKinds: ["move"], forbiddenActionKinds: ["move"] }
        }
      }));
      expect(contradictory.ok).toBe(true);
      if (!contradictory.ok) throw new Error(contradictory.error.message);
      const contradiction = await fixture.target.checkRuntimeContractCompatibility(contradictory.value, target.value.targetWorldRef);
      expect(contradiction.ok).toBe(true);
      if (contradiction.ok) expect(contradiction.value.blockers).toContain("action both allowed and forbidden:move");

      const retracted = await fixture.contracts.registerRuntimeContract(contractInput(fixture, setup.value.growUnitRef, {
        name: "retracted-contract",
        version: { schemaVersion: "23.0.0", producerVersion: "target-test" }
      }));
      expect(retracted.ok).toBe(true);
      if (!retracted.ok) throw new Error(retracted.error.message);
      const receipt = await fixture.contracts.retractRuntimeContract(retracted.value, "retract for compatibility");
      expect(receipt.ok).toBe(true);
      const report = await fixture.target.checkRuntimeContractCompatibility(retracted.value, target.value.targetWorldRef);
      expect(report.ok).toBe(true);
      if (report.ok) expect(report.value.blockers).toContain("runtime contract is retracted");
    });
  });
});

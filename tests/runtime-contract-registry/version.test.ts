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

describe("Runtime Contract Registry versions and lifecycle", () => {
  test("adds immutable versions, compares compatibility, and marks old version superseded", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContractFixture(workspace);
      const setup = await createGrowAgendaDod(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);

      const first = await fixture.contracts.registerRuntimeContract(contractInput(fixture, setup.value.growUnitRef));
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error(first.error.message);
      const second = await fixture.contracts.addRuntimeContractVersion(first.value, contractInput(fixture, setup.value.growUnitRef, {
        version: { schemaVersion: "2.0.0", producerVersion: "contract-test" },
        runtimeKernelType: "hybrid_runtime",
        shape: {
          ...completeShape(true),
          compatibility: {
            ...completeShape(true).compatibility!,
            version: { schemaVersion: "2.0.0", producerVersion: "contract-test" },
            breakingChanges: ["input mode added"]
          }
        }
      }));
      expect(second.ok).toBe(true);
      if (!second.ok) throw new Error(second.error.message);
      const old = await fixture.contracts.getRuntimeContract(first.value);
      expect(old.ok).toBe(true);
      if (old.ok) expect(old.value.lifecycle).toBe("superseded");

      const diff = await fixture.contracts.compareRuntimeContractVersions(first.value, second.value);
      expect(diff.ok).toBe(true);
      if (diff.ok) {
        expect(diff.value.compatible).toBe(false);
        expect(diff.value.changedFields).toContain("runtimeKernelType");
      }
      const compatibility = await fixture.contracts.explainCompatibility(first.value, "2.0.0");
      expect(compatibility.ok).toBe(true);
      if (compatibility.ok) expect(compatibility.value.summary).toContain("breaking");
      const missing = await fixture.contracts.explainCompatibility(first.value, "9.9.9");
      expect(missing.ok).toBe(true);
      if (missing.ok) expect(missing.value.facts.join("\n")).toContain("compatible=false");
    });
  });

  test("deprecates, retracts, and refuses locked in-place version edits", async () => {
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
      await fixture.contracts.verifyRuntimeContractForHatch(contract.value, verdict.value.readinessVerdictRef);
      const locked = await fixture.contracts.lockRuntimeContractForHatch(contract.value, {
        reason: "lock",
        policyContext: allowHatchPublish()
      });
      expect(locked.ok).toBe(true);
      const editLocked = await fixture.contracts.addRuntimeContractVersion(contract.value, contractInput(fixture, setup.value.growUnitRef));
      expect(editLocked.ok).toBe(false);
      if (!editLocked.ok) expect(editLocked.error.code).toBe("invalid_state");

      const deprecated = await fixture.contracts.deprecateRuntimeContract(contract.value, "old runtime");
      expect(deprecated.ok).toBe(true);
      const retracted = await fixture.contracts.retractRuntimeContract(contract.value, "bad release");
      expect(retracted.ok).toBe(true);
      const verifyRetracted = await fixture.contracts.verifyRuntimeContractForHatch(contract.value, verdict.value.readinessVerdictRef);
      expect(verifyRetracted.ok).toBe(false);
      if (!verifyRetracted.ok) expect(verifyRetracted.error.code).toBe("contract_retracted");
    });
  });
});

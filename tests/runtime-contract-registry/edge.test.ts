import { describe, expect, test } from "vitest";
import {
  makeReadinessVerdictId,
  makeReadinessVerdictRef
} from "../../src/evidence-readiness/index.js";
import { makeRuntimeContractRef, runtimeContractIndexPath } from "../../src/runtime-contract-registry/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import {
  audit,
  completeShape,
  contractInput,
  createGrowAgendaDod,
  makeContractFixture,
  policy,
  readyVerdict,
  source,
  version
} from "./helpers.js";

describe("Runtime Contract Registry edge behavior", () => {
  test("rejects archived grow units and unreadable runtime contract artifacts", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContractFixture(workspace);
      const archivedSetup = await createGrowAgendaDod(fixture);
      expect(archivedSetup.ok).toBe(true);
      if (!archivedSetup.ok) throw new Error(archivedSetup.error.message);

      const archived = await fixture.grow.archiveGrowUnit(archivedSetup.value.growUnitRef, {
        reason: "archive before contract",
        source: source(fixture, "system"),
        audit: audit("archive grow"),
        policyContext: policy([{ capability: "file.delete", resource: "*", verdict: "allow" }])
      });
      expect(archived.ok).toBe(true);

      const rejected = await fixture.contracts.registerRuntimeContract(
        contractInput(fixture, archivedSetup.value.growUnitRef)
      );
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) expect(rejected.error.code).toBe("grow_unit_archived");

      const setup = await createGrowAgendaDod(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const contract = await fixture.contracts.registerRuntimeContract(
        contractInput(fixture, setup.value.growUnitRef)
      );
      expect(contract.ok).toBe(true);
      if (!contract.ok) throw new Error(contract.error.message);
      const record = await fixture.contracts.getRuntimeContract(contract.value);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);

      const redacted = await fixture.artifacts.redactArtifact(record.value.artifactRef, "hide contract");
      expect(redacted.ok).toBe(true);
      const materialized = await fixture.contracts.materializeRuntimeContract(contract.value);
      expect(materialized.ok).toBe(false);
      if (!materialized.ok) expect(materialized.error.code).toBe("artifact_unavailable");
      const validation = await fixture.contracts.validateRuntimeContract(contract.value);
      expect(validation.ok).toBe(false);
      if (!validation.ok) expect(validation.error.code).toBe("artifact_unavailable");
    });
  });

  test("reports evidence lifecycle blockers and missing readiness verdicts", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContractFixture(workspace);
      const setup = await createGrowAgendaDod(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const verdict = await readyVerdict(fixture, setup.value.growUnitRef, setup.value.dodRef);
      expect(verdict.ok).toBe(true);
      if (!verdict.ok) throw new Error(verdict.error.message);

      const redacted = await fixture.artifacts.redactArtifact(verdict.value.evidenceArtifactRefs[0]!, "redact evidence");
      expect(redacted.ok).toBe(true);
      const contract = await fixture.contracts.registerRuntimeContract(
        contractInput(fixture, setup.value.growUnitRef, {
          evidenceRefs: verdict.value.evidenceArtifactRefs,
          readinessVerdictRef: verdict.value.readinessVerdictRef
        })
      );
      expect(contract.ok).toBe(true);
      if (!contract.ok) throw new Error(contract.error.message);
      const validation = await fixture.contracts.validateRuntimeContract(contract.value);
      expect(validation.ok).toBe(true);
      if (validation.ok) {
        expect(validation.value.complete).toBe(false);
        expect(validation.value.blockers.join("\n")).toContain("is redacted");
      }

      const missing = await fixture.contracts.verifyRuntimeContractForHatch(
        contract.value,
        makeReadinessVerdictRef(makeReadinessVerdictId("readiness-missing"))
      );
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.error.code).toBe("readiness_missing");
    });
  });

  test("requires explicit hatch publish policy and respects denial", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContractFixture(workspace);
      const setup = await createGrowAgendaDod(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const verdict = await readyVerdict(fixture, setup.value.growUnitRef, setup.value.dodRef);
      expect(verdict.ok).toBe(true);
      if (!verdict.ok) throw new Error(verdict.error.message);
      const contract = await fixture.contracts.registerRuntimeContract(
        contractInput(fixture, setup.value.growUnitRef, {
          evidenceRefs: verdict.value.evidenceArtifactRefs,
          readinessVerdictRef: verdict.value.readinessVerdictRef
        })
      );
      expect(contract.ok).toBe(true);
      if (!contract.ok) throw new Error(contract.error.message);
      const verified = await fixture.contracts.verifyRuntimeContractForHatch(
        contract.value,
        verdict.value.readinessVerdictRef
      );
      expect(verified.ok).toBe(true);

      const approval = await fixture.contracts.lockRuntimeContractForHatch(contract.value, {
        reason: "lock without explicit allow"
      });
      expect(approval.ok).toBe(false);
      if (!approval.ok) expect(approval.error.code).toBe("approval_required");
      const denied = await fixture.contracts.lockRuntimeContractForHatch(contract.value, {
        reason: "deny lock",
        policyContext: policy([{ capability: "hatch.publish", resource: "*", verdict: "deny" }])
      });
      expect(denied.ok).toBe(false);
      if (!denied.ok) expect(denied.error.code).toBe("policy_blocked");
    });
  });

  test("summarizes event-only contracts and surfaces invalid index data", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContractFixture(workspace);
      const setup = await createGrowAgendaDod(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);

      const missingRef = makeRuntimeContractRef("runtime-contract-missing");
      const missingRecordSummary = await fixture.contracts.buildRuntimeContractSummary(missingRef);
      expect(missingRecordSummary.ok).toBe(false);
      if (!missingRecordSummary.ok) expect(missingRecordSummary.error.code).toBe("not_found");
      const missingRecordExplanation = await fixture.contracts.explainRuntimeContract(missingRef);
      expect(missingRecordExplanation.ok).toBe(false);
      if (!missingRecordExplanation.ok) expect(missingRecordExplanation.error.code).toBe("not_found");

      const base = completeShape(false);
      const { output, ...withoutOutput } = base;
      const contract = await fixture.contracts.registerRuntimeContract(
        contractInput(fixture, setup.value.growUnitRef, {
          name: "event only",
          shape: { ...withoutOutput, event: output! },
          capabilityRequirements: ["runtime.target_action"],
          version: { schemaVersion: "1.0.1", producerVersion: "contract-test" }
        })
      );
      expect(contract.ok).toBe(true);
      if (!contract.ok) throw new Error(contract.error.message);
      const summary = await fixture.contracts.buildRuntimeContractSummary(contract.value);
      expect(summary.ok).toBe(true);
      if (summary.ok) expect(summary.value.outputSummary).toContain("action_event");
      const explanation = await fixture.contracts.explainCompatibility(contract.value, "1.0.1");
      expect(explanation.ok).toBe(true);
      if (explanation.ok) expect(explanation.value.facts.join("\n")).toContain("changed=none");

      const incomplete = await fixture.contracts.recordContractCandidate({
        growUnitRef: setup.value.growUnitRef,
        name: "incomplete summary",
        version,
        runtimeKernelType: "custom_agent_kernel",
        source: source(fixture, "system"),
        audit: audit("incomplete summary")
      });
      expect(incomplete.ok).toBe(true);
      if (!incomplete.ok) throw new Error(incomplete.error.message);
      const missingSummary = await fixture.contracts.buildRuntimeContractSummary(incomplete.value);
      expect(missingSummary.ok).toBe(true);
      if (missingSummary.ok) {
        expect(missingSummary.value.inputSummary).toContain("missing input");
        expect(missingSummary.value.outputSummary).toContain("missing output");
        expect(missingSummary.value.actionBoundarySummary).toContain("missing action");
      }
      const missingExplanation = await fixture.contracts.explainRuntimeContract(incomplete.value);
      expect(missingExplanation.ok).toBe(true);
      if (missingExplanation.ok) {
        expect(missingExplanation.value.summary).toContain("custom runtime");
        expect(missingExplanation.value.facts.join("\n")).toContain("capabilities=missing");
      }

      const write = await workspace.store.writeTextAtomic(workspace.workspace, runtimeContractIndexPath, "{", {
        reason: "corrupt runtime contract index",
        createParents: true
      });
      expect(write.ok).toBe(true);
      const compatibility = await fixture.contracts.explainCompatibility(contract.value, "1.0.1");
      expect(compatibility.ok).toBe(false);
      if (!compatibility.ok) expect(compatibility.error.code).toBe("schema_incompatible");
      const listed = await fixture.contracts.listRuntimeContracts();
      expect(listed.ok).toBe(false);
      if (!listed.ok) expect(listed.error.code).toBe("schema_incompatible");
    });
  });
});

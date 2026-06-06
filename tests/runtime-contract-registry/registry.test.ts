import { describe, expect, test } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import {
  audit,
  completeShape,
  contractInput,
  createGrowAgendaDod,
  makeContractFixture,
  source,
  version
} from "./helpers.js";

describe("Runtime Contract Registry", () => {
  test("records candidates separately from registered contracts and materializes contract artifacts", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContractFixture(workspace);
      const setup = await createGrowAgendaDod(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);

      const candidate = await fixture.contracts.recordContractCandidate({
        growUnitRef: setup.value.growUnitRef,
        name: "candidate contract",
        version,
        runtimeKernelType: "standard_agent_kernel",
        source: source(fixture, "system"),
        audit: audit("candidate")
      });
      expect(candidate.ok).toBe(true);
      if (!candidate.ok) throw new Error(candidate.error.message);
      const candidateRecord = await fixture.contracts.getRuntimeContract(candidate.value);
      expect(candidateRecord.ok).toBe(true);
      if (candidateRecord.ok) expect(candidateRecord.value.lifecycle).toBe("candidate");

      const registered = await fixture.contracts.registerRuntimeContract(contractInput(fixture, setup.value.growUnitRef));
      expect(registered.ok).toBe(true);
      if (!registered.ok) throw new Error(registered.error.message);
      const record = await fixture.contracts.getRuntimeContract(registered.value);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);
      expect(record.value.lifecycle).toBe("registered");
      expect(record.value.runtimeKernelType).toBe("non_llm_runtime");
      expect(record.value.shape.input?.dialogueInputSupport).toBe(false);

      const materialized = await fixture.contracts.materializeRuntimeContract(registered.value);
      expect(materialized.ok).toBe(true);
      if (materialized.ok) {
        expect(materialized.value.content).toContain("boss-runtime-contract");
        expect(materialized.value.content).not.toContain("apiKey");
      }

      const page = await fixture.contracts.listRuntimeContracts({ growUnitRef: setup.value.growUnitRef, limit: 1 });
      expect(page.ok).toBe(true);
      if (page.ok) {
        expect(page.value.records).toHaveLength(1);
        expect(page.value.truncated).toBe(true);
      }

      const summary = await fixture.contracts.buildRuntimeContractSummary(registered.value);
      expect(summary.ok).toBe(true);
      if (summary.ok) {
        expect(summary.value.runtimeKernelType).toBe("non_llm_runtime");
        expect(summary.value.inputSummary).toContain("tick_state");
      }
      const explanation = await fixture.contracts.explainRuntimeContract(registered.value);
      expect(explanation.ok).toBe(true);
      if (explanation.ok) expect(explanation.value.facts.join("\n")).toContain("dialogueInput=false");
    });
  });

  test("validates inputs and enforces runtime_contract artifact producer ownership", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContractFixture(workspace);
      const setup = await createGrowAgendaDod(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);

      const invalid = await fixture.contracts.registerRuntimeContract(contractInput(fixture, setup.value.growUnitRef, { name: "" }));
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) expect(invalid.error.code).toBe("invalid_input");

      const secret = await fixture.contracts.registerRuntimeContract(contractInput(fixture, setup.value.growUnitRef, {
        shape: completeShape(false),
        capabilityRequirements: ["runtime.target_action"],
        name: "apiKey leak"
      }));
      expect(secret.ok).toBe(false);
      if (!secret.ok) expect(secret.error.code).toBe("privacy_blocked");

      const wrongProducer = await fixture.artifacts.registerArtifact({
        kind: "runtime_contract",
        content: "{}",
        mediaType: "application/json",
        encoding: "utf8",
        source: source(fixture, "system"),
        version,
        audit: audit("wrong producer"),
        privacyClass: "workspace_private",
        retentionClass: "hatch_scoped",
        producerModule: "human"
      });
      expect(wrongProducer.ok).toBe(false);
      if (!wrongProducer.ok) expect(wrongProducer.error.code).toBe("invalid_state");
    });
  });
});

import { describe, expect, it } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import { audit, evidence, makeBridgeFixture, makeGrow, observe, runtimeArtifacts, setupCorrelation, source } from "./helpers.js";
import { contractInput } from "../runtime-contract-registry/helpers.js";

describe("Debug Feedback Bridge correlation and ingest", () => {
  it("opens a correlation, links runtime artifacts, and ingests reports into envelopes", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const artifacts = await runtimeArtifacts(fixture, setup.value);
      expect(artifacts.ok).toBe(true);
      if (!artifacts.ok) throw new Error(artifacts.error.message);

      const linkedInvocation = await fixture.bridge.linkRuntimeInvocation(setup.value.correlationRef, artifacts.value.invocationRef);
      expect(linkedInvocation.ok).toBe(true);
      const linkedTrace = await fixture.bridge.linkRuntimeTrace(setup.value.correlationRef, artifacts.value.traceRef);
      expect(linkedTrace.ok).toBe(true);
      const linkedSignal = await fixture.bridge.linkDebugSignal(setup.value.correlationRef, artifacts.value.signalRef);
      expect(linkedSignal.ok).toBe(true);

      const trace = await fixture.bridge.ingestRuntimeTrace(setup.value.correlationRef, artifacts.value.traceRef);
      expect(trace.ok).toBe(true);
      const signal = await fixture.bridge.ingestTargetDebugSignal(setup.value.correlationRef, artifacts.value.signalRef);
      expect(signal.ok).toBe(true);
      const hint = await fixture.bridge.ingestRuntimeFeedbackHint(setup.value.correlationRef, artifacts.value.hintRef);
      expect(hint.ok).toBe(true);
      if (!signal.ok) throw new Error("signal ingest failed");

      const envelope = await fixture.bridge.getRuntimeReportEnvelope(signal.value);
      expect(envelope.ok).toBe(true);
      if (!envelope.ok) throw new Error(envelope.error.message);
      expect(envelope.value.sourceKind).toBe("target_debug_signal");
      expect(envelope.value.sourceLayer).toBe("target_world_adapter");

      const record = await fixture.bridge.getDebugCorrelation(setup.value.correlationRef);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);
      expect(record.value.status).toBe("normalized");
      expect(record.value.envelopeRefs.length).toBeGreaterThanOrEqual(3);
    });
  });

  it("rejects feedback hint ingest before a runtime invocation is linked", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const artifacts = await runtimeArtifacts(fixture, setup.value);
      if (!artifacts.ok) throw new Error(artifacts.error.message);
      const hint = await fixture.bridge.ingestRuntimeFeedbackHint(setup.value.correlationRef, artifacts.value.hintRef);
      expect(hint.ok).toBe(false);
      if (hint.ok) throw new Error("expected failure");
      expect(hint.error.code).toBe("invalid_state");
    });
  });

  it("blocks ingest and packet building once a correlation is closed", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const closed = await fixture.bridge.closeDebugCorrelation(setup.value.correlationRef, "debugging finished");
      expect(closed.ok).toBe(true);
      if (!closed.ok) throw new Error(closed.error.message);
      expect(closed.value.status).toBe("closed");
      const observation = await observe(fixture, setup.value.correlationRef, { evidenceRefs: [await evidence(fixture, "late evidence")] });
      expect(observation.ok).toBe(false);
      if (observation.ok) throw new Error("expected closed correlation to reject ingest");
      expect(observation.error.code).toBe("invalid_state");
    });
  });

  it("rejects manual observations without a summary and records explicit attribution layers", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const empty = await fixture.bridge.ingestManualObservation(setup.value.correlationRef, {
        summary: "   ",
        privacyClass: "workspace_private",
        evidenceRefs: [],
        source: source(fixture, "user"),
        audit: audit("empty observation")
      });
      expect(empty.ok).toBe(false);
      if (empty.ok) throw new Error("expected empty summary rejection");
      expect(empty.error.code).toBe("invalid_input");

      const explicit = await fixture.bridge.ingestManualObservation(setup.value.correlationRef, {
        summary: "explicit-layer observation",
        privacyClass: "workspace_private",
        evidenceRefs: [await evidence(fixture, "explicit evidence")],
        sourceLayer: "runtime_kernel",
        targetLayerHint: "upstream_feng_project",
        attributionHint: "kernel attribution",
        source: source(fixture, "user"),
        audit: audit("explicit observation")
      });
      expect(explicit.ok).toBe(true);
      if (!explicit.ok) throw new Error(explicit.error.message);
      const envelope = await fixture.bridge.getRuntimeReportEnvelope(explicit.value);
      if (!envelope.ok) throw new Error(envelope.error.message);
      expect(envelope.value.sourceLayer).toBe("runtime_kernel");
      expect(envelope.value.targetLayerHint).toBe("upstream_feng_project");
    });
  });

  it("rejects opening a correlation when the package and runtime contract do not match", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeBridgeFixture(workspace);
      const setup = await setupCorrelation(fixture);
      if (!setup.ok) throw new Error(setup.error.message);
      const grow = await makeGrow(fixture, "mismatch-contract-grow");
      if (!grow.ok) throw new Error(grow.error.message);
      const other = await fixture.contracts.registerRuntimeContract(
        contractInput(fixture as never, grow.value, { name: "mismatched-contract" })
      );
      if (!other.ok) throw new Error(other.error.message);
      const opened = await fixture.bridge.openDebugCorrelation({
        originGrowUnitRef: grow.value,
        hatchPackageRef: setup.value.hatchPackageRef,
        runtimeContractRef: other.value,
        mode: "developer_debug",
        privacyBoundary: "workspace_private",
        source: source(fixture, "system"),
        audit: audit("mismatch open")
      });
      expect(opened.ok).toBe(false);
      if (opened.ok) throw new Error("expected contract mismatch rejection");
      expect(opened.error.code).toBe("contract_incompatible");
    });
  });
});

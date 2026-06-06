import { describe, expect, test } from "vitest";
import { dodRecordPath } from "../../src/agenda-dod-manager/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import { artifactInput, audit, createGrowAndAgenda, makeAgendaFixture, source, version } from "./helpers.js";

describe("Agenda DoD Manager - gaps and DoD", () => {
  test("deduplicates open gaps and blocks attempt intent after retry budget is exhausted", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgendaFixture(workspace);
      const grow = await createGrowAndAgenda(fixture);
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);

      const gap = await fixture.agenda.recordGap(grow.value, {
        kind: "missing_validation_environment",
        summary: "No simulator trace exists for boss lane changes",
        requiredInput: "Run one boss lane-change simulator trace",
        requiredEvidence: "A validation report artifact",
        blockingReason: "Cannot prove behavior without external trace",
        retryLimit: 2,
        source: source(fixture, "system"),
        audit: audit("record gap")
      });
      expect(gap.ok).toBe(true);
      if (!gap.ok) throw new Error(gap.error.message);

      const duplicate = await fixture.agenda.recordGap(grow.value, {
        kind: "missing_validation_environment",
        summary: "No simulator trace exists for boss lane changes",
        requiredInput: "same input",
        requiredEvidence: "same evidence",
        blockingReason: "same blocker",
        source: source(fixture, "system"),
        audit: audit("duplicate gap")
      });
      expect(duplicate.ok).toBe(false);
      if (!duplicate.ok) expect(duplicate.error.code).toBe("gap_conflict");

      const firstRetry = await fixture.agenda.updateGap(gap.value, {
        incrementAttempt: true,
        reason: "first retry did not produce trace",
        source: source(fixture, "system"),
        audit: audit("retry one")
      });
      expect(firstRetry.ok).toBe(true);
      const secondRetry = await fixture.agenda.updateGap(gap.value, {
        incrementAttempt: true,
        reason: "second retry hit the limit",
        source: source(fixture, "system"),
        audit: audit("retry two")
      });
      expect(secondRetry.ok).toBe(true);

      const listed = await fixture.agenda.listOpenGaps(grow.value, { status: "blocked" });
      expect(listed.ok).toBe(true);
      if (listed.ok) {
        expect(listed.value.total).toBe(1);
        expect(listed.value.records[0]?.attemptCount).toBe(2);
      }

      const intent = await fixture.agenda.buildAttemptIntent(grow.value, {
        source: source(fixture, "system"),
        audit: audit("blocked intent")
      });
      expect(intent.ok).toBe(false);
      if (!intent.ok) expect(intent.error.code).toBe("retry_limit_reached");
    });
  });

  test("preserves DoD revision history and keeps evaluation separate from readiness", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgendaFixture(workspace);
      const grow = await createGrowAndAgenda(fixture);
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);
      const targetWorld = await fixture.artifacts.registerArtifact(artifactInput(fixture, "boss world summary"));
      const evaluation = await fixture.artifacts.registerArtifact(artifactInput(fixture, "validation passed but not hatch verdict", {
        kind: "validation_report"
      }));
      expect(targetWorld.ok).toBe(true);
      expect(evaluation.ok).toBe(true);
      if (!targetWorld.ok || !evaluation.ok) throw new Error("artifact setup failed");

      const gap = await fixture.agenda.recordGap(grow.value, {
        kind: "runtime_contract_incomplete",
        summary: "Need output action schema",
        requiredInput: "Action schema draft",
        requiredEvidence: "Schema reviewed by a validation attempt",
        blockingReason: "Boss command shape is not bounded",
        source: source(fixture, "system"),
        audit: audit("record dod gap")
      });
      expect(gap.ok).toBe(true);
      if (!gap.ok) throw new Error(gap.error.message);

      const dod = await fixture.agenda.defineDoD(grow.value, {
        statement: "Boss agent emits only allowed action names",
        scope: "runtime command contract",
        evidenceRequirement: "Validation report lists every emitted action",
        validationIntent: "Inspect simulator trace against the action schema",
        targetWorldSummaryRef: targetWorld.value,
        relatedGapRefs: [gap.value],
        source: source(fixture, "system"),
        version,
        audit: audit("define dod")
      });
      expect(dod.ok).toBe(true);
      if (!dod.ok) throw new Error(dod.error.message);

      const linked = await fixture.agenda.linkDoDEvaluation(dod.value, evaluation.value, {
        reason: "attach validation report",
        source: source(fixture, "system"),
        audit: audit("link evaluation")
      });
      expect(linked.ok).toBe(true);
      const explanation = await fixture.agenda.explainAgendaState(grow.value);
      expect(explanation.ok).toBe(true);
      if (explanation.ok) {
        expect(explanation.value.facts).toContain("readinessVerdict=not_decided_by_agenda");
        expect(JSON.stringify(explanation.value)).not.toMatch(/ready_to_hatch|satisfied/i);
      }

      const revised = await fixture.agenda.reviseDoD(dod.value, {
        statement: "Boss agent emits allowed action names with valid target ids",
        reason: "tighten action contract",
        source: source(fixture, "system"),
        audit: audit("revise dod")
      });
      expect(revised.ok).toBe(true);
      if (!revised.ok) throw new Error(revised.error.message);
      const oldRead = await fixture.store.readText(fixture.workspace, dodRecordPath(dod.value.id), {
        reason: "read superseded dod",
        maxBytes: 512 * 1024
      });
      expect(oldRead.ok).toBe(true);
      if (oldRead.ok) expect(JSON.parse(oldRead.value.content).lifecycle).toBe("superseded");

      const active = await fixture.agenda.listActiveDoD(grow.value);
      expect(active.ok).toBe(true);
      if (active.ok) {
        expect(active.value).toHaveLength(1);
        expect(active.value[0]?.dodRef.id).toBe(revised.value.ref.id);
      }
      expect(revised.value.ref.kind).toBe("dod");
      if (revised.value.ref.kind !== "dod") throw new Error("revision did not return a DoD ref");

      const retired = await fixture.agenda.retireDoD(revised.value.ref, {
        reason: "retire after replacement",
        source: source(fixture, "system"),
        audit: audit("retire dod")
      });
      expect(retired.ok).toBe(true);
      const rewrite = await fixture.agenda.reviseDoD(revised.value.ref, {
        statement: "cannot mutate retired dod",
        reason: "rewrite retired",
        source: source(fixture, "system"),
        audit: audit("rewrite retired dod")
      });
      expect(rewrite.ok).toBe(false);
      if (!rewrite.ok) expect(rewrite.error.code).toBe("dod_incompatible");
    });
  });

  test("validates DoD required evidence and applies optional revision fields", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgendaFixture(workspace);
      const grow = await createGrowAndAgenda(fixture);
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);
      const invalid = await fixture.agenda.defineDoD(grow.value, {
        statement: "   ",
        scope: "runtime",
        evidenceRequirement: " ",
        validationIntent: "inspect",
        source: source(fixture, "system"),
        version,
        audit: audit("invalid dod")
      });
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) expect(invalid.error.code).toBe("invalid_input");

      const item = await fixture.agenda.proposeAgendaItem(grow.value, {
        kind: "define_runtime_contract",
        summary: "Draft runtime output schema",
        reason: "needed for DoD relation",
        expectedOutput: "schema draft",
        source: source(fixture, "system"),
        audit: audit("propose dod item")
      });
      expect(item.ok).toBe(true);
      if (!item.ok) throw new Error(item.error.message);
      const dod = await fixture.agenda.defineDoD(grow.value, {
        statement: "Runtime emits a structured command",
        scope: "runtime output",
        evidenceRequirement: "Schema draft exists",
        validationIntent: "Manual schema inspection",
        source: source(fixture, "system"),
        version,
        audit: audit("define no target")
      });
      expect(dod.ok).toBe(true);
      if (!dod.ok) throw new Error(dod.error.message);
      const targetWorld = await fixture.artifacts.registerArtifact(artifactInput(fixture, "new target world"));
      expect(targetWorld.ok).toBe(true);
      if (!targetWorld.ok) throw new Error(targetWorld.error.message);

      const revised = await fixture.agenda.reviseDoD(dod.value, {
        scope: "runtime output schema",
        evidenceRequirement: "Schema and target world summary exist",
        validationIntent: "Inspect schema against target world",
        targetWorldSummaryRef: targetWorld.value,
        relatedAgendaItemRefs: [item.value],
        lifecycle: "blocked",
        version: { schemaVersion: "2", producerVersion: "agenda-test" },
        reason: "add target world dependency",
        source: source(fixture, "system"),
        audit: audit("revise optional fields")
      });
      expect(revised.ok).toBe(true);
      if (!revised.ok) throw new Error(revised.error.message);
      expect(revised.value.ref.kind).toBe("dod");
      if (revised.value.ref.kind !== "dod") throw new Error("revision did not return DoD ref");
      const read = await fixture.store.readText(fixture.workspace, dodRecordPath(revised.value.ref.id), {
        reason: "read revised dod",
        maxBytes: 512 * 1024
      });
      expect(read.ok).toBe(true);
      if (read.ok) {
        const record = JSON.parse(read.value.content);
        expect(record.lifecycle).toBe("blocked");
        expect(record.version.schemaVersion).toBe("2");
        expect(record.targetWorldSummaryRef.id).toBe(targetWorld.value.id);
        expect(record.relatedAgendaItemRefs[0].id).toBe(item.value.id);
      }
    });
  });
});

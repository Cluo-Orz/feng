import { describe, expect, test } from "vitest";
import {
  agendaEventTypes,
  agendaGrowStream,
  agendaItemRecordPath,
  agendaRecordPath
} from "../../src/agenda-dod-manager/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import { artifactInput, audit, createGrowAndAgenda, makeAgendaFixture, source, version } from "./helpers.js";

describe("Agenda DoD Manager - agenda core", () => {
  test("creates one agenda per grow unit and rebuilds its projection from the grow stream", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgendaFixture(workspace);
      const grow = await createGrowAndAgenda(fixture);
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);

      const duplicate = await fixture.agenda.createAgenda(grow.value, {
        goalBoundarySummary: "duplicate",
        source: source(fixture, "system"),
        version,
        audit: audit("duplicate agenda")
      });
      expect(duplicate.ok).toBe(false);
      if (!duplicate.ok) expect(duplicate.error.code).toBe("agenda_conflict");

      const replay = await fixture.ledger.replayStream(agendaGrowStream(grow.value), { reason: "agenda replay" });
      expect(replay.ok).toBe(true);
      if (replay.ok) {
        expect(replay.value.events.some((event) => event.eventType === agendaEventTypes.agendaCreated)).toBe(true);
      }

      const agenda = await fixture.agenda.getAgenda(grow.value);
      expect(agenda.ok).toBe(true);
      if (!agenda.ok) throw new Error(agenda.error.message);
      const removed = await fixture.store.removeFile(fixture.workspace, agendaRecordPath(agenda.value.agendaId), {
        reason: "remove agenda projection"
      });
      expect(removed.ok).toBe(true);
      const rebuilt = await fixture.agenda.getAgenda(grow.value);
      expect(rebuilt.ok).toBe(true);
      if (rebuilt.ok) {
        expect(rebuilt.value.agendaId).toBe(agenda.value.agendaId);
        expect(JSON.stringify(rebuilt.value)).not.toMatch(/session|message_list/i);
      }
    });
  });

  test("keeps proposed agenda items separate from active work and blocks terminal rewrites", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgendaFixture(workspace);
      const grow = await createGrowAndAgenda(fixture);
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);

      const item = await fixture.agenda.proposeAgendaItem(grow.value, {
        kind: "define_runtime_contract",
        summary: "Define boss command input/output contract",
        reason: "contract must be explicit before grow attempt",
        expectedOutput: "A bounded runtime contract summary",
        source: source(fixture, "system"),
        audit: audit("propose item")
      });
      expect(item.ok).toBe(true);
      if (!item.ok) throw new Error(item.error.message);

      const proposedSummary = await fixture.agenda.buildAgendaSummary(grow.value);
      expect(proposedSummary.ok).toBe(true);
      if (proposedSummary.ok) expect(proposedSummary.value.activeAgendaItemCount).toBe(0);

      const active = await fixture.agenda.activateAgendaItem(item.value, {
        reason: "start with runtime contract",
        source: source(fixture, "system"),
        audit: audit("activate item")
      });
      expect(active.ok).toBe(true);
      const activeSummary = await fixture.agenda.buildAgendaSummary(grow.value);
      expect(activeSummary.ok).toBe(true);
      if (activeSummary.ok) {
        expect(activeSummary.value.activeAgendaItemCount).toBe(1);
        expect(activeSummary.value.currentFocus).toContain("boss command");
      }

      const waiting = await fixture.agenda.updateAgendaItem(item.value, {
        status: "waiting_validation",
        reason: "needs simulator trace",
        expectedOutput: "Runtime contract plus validation trace",
        source: source(fixture, "system"),
        audit: audit("wait validation")
      });
      expect(waiting.ok).toBe(true);

      const retired = await fixture.agenda.retireAgendaItem(item.value, {
        reason: "superseded by newer task",
        source: source(fixture, "system"),
        audit: audit("retire item")
      });
      expect(retired.ok).toBe(true);
      const rewrite = await fixture.agenda.updateAgendaItem(item.value, {
        status: "active",
        reason: "terminal item should not mutate",
        source: source(fixture, "system"),
        audit: audit("rewrite retired")
      });
      expect(rewrite.ok).toBe(false);
      if (!rewrite.ok) expect(rewrite.error.code).toBe("agenda_conflict");
    });
  });

  test("updates item links, priority, and evidence refs as file-native record state", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgendaFixture(workspace);
      const grow = await createGrowAndAgenda(fixture);
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);
      const evidence = await fixture.artifacts.registerArtifact(artifactInput(fixture, "item evidence"));
      expect(evidence.ok).toBe(true);
      if (!evidence.ok) throw new Error(evidence.error.message);

      const gap = await fixture.agenda.recordGap(grow.value, {
        kind: "target_world_contract_incomplete",
        summary: "Need target world state fields",
        requiredInput: "state fields",
        requiredEvidence: "contract artifact",
        blockingReason: "runtime cannot observe world",
        source: source(fixture, "system"),
        audit: audit("record related gap")
      });
      expect(gap.ok).toBe(true);
      if (!gap.ok) throw new Error(gap.error.message);
      const dod = await fixture.agenda.defineDoD(grow.value, {
        statement: "Runtime contract names all observed world fields",
        scope: "target world input",
        evidenceRequirement: "A contract artifact lists fields and types",
        validationIntent: "Inspect contract before attempt",
        source: source(fixture, "system"),
        version,
        audit: audit("define related dod")
      });
      expect(dod.ok).toBe(true);
      if (!dod.ok) throw new Error(dod.error.message);

      const item = await fixture.agenda.proposeAgendaItem(grow.value, {
        kind: "define_target_world",
        summary: "Draft target world fields",
        reason: "need observable state",
        expectedOutput: "world field draft",
        priority: "low",
        retryPolicy: { retryLimit: 5, onLimit: "wait_validation" },
        source: source(fixture, "system"),
        audit: audit("propose linked item")
      });
      expect(item.ok).toBe(true);
      if (!item.ok) throw new Error(item.error.message);
      const updated = await fixture.agenda.updateAgendaItem(item.value, {
        status: "waiting_input",
        summary: "Collect target world fields",
        relatedGapRefs: [gap.value],
        relatedDoDRefs: [dod.value],
        evidenceRequirementRefs: [evidence.value],
        priority: "critical",
        reason: "needs designer input",
        source: source(fixture, "system"),
        audit: audit("update linked item")
      });
      expect(updated.ok).toBe(true);
      const read = await fixture.store.readText(fixture.workspace, agendaItemRecordPath(item.value.id), {
        reason: "read agenda item",
        maxBytes: 512 * 1024
      });
      expect(read.ok).toBe(true);
      if (read.ok) {
        const record = JSON.parse(read.value.content);
        expect(record.status).toBe("waiting_input");
        expect(record.priority).toBe("critical");
        expect(record.relatedGapRefs[0].id).toBe(gap.value.id);
        expect(record.relatedDoDRefs[0].id).toBe(dod.value.id);
        expect(record.evidenceRequirementRefs[0].id).toBe(evidence.value.id);
      }
      const blocked = await fixture.agenda.updateAgendaItem(item.value, {
        status: "blocked",
        reason: "designer input is unavailable",
        source: source(fixture, "system"),
        audit: audit("block item")
      });
      expect(blocked.ok).toBe(true);
    });
  });
});

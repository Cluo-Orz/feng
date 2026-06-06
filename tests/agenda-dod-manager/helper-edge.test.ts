import { describe, expect, test } from "vitest";
import { makeArtifactId, makeRef } from "../../src/domain/index.js";
import type { EventEnvelope } from "../../src/event-ledger/index.js";
import { makeAgendaItemId, makeDoDId, makeGapId } from "../../src/agenda-dod-manager/brand.js";
import { projectAgendaEvents } from "../../src/agenda-dod-manager/projection.js";
import { makeAgendaItemRef, makeDoDRef, makeGapRef } from "../../src/agenda-dod-manager/refs.js";
import { compact, matchesGapQuery, newAgendaRef, paginate, withAgendaRef } from "../../src/agenda-dod-manager/logic.js";
import { parseJson } from "../../src/agenda-dod-manager/storage.js";
import { agendaEventTypes, agendaIndexPath, agendaRecordPath } from "../../src/agenda-dod-manager/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import { artifactInput, audit, createGrowAndAgenda, makeAgendaFixture, source, version } from "./helpers.js";

describe("Agenda DoD Manager - helper edges", () => {
  test("projects agenda events and reports invalid projection payloads", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgendaFixture(workspace);
      const grow = await createGrowAndAgenda(fixture);
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);
      const agenda = await fixture.agenda.getAgenda(grow.value);
      expect(agenda.ok).toBe(true);
      if (!agenda.ok) throw new Error(agenda.error.message);
      const missingAgendaRef = newAgendaRef();
      const missingIndex = await fixture.store.writeTextAtomic(
        fixture.workspace,
        agendaIndexPath,
        JSON.stringify({ agendaRefs: [missingAgendaRef, agenda.value.agendaRef] }),
        { reason: "write index with missing agenda", createParents: true }
      );
      expect(missingIndex.ok).toBe(true);
      const skippedMissing = await fixture.agenda.getAgenda(grow.value);
      expect(skippedMissing.ok).toBe(true);
      const duplicateRef = newAgendaRef();
      const duplicateRecord = { ...agenda.value, agendaId: duplicateRef.id, agendaRef: duplicateRef };
      await fixture.store.writeTextAtomic(
        fixture.workspace,
        agendaRecordPath(duplicateRef.id),
        JSON.stringify(duplicateRecord, null, 2),
        { reason: "write duplicate agenda", createParents: true }
      );
      await fixture.store.writeTextAtomic(
        fixture.workspace,
        agendaIndexPath,
        JSON.stringify({ agendaRefs: [agenda.value.agendaRef, duplicateRef] }),
        { reason: "write duplicate agenda index", createParents: true }
      );
      const conflict = await fixture.agenda.getAgenda(grow.value);
      expect(conflict.ok).toBe(false);
      if (!conflict.ok) expect(conflict.error.code).toBe("agenda_conflict");

      const invalidPayload = projectAgendaEvents([event(agendaEventTypes.agendaCreated, "bad")]);
      expect(invalidPayload.ok).toBe(false);
      if (!invalidPayload.ok) expect(invalidPayload.error.code).toBe("schema_incompatible");
      const missingRecord = projectAgendaEvents([event(agendaEventTypes.agendaCreated, {})]);
      expect(missingRecord.ok).toBe(false);
      const noAgenda = projectAgendaEvents([event("other_event", "ignored")]);
      expect(noAgenda.ok).toBe(false);
      if (!noAgenda.ok) expect(noAgenda.error.code).toBe("not_found");

      const projected = projectAgendaEvents([
        event("other_event", "ignored"),
        event(agendaEventTypes.agendaCreated, { record: agenda.value }),
        event(agendaEventTypes.agendaItemProposed, {
          agendaRecord: { ...agenda.value, currentFocus: "projected focus", recordVersion: 2 }
        })
      ]);
      expect(projected.ok).toBe(true);
      if (projected.ok) expect(projected.value.currentFocus).toBe("projected focus");

      const invalidJson = parseJson("{", "bad json");
      expect(invalidJson.ok).toBe(false);
      if (!invalidJson.ok) expect(invalidJson.error.code).toBe("schema_incompatible");
      expect(compact("x".repeat(20), 8)).toBe("xxxxx...");
      expect(withAgendaRef([agenda.value.agendaRef], agenda.value.agendaRef)).toHaveLength(1);
      const page = paginate([1, 2], { cursor: "1", limit: 10 });
      expect(page.truncated).toBe(false);
      expect(matchesGapQuery({ kind: "missing_material", summary: "alpha" } as never, { text: "beta" })).toBe(false);
    });
  });

  test("reports missing refs and over-limit gap updates through manager ports", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgendaFixture(workspace);
      const grow = await createGrowAndAgenda(fixture);
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);

      const missingArtifact = makeRef("artifact", makeArtifactId("missing-input-artifact"));
      const missingInput = await fixture.agenda.proposeAgendaItem(grow.value, {
        kind: "collect_material",
        summary: "Needs missing input artifact",
        reason: "cover input ref validation",
        inputRefs: [missingArtifact],
        expectedOutput: "material summary",
        source: source(fixture, "system"),
        audit: audit("missing input")
      });
      expect(missingInput.ok).toBe(false);
      const fakeDoD = makeDoDRef(makeDoDId("dod-missing"));
      const missingDoD = await fixture.agenda.proposeAgendaItem(grow.value, {
        kind: "validate_candidate",
        summary: "Needs missing DoD",
        reason: "cover dod ref validation",
        relatedDoDRefs: [fakeDoD],
        expectedOutput: "validation plan",
        source: source(fixture, "system"),
        audit: audit("missing dod")
      });
      expect(missingDoD.ok).toBe(false);

      const fakeGap = makeGapRef(makeGapId("gap-missing"));
      const missingGap = await fixture.agenda.defineDoD(grow.value, {
        statement: "DoD with missing gap",
        scope: "edge",
        evidenceRequirement: "evidence",
        validationIntent: "validate",
        relatedGapRefs: [fakeGap],
        source: source(fixture, "system"),
        version,
        audit: audit("missing gap")
      });
      expect(missingGap.ok).toBe(false);
      const updateMissingGap = await fixture.agenda.updateGap(fakeGap, {
        reason: "missing gap update",
        source: source(fixture, "system"),
        audit: audit("missing gap update")
      });
      expect(updateMissingGap.ok).toBe(false);

      const evalArtifact = await fixture.artifacts.registerArtifact(artifactInput(fixture, "evaluation"));
      expect(evalArtifact.ok).toBe(true);
      if (!evalArtifact.ok) throw new Error(evalArtifact.error.message);
      const reviseMissingDoD = await fixture.agenda.reviseDoD(fakeDoD, {
        statement: "missing dod revise",
        reason: "missing dod",
        source: source(fixture, "system"),
        audit: audit("revise missing dod")
      });
      expect(reviseMissingDoD.ok).toBe(false);
      const retireMissingDoD = await fixture.agenda.retireDoD(fakeDoD, {
        reason: "missing dod retire",
        source: source(fixture, "system"),
        audit: audit("retire missing dod")
      });
      expect(retireMissingDoD.ok).toBe(false);
      const linkMissingDoD = await fixture.agenda.linkDoDEvaluation(fakeDoD, evalArtifact.value, {
        reason: "missing dod link",
        source: source(fixture, "system"),
        audit: audit("link missing dod")
      });
      expect(linkMissingDoD.ok).toBe(false);

      const gap = await fixture.agenda.recordGap(grow.value, {
        kind: "missing_material",
        summary: "Retry limit edge",
        requiredInput: "input",
        requiredEvidence: "evidence",
        blockingReason: "edge",
        retryLimit: 1,
        source: source(fixture, "system"),
        audit: audit("edge gap")
      });
      expect(gap.ok).toBe(true);
      if (!gap.ok) throw new Error(gap.error.message);
      await fixture.agenda.updateGap(gap.value, {
        incrementAttempt: true,
        reason: "reach limit",
        source: source(fixture, "system"),
        audit: audit("reach limit")
      });
      const overLimit = await fixture.agenda.updateGap(gap.value, {
        incrementAttempt: true,
        reason: "over limit",
        source: source(fixture, "system"),
        audit: audit("over limit")
      });
      expect(overLimit.ok).toBe(false);
      if (!overLimit.ok) expect(overLimit.error.code).toBe("retry_limit_reached");

      const terminalGap = await fixture.agenda.recordGap(grow.value, {
        kind: "missing_goal_boundary",
        summary: "Terminal gap",
        requiredInput: "input",
        requiredEvidence: "evidence",
        blockingReason: "edge",
        source: source(fixture, "system"),
        audit: audit("terminal gap")
      });
      expect(terminalGap.ok).toBe(true);
      if (!terminalGap.ok) throw new Error(terminalGap.error.message);
      await fixture.agenda.updateGap(terminalGap.value, {
        status: "rejected",
        reason: "reject gap",
        source: source(fixture, "system"),
        audit: audit("reject gap")
      });
      const rejectedRewrite = await fixture.agenda.resolveGapForNow(terminalGap.value, {
        reason: "cannot resolve rejected",
        source: source(fixture, "system"),
        audit: audit("resolve rejected")
      });
      expect(rejectedRewrite.ok).toBe(false);
      if (!rejectedRewrite.ok) expect(rejectedRewrite.error.code).toBe("gap_conflict");

      const fakeItem = makeAgendaItemRef(makeAgendaItemId("agenda-item-missing"));
      const missingItem = await fixture.agenda.updateAgendaItem(fakeItem, {
        reason: "missing item",
        source: source(fixture, "system"),
        audit: audit("missing item")
      });
      expect(missingItem.ok).toBe(false);
    });
  });

  test("returns not_found when building an intent before agenda creation", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgendaFixture(workspace);
      const grow = await fixture.grow.createGrowUnit({
        title: "no-agenda",
        goalBoundarySummary: "Grow without agenda",
        targetBehaviorSummary: "No agenda yet",
        source: source(fixture, "system"),
        version,
        audit: audit("create no agenda")
      });
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);
      const intent = await fixture.agenda.buildAttemptIntent(grow.value, {
        source: source(fixture, "system"),
        audit: audit("intent without agenda")
      });
      expect(intent.ok).toBe(false);
      if (!intent.ok) expect(intent.error.code).toBe("not_found");
    });
  });
});

function event(eventType: string, payload: unknown): EventEnvelope {
  return { eventType, payload } as EventEnvelope;
}

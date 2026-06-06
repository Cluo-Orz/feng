import { describe, expect, test } from "vitest";
import { makeArtifactId, makeRef } from "../../src/domain/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import {
  allowArchivePolicy,
  audit,
  createGrowAndAgenda,
  makeAgendaFixture,
  source,
  version
} from "./helpers.js";

describe("Agenda DoD Manager - edge behavior", () => {
  test("reports missing agenda and validates required fields and artifact refs", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgendaFixture(workspace);
      const grow = await fixture.grow.createGrowUnit({
        title: "xiaoshuo-agent",
        goalBoundarySummary: "Grow a novel-writing agent.",
        targetBehaviorSummary: "Draft chapters from a bounded writing brief.",
        source: source(fixture, "system"),
        version,
        audit: audit("create grow only")
      });
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);

      const missing = await fixture.agenda.getAgenda(grow.value);
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.error.code).toBe("not_found");

      const empty = await fixture.agenda.createAgenda(grow.value, {
        goalBoundarySummary: "   ",
        source: source(fixture, "system"),
        version,
        audit: audit("empty agenda")
      });
      expect(empty.ok).toBe(false);
      if (!empty.ok) expect(empty.error.code).toBe("invalid_input");

      const created = await fixture.agenda.createAgenda(grow.value, {
        goalBoundarySummary: "Novel agent agenda",
        recommendedGrowState: "planning",
        source: source(fixture, "system"),
        version,
        audit: audit("create agenda")
      });
      expect(created.ok).toBe(true);
      const summary = await fixture.agenda.buildAgendaSummary(grow.value);
      expect(summary.ok).toBe(true);
      if (summary.ok) {
        expect(summary.value.currentFocus).toBe("Novel agent agenda");
        expect(summary.value.recommendedGrowState).toBe("planning");
      }
      const missingArtifact = makeRef("artifact", makeArtifactId("missing-artifact"));
      const invalidItem = await fixture.agenda.proposeAgendaItem(grow.value, {
        kind: "collect_material",
        summary: "Collect source material",
        reason: "needs source text",
        expectedOutput: "source material summary",
        evidenceRequirementRefs: [missingArtifact],
        source: source(fixture, "system"),
        audit: audit("invalid artifact")
      });
      expect(invalidItem.ok).toBe(false);
      if (!invalidItem.ok) expect(invalidItem.error.code).toBe("not_found");
      const emptyItem = await fixture.agenda.proposeAgendaItem(grow.value, {
        kind: "collect_material",
        summary: " ",
        reason: "empty summary",
        expectedOutput: "none",
        source: source(fixture, "system"),
        audit: audit("empty item")
      });
      expect(emptyItem.ok).toBe(false);

      const dod = await fixture.agenda.defineDoD(grow.value, {
        statement: "Novel agent follows the chapter brief",
        scope: "chapter output",
        evidenceRequirement: "A validation report compares output to brief",
        validationIntent: "Inspect chapter draft",
        source: source(fixture, "system"),
        version,
        audit: audit("define dod")
      });
      expect(dod.ok).toBe(true);
      if (!dod.ok) throw new Error(dod.error.message);
      const missingEvaluation = await fixture.agenda.linkDoDEvaluation(dod.value, missingArtifact, {
        reason: "missing eval",
        source: source(fixture, "system"),
        audit: audit("missing eval")
      });
      expect(missingEvaluation.ok).toBe(false);
      if (!missingEvaluation.ok) expect(missingEvaluation.error.code).toBe("not_found");
    });
  });

  test("supports paged gap views and keeps resolved gaps out of the default open list", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgendaFixture(workspace);
      const grow = await createGrowAndAgenda(fixture, "libai-novel");
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);
      const emptyGap = await fixture.agenda.recordGap(grow.value, {
        kind: "missing_material",
        summary: " ",
        requiredInput: "input",
        requiredEvidence: "evidence",
        blockingReason: "empty",
        source: source(fixture, "system"),
        audit: audit("empty gap")
      });
      expect(emptyGap.ok).toBe(false);

      const alpha = await fixture.agenda.recordGap(grow.value, {
        kind: "missing_material",
        summary: "alpha missing Tang dynasty setting notes",
        requiredInput: "setting notes",
        requiredEvidence: "source summary",
        blockingReason: "voice cannot be checked",
        source: source(fixture, "system"),
        audit: audit("alpha gap")
      });
      const beta = await fixture.agenda.recordGap(grow.value, {
        kind: "missing_goal_boundary",
        summary: "beta missing chapter success boundary",
        requiredInput: "chapter boundary",
        requiredEvidence: "accepted chapter DoD",
        blockingReason: "cannot stop grow cleanly",
        source: source(fixture, "system"),
        audit: audit("beta gap")
      });
      expect(alpha.ok).toBe(true);
      expect(beta.ok).toBe(true);
      if (!alpha.ok || !beta.ok) throw new Error("gap setup failed");

      const page = await fixture.agenda.listOpenGaps(grow.value, { limit: 1 });
      expect(page.ok).toBe(true);
      if (page.ok) {
        expect(page.value.records).toHaveLength(1);
        expect(page.value.truncated).toBe(true);
      }
      const text = await fixture.agenda.listOpenGaps(grow.value, { text: "alpha" });
      expect(text.ok).toBe(true);
      if (text.ok) expect(text.value.total).toBe(1);

      const resolved = await fixture.agenda.resolveGapForNow(alpha.value, {
        reason: "notes were attached",
        source: source(fixture, "system"),
        audit: audit("resolve alpha")
      });
      expect(resolved.ok).toBe(true);
      const open = await fixture.agenda.listOpenGaps(grow.value);
      expect(open.ok).toBe(true);
      if (open.ok) expect(open.value.total).toBe(1);
      const resolvedList = await fixture.agenda.listOpenGaps(grow.value, { status: "resolved_for_now" });
      expect(resolvedList.ok).toBe(true);
      if (resolvedList.ok) expect(resolvedList.value.total).toBe(1);
    });
  });

  test("blocks agenda mutations after the grow unit is archived", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgendaFixture(workspace);
      const grow = await createGrowAndAgenda(fixture);
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);

      const archived = await fixture.grow.archiveGrowUnit(grow.value, {
        reason: "archive with policy",
        source: source(fixture, "system"),
        audit: audit("archive grow"),
        policyContext: allowArchivePolicy()
      });
      expect(archived.ok).toBe(true);
      const afterArchive = await fixture.agenda.recordGap(grow.value, {
        kind: "missing_material",
        summary: "cannot mutate archived grow",
        requiredInput: "input",
        requiredEvidence: "evidence",
        blockingReason: "archived",
        source: source(fixture, "system"),
        audit: audit("mutate archived")
      });
      expect(afterArchive.ok).toBe(false);
      if (!afterArchive.ok) expect(afterArchive.error.code).toBe("grow_unit_archived");
      const itemAfterArchive = await fixture.agenda.proposeAgendaItem(grow.value, {
        kind: "collect_material",
        summary: "cannot propose archived",
        reason: "archived",
        expectedOutput: "none",
        source: source(fixture, "system"),
        audit: audit("item archived")
      });
      expect(itemAfterArchive.ok).toBe(false);
      const dodAfterArchive = await fixture.agenda.defineDoD(grow.value, {
        statement: "cannot define archived",
        scope: "archived",
        evidenceRequirement: "none",
        validationIntent: "none",
        source: source(fixture, "system"),
        version,
        audit: audit("dod archived")
      });
      expect(dodAfterArchive.ok).toBe(false);
      const intentAfterArchive = await fixture.agenda.buildAttemptIntent(grow.value, {
        source: source(fixture, "system"),
        audit: audit("intent archived")
      });
      expect(intentAfterArchive.ok).toBe(false);
    });
  });
});

import { describe, expect, test } from "vitest";
import { makeArtifactId, makeRef, makeToolId } from "../../src/domain/index.js";
import { makeLedgerStreamId } from "../../src/event-ledger/index.js";
import { contextEventTypes } from "../../src/context-message-compiler/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import {
  activateWorkspaceSkill,
  allowArchivePolicy,
  artifactInput,
  audit,
  createGrowAndAgenda,
  receiveInput,
  source,
  version
} from "../agenda-dod-manager/helpers.js";
import { compileInput, makeContextFixture, parseArtifactJson } from "./helpers.js";

describe("Context & Message Compiler", () => {
  test("compiles a file-native provider-neutral message list with reports and exclusions", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const grow = await createGrowAndAgenda(fixture, "boss-agent");
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);
      const skill = await activateWorkspaceSkill(fixture);
      const material = await fixture.artifacts.registerArtifact(artifactInput(fixture, "allowed actions: jump, charge, retreat"));
      const targetWorld = await fixture.artifacts.registerArtifact(artifactInput(fixture, "arena grid with player and boss coordinates"));
      expect(skill.ok && material.ok && targetWorld.ok).toBe(true);
      if (!skill.ok || !material.ok || !targetWorld.ok) throw new Error("setup failed");
      const linkedWorld = await fixture.grow.linkTargetWorld(grow.value, {
        targetWorldSummaryRef: targetWorld.value,
        targetBehaviorSummary: "Boss agent emits one allowed action per tick.",
        reason: "link target world",
        source: source(fixture, "system"),
        audit: audit("link world")
      });
      expect(linkedWorld.ok).toBe(true);
      const selected = await fixture.admission.receiveUserInput(grow.value, receiveInput(fixture, "Make a boss agent with bounded actions"));
      expect(selected.ok).toBe(true);
      if (!selected.ok) throw new Error(selected.error.message);
      const feedback = await fixture.admission.createFeedbackUnit({
        growUnitRef: grow.value,
        originLayer: "external_runtime",
        targetLayer: "target_agent_project",
        summary: "Boss selected an invalid action during debug mode",
        attribution: "debug runtime",
        impact: "invalid game command",
        suggestedAction: "tighten allowed action DoD",
        privacyClass: "workspace_private",
        source: source(fixture, "runtime"),
        audit: audit("create feedback")
      });
      expect(feedback.ok).toBe(true);
      const item = await fixture.agenda.proposeAgendaItem(grow.value, {
        kind: "define_runtime_contract",
        summary: "Define allowed boss action contract",
        reason: "runtime must know what actions can be emitted",
        inputRefs: [material.value, selected.value],
        expectedOutput: "A contract listing allowed boss actions and target ids",
        evidenceRequirementRefs: [material.value],
        source: source(fixture, "system"),
        audit: audit("propose item")
      });
      expect(item.ok).toBe(true);
      if (!item.ok) throw new Error(item.error.message);
      expect((await fixture.agenda.activateAgendaItem(item.value, {
        reason: "activate item",
        source: source(fixture, "system"),
        audit: audit("activate item")
      })).ok).toBe(true);
      expect((await fixture.agenda.defineDoD(grow.value, {
        statement: "Every emitted boss action is allowed",
        scope: "boss runtime output",
        evidenceRequirement: "Trace validates emitted action names",
        validationIntent: "Inspect runtime trace after candidate run",
        targetWorldSummaryRef: material.value,
        source: source(fixture, "system"),
        version,
        audit: audit("define dod")
      })).ok).toBe(true);
      const intent = await fixture.agenda.buildAttemptIntent(grow.value, {
        source: source(fixture, "system"),
        audit: audit("build intent")
      });
      expect(intent.ok).toBe(true);
      const lateAdmitted = await fixture.admission.receiveUserInput(grow.value, receiveInput(fixture, "Late extra lore should not auto-enter"));
      expect(lateAdmitted.ok).toBe(true);
      if (!lateAdmitted.ok) throw new Error(lateAdmitted.error.message);

      const compiled = await fixture.context.compileMessageList(compileInput(fixture, grow.value, {
        correlationId: "ctx-corr-1",
        toolSurfaceSummary: [
          {
            toolId: makeToolId("tool-read-trace"),
            name: "read-trace",
            capabilitySummary: "Read a stored debug trace summary",
            policyBoundarySummary: "read-only artifact access",
            inclusionReason: "attempt may inspect validation evidence",
            safeForModel: true
          },
          {
            toolId: makeToolId("tool-shell"),
            name: "shell",
            capabilitySummary: "Run arbitrary commands",
            policyBoundarySummary: "requires execution grant",
            inclusionReason: "not safe for model visibility",
            safeForModel: false
          }
        ]
      }));
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) throw new Error(compiled.error.message);
      const explanation = await fixture.context.explainMessageList(compiled.value);
      expect(explanation.ok).toBe(true);
      if (!explanation.ok) throw new Error(explanation.error.message);
      expect(explanation.value.sourceMap.entries.length).toBeGreaterThan(8);
      expect(explanation.value.budgetReport.budgetModel).toBe("rough_char_tokens");
      expect(explanation.value.exclusionList.records.some((item) => item.reason === "unsafe_tool_surface")).toBe(true);
      expect(explanation.value.exclusionList.records.some((item) => item.sourceRef?.id === lateAdmitted.value.id)).toBe(true);
      const artifact = await fixture.artifacts.materializeArtifact(explanation.value.compileReport.artifactRef, {
        reason: "assert compiled artifact",
        maxBytes: 256 * 1024
      });
      expect(artifact.ok).toBe(true);
      if (!artifact.ok) throw new Error(artifact.error.message);
      const compiledJson = parseArtifactJson<{ sections: { sourceMapEntryIds: string[] }[]; providerNeutralMessages: { content: { text: string }[] }[] }>(artifact.value.content);
      expect(compiledJson.sections.every((section) => section.sourceMapEntryIds.length > 0)).toBe(true);
      const messageText = compiledJson.providerNeutralMessages[0]?.content[0]?.text ?? "";
      expect(messageText).toContain("allowed actions");
      expect(messageText).toContain("read-trace");
      expect(messageText).not.toContain("Never inline this body");
      expect(messageText).not.toContain("Late extra lore");
      const growRecord = await fixture.grow.getGrowUnit(grow.value);
      expect(growRecord.ok).toBe(true);
      if (growRecord.ok) expect(growRecord.value.latestMessageListRef?.id).toBe(compiled.value.id);
    });
  });

  test("recompile creates a new message list and invalidation records do not rewrite the old artifact", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const grow = await createGrowAndAgenda(fixture, "recompile-agent");
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);
      expect((await fixture.agenda.buildAttemptIntent(grow.value, {
        source: source(fixture, "system"),
        audit: audit("build intent")
      })).ok).toBe(true);
      const first = await fixture.context.compileMessageList(compileInput(fixture, grow.value));
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error(first.error.message);
      const firstExplanation = await fixture.context.explainMessageList(first.value);
      expect(firstExplanation.ok).toBe(true);
      if (!firstExplanation.ok) throw new Error(firstExplanation.error.message);
      const firstArtifact = firstExplanation.value.compileReport.artifactRef;
      const second = await fixture.context.recompileMessageList(first.value, {
        reason: "compile from fresher file-native facts",
        source: source(fixture, "system"),
        version,
        audit: audit("recompile")
      });
      expect(second.ok).toBe(true);
      if (!second.ok) throw new Error(second.error.message);
      expect(second.value.id).not.toBe(first.value.id);
      const firstAgain = await fixture.context.explainMessageList(first.value);
      expect(firstAgain.ok).toBe(true);
      if (firstAgain.ok) expect(firstAgain.value.compileReport.artifactRef.id).toBe(firstArtifact.id);
      const invalidated = await fixture.context.invalidateMessageList(first.value, {
        reason: "superseded by recompile",
        replacementRef: second.value,
        source: source(fixture, "system"),
        version,
        audit: audit("invalidate")
      });
      expect(invalidated.ok).toBe(true);
      const events = await fixture.ledger.replayStream({
        streamType: "grow_unit",
        streamId: makeLedgerStreamId(grow.value.id)
      }, { reason: "assert context events" });
      expect(events.ok).toBe(true);
      if (events.ok) {
        expect(events.value.events.some((event) => event.eventType === contextEventTypes.messageListRecompiled)).toBe(true);
        expect(events.value.events.some((event) => event.eventType === contextEventTypes.messageListInvalidated)).toBe(true);
      }
    });
  });

  test("privacy-blocked artifacts and budget pressure are explicit exclusions", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const grow = await createGrowAndAgenda(fixture, "privacy-budget-agent");
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);
      const secret = await fixture.artifacts.registerArtifact(artifactInput(fixture, "SECRET_TOKEN=abc123", {
        privacyClass: "contains_secret"
      }));
      const large = await fixture.artifacts.registerArtifact(artifactInput(fixture, "long context ".repeat(500), {
        privacyClass: "public"
      }));
      expect(secret.ok && large.ok).toBe(true);
      if (!secret.ok || !large.ok) throw new Error("artifact setup failed");
      const compiled = await fixture.context.compileMessageList(compileInput(fixture, grow.value, {
        artifactCandidateRefs: [secret.value, large.value],
        budget: { totalBudget: 260 }
      }));
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) throw new Error(compiled.error.message);
      const explanation = await fixture.context.explainMessageList(compiled.value);
      expect(explanation.ok).toBe(true);
      if (!explanation.ok) throw new Error(explanation.error.message);
      expect(explanation.value.exclusionList.records.some((item) => item.reason === "privacy_blocked")).toBe(true);
      expect(explanation.value.exclusionList.records.some((item) => item.reason === "out_of_budget")).toBe(true);
      expect(explanation.value.budgetReport.truncationApplied).toBe(true);
      expect(explanation.value.sourceMap.entries.some((entry) => entry.truncated)).toBe(true);
      const artifact = await fixture.artifacts.materializeArtifact(explanation.value.compileReport.artifactRef, {
        reason: "assert privacy",
        maxBytes: 256 * 1024
      });
      expect(artifact.ok).toBe(true);
      if (artifact.ok && typeof artifact.value.content === "string") {
        expect(artifact.value.content).not.toContain("SECRET_TOKEN");
      }
    });
  });

  test("plan, read ports, and bounded skill body mode stay file-native", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const grow = await createGrowAndAgenda(fixture, "skill-body-agent");
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);
      const skill = await activateWorkspaceSkill(fixture);
      expect(skill.ok).toBe(true);
      const intent = await fixture.agenda.buildAttemptIntent(grow.value, {
        source: source(fixture, "system"),
        audit: audit("build skill intent")
      });
      expect(intent.ok).toBe(true);
      const plan = await fixture.context.buildCompilePlan(compileInput(fixture, grow.value, {
        skillBodyMode: "bounded_body"
      }));
      expect(plan.ok).toBe(true);
      if (!plan.ok) throw new Error(plan.error.message);
      const planExplanation = await fixture.context.explainCompilePlan(plan.value.compilePlanRef);
      expect(planExplanation.ok).toBe(true);
      if (planExplanation.ok) {
        expect(planExplanation.value.candidateCount).toBeGreaterThan(0);
        expect(planExplanation.value.sectionPlan).toContain("visible_skills");
      }
      const compiled = await fixture.context.compileMessageList(compileInput(fixture, grow.value, {
        skillBodyMode: "bounded_body"
      }));
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) throw new Error(compiled.error.message);
      const sourceMap = await fixture.context.readSourceMap(compiled.value);
      const budget = await fixture.context.readBudgetReport(compiled.value);
      const exclusions = await fixture.context.readExclusionList(compiled.value);
      expect(sourceMap.ok && budget.ok && exclusions.ok).toBe(true);
      const explanation = await fixture.context.explainMessageList(compiled.value);
      expect(explanation.ok).toBe(true);
      if (!explanation.ok) throw new Error(explanation.error.message);
      const artifact = await fixture.artifacts.materializeArtifact(explanation.value.compileReport.artifactRef, {
        reason: "assert bounded skill body",
        maxBytes: 256 * 1024
      });
      expect(artifact.ok).toBe(true);
      if (artifact.ok && typeof artifact.value.content === "string") {
        expect(artifact.value.content).toContain("Never inline this body");
      }
    });
  });

  test("compile failure is recorded without calling an LLM", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const grow = await createGrowAndAgenda(fixture, "archived-agent");
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);
      const archived = await fixture.grow.archiveGrowUnit(grow.value, {
        reason: "archive before compile",
        source: source(fixture, "system"),
        audit: audit("archive"),
        policyContext: allowArchivePolicy()
      });
      expect(archived.ok).toBe(true);
      const compiled = await fixture.context.compileMessageList(compileInput(fixture, grow.value));
      expect(compiled.ok).toBe(false);
      if (!compiled.ok) expect(compiled.error.code).toBe("grow_unit_archived");
      const events = await fixture.ledger.replayStream({
        streamType: "grow_unit",
        streamId: makeLedgerStreamId(grow.value.id)
      }, { reason: "assert failure event" });
      expect(events.ok).toBe(true);
      if (events.ok) {
        expect(events.value.events.some((event) => event.eventType === contextEventTypes.compileFailed)).toBe(true);
      }
    });
  });

  test("redacted, retracted, unavailable, and missing artifacts become source exclusions", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeContextFixture(workspace);
      const grow = await createGrowAndAgenda(fixture, "artifact-state-agent");
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);
      const redacted = await fixture.artifacts.registerArtifact(artifactInput(fixture, "redacted material"));
      const retracted = await fixture.artifacts.registerArtifact(artifactInput(fixture, "retracted material"));
      const unavailable = await fixture.artifacts.registerArtifact(artifactInput(fixture, "unavailable material"));
      expect(redacted.ok && retracted.ok && unavailable.ok).toBe(true);
      if (!redacted.ok || !retracted.ok || !unavailable.ok) throw new Error("artifact setup failed");
      expect((await fixture.artifacts.redactArtifact(redacted.value, "redact for test")).ok).toBe(true);
      expect((await fixture.artifacts.retractArtifact(retracted.value, "retract for test")).ok).toBe(true);
      expect((await fixture.artifacts.markUnavailable(unavailable.value, "unavailable for test")).ok).toBe(true);
      const missing = makeRef("artifact", makeArtifactId("artifact-missing-for-context"));
      const compiled = await fixture.context.compileMessageList(compileInput(fixture, grow.value, {
        artifactCandidateRefs: [redacted.value, retracted.value, unavailable.value, missing]
      }));
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) throw new Error(compiled.error.message);
      const exclusions = await fixture.context.readExclusionList(compiled.value);
      expect(exclusions.ok).toBe(true);
      if (exclusions.ok) {
        const reasons = exclusions.value.records.map((item) => item.reason);
        expect(reasons).toContain("redacted");
        expect(reasons).toContain("retracted");
        expect(reasons.filter((reason) => reason === "artifact_unavailable").length).toBeGreaterThanOrEqual(2);
      }
    });
  });
});

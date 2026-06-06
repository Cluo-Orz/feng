import { describe, expect, test } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import {
  activateWorkspaceSkill,
  artifactInput,
  audit,
  createGrowAndAgenda,
  makeAgendaFixture,
  receiveInput,
  source,
  version
} from "./helpers.js";

describe("Agenda DoD Manager - attempt intent", () => {
  test("builds a file-native attempt intent from agenda, admission, DoD, and skill summaries", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgendaFixture(workspace);
      const grow = await createGrowAndAgenda(fixture);
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);

      const skill = await activateWorkspaceSkill(fixture);
      expect(skill.ok).toBe(true);
      const material = await fixture.artifacts.registerArtifact(artifactInput(fixture, "boss input and output notes"));
      const evidence = await fixture.artifacts.registerArtifact(artifactInput(fixture, "contract evidence placeholder"));
      expect(material.ok).toBe(true);
      expect(evidence.ok).toBe(true);
      if (!material.ok || !evidence.ok) throw new Error("artifact setup failed");

      const inbox = await fixture.admission.receiveUserInput(grow.value, receiveInput(fixture, "Make a boss agent"));
      expect(inbox.ok).toBe(true);
      if (!inbox.ok) throw new Error(inbox.error.message);
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
      if (!feedback.ok) throw new Error(feedback.error.message);

      const item = await fixture.agenda.proposeAgendaItem(grow.value, {
        kind: "define_runtime_contract",
        summary: "Define allowed boss action contract",
        reason: "runtime must know what actions can be emitted",
        inputRefs: [material.value, inbox.value],
        expectedOutput: "A contract listing allowed boss actions and target ids",
        evidenceRequirementRefs: [evidence.value],
        source: source(fixture, "system"),
        audit: audit("propose contract")
      });
      expect(item.ok).toBe(true);
      if (!item.ok) throw new Error(item.error.message);
      const active = await fixture.agenda.activateAgendaItem(item.value, {
        reason: "make contract the next grow focus",
        source: source(fixture, "system"),
        audit: audit("activate contract")
      });
      expect(active.ok).toBe(true);

      const dod = await fixture.agenda.defineDoD(grow.value, {
        statement: "Every boss action is in the allowed action list",
        scope: "boss runtime output",
        evidenceRequirement: "Validation report compares emitted actions with the allowed list",
        validationIntent: "Run a trace inspection after candidate generation",
        targetWorldSummaryRef: material.value,
        source: source(fixture, "system"),
        version,
        audit: audit("define runtime dod")
      });
      expect(dod.ok).toBe(true);

      const intent = await fixture.agenda.buildAttemptIntent(grow.value, {
        source: source(fixture, "system"),
        audit: audit("build intent")
      });
      expect(intent.ok).toBe(true);
      if (!intent.ok) throw new Error(intent.error.message);
      const explained = await fixture.agenda.explainAttemptIntent(intent.value);
      expect(explained.ok).toBe(true);
      if (explained.ok) {
        const json = JSON.stringify(explained.value);
        expect(explained.value.focusAgendaItemRefs).toHaveLength(1);
        expect(explained.value.inputCandidateRefs.some((ref) => ref.id === inbox.value.id)).toBe(true);
        expect(explained.value.inputCandidateRefs.some((ref) => ref.id === feedback.value.id)).toBe(true);
        expect(explained.value.requiredContextRefs.some((ref) => ref.id === material.value.id)).toBe(true);
        expect(explained.value.visibleSkillScopeSummary).toHaveLength(1);
        expect(json).not.toContain("Never inline this body");
        expect(json).not.toMatch(/message_list|session/i);
      }

      const summary = await fixture.agenda.buildAgendaSummary(grow.value);
      expect(summary.ok).toBe(true);
      if (summary.ok) expect(summary.value.attemptIntentRef?.id).toBe(intent.value.id);
    });
  });

  test("builds intent from open gaps or current focus without auto-activating proposed items", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgendaFixture(workspace);
      const grow = await createGrowAndAgenda(fixture, "gap-only-agent");
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);
      const inbox = await fixture.admission.receiveUserInput(grow.value, receiveInput(fixture, "Need one debug trace"));
      const feedback = await fixture.admission.createFeedbackUnit({
        growUnitRef: grow.value,
        originLayer: "external_runtime",
        targetLayer: "target_agent_project",
        summary: "Runtime missed a debug trace",
        attribution: "debug",
        impact: "cannot validate",
        suggestedAction: "collect trace",
        privacyClass: "workspace_private",
        source: source(fixture, "runtime"),
        audit: audit("feedback")
      });
      expect(inbox.ok).toBe(true);
      expect(feedback.ok).toBe(true);
      if (!inbox.ok || !feedback.ok) throw new Error("admission setup failed");
      const gap = await fixture.agenda.recordGap(grow.value, {
        kind: "missing_validation_environment",
        summary: "Need a playable debug trace",
        requiredInput: "debug trace",
        requiredEvidence: "trace artifact",
        blockingReason: "no validation environment",
        relatedAdmissionRefs: [inbox.value],
        relatedFeedbackRefs: [feedback.value],
        source: source(fixture, "system"),
        audit: audit("record gap")
      });
      expect(gap.ok).toBe(true);

      const proposed = await fixture.agenda.proposeAgendaItem(grow.value, {
        kind: "validate_candidate",
        summary: "Proposed validation item stays proposed",
        reason: "not active yet",
        expectedOutput: "validation plan",
        source: source(fixture, "system"),
        audit: audit("propose only")
      });
      expect(proposed.ok).toBe(true);
      const intent = await fixture.agenda.buildAttemptIntent(grow.value, {
        source: source(fixture, "system"),
        audit: audit("gap intent")
      });
      expect(intent.ok).toBe(true);
      if (!intent.ok) throw new Error(intent.error.message);
      const explained = await fixture.agenda.explainAttemptIntent(intent.value);
      expect(explained.ok).toBe(true);
      if (explained.ok) {
        expect(explained.value.focusAgendaItemRefs).toHaveLength(0);
        expect(explained.value.purpose).toContain("Resolve open agenda gaps");
        expect(explained.value.toolNeedSummary).toContain("debug trace");
        expect(explained.value.stopCondition).toContain("targeted gap");
        expect(explained.value.inputCandidateRefs.some((ref) => ref.id === inbox.value.id)).toBe(true);
        expect(explained.value.inputCandidateRefs.some((ref) => ref.id === feedback.value.id)).toBe(true);
      }
    });
  });

  test("uses current focus and caller-supplied intent summaries when no active item or gap exists", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgendaFixture(workspace);
      const grow = await createGrowAndAgenda(fixture, "focus-only-agent");
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);

      const defaultIntent = await fixture.agenda.buildAttemptIntent(grow.value, {
        source: source(fixture, "system"),
        audit: audit("default focus intent")
      });
      expect(defaultIntent.ok).toBe(true);
      if (!defaultIntent.ok) throw new Error(defaultIntent.error.message);
      const defaultExplained = await fixture.agenda.explainAttemptIntent(defaultIntent.value);
      expect(defaultExplained.ok).toBe(true);
      if (defaultExplained.ok) expect(defaultExplained.value.purpose).toBe("clarify target behavior and evidence");
      const stateWithIntent = await fixture.agenda.explainAgendaState(grow.value);
      expect(stateWithIntent.ok).toBe(true);
      if (stateWithIntent.ok) {
        expect(stateWithIntent.value.facts.some((fact) => fact.startsWith("attemptIntent="))).toBe(true);
      }

      const intent = await fixture.agenda.buildAttemptIntent(grow.value, {
        purpose: "Custom lightweight grow step",
        toolNeedSummary: "No tools for this pass",
        policyBoundarySummary: "read-only inspection",
        stopCondition: "Stop after updating notes",
        source: source(fixture, "system"),
        audit: audit("custom intent")
      });
      expect(intent.ok).toBe(true);
      if (!intent.ok) throw new Error(intent.error.message);
      const explained = await fixture.agenda.explainAttemptIntent(intent.value);
      expect(explained.ok).toBe(true);
      if (explained.ok) {
        expect(explained.value.purpose).toBe("Custom lightweight grow step");
        expect(explained.value.expectedOutputs).toHaveLength(0);
        expect(explained.value.expectedEvidence).toHaveLength(0);
        expect(explained.value.policyBoundarySummary).toBe("read-only inspection");
      }
    });
  });
});

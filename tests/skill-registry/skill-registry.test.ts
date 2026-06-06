import { describe, expect, test } from "vitest";
import { makeRef, makeSkillId } from "../../src/domain/index.js";
import { skillCatalogStream, skillStream } from "../../src/skill-registry/events.js";
import { withWorkspace } from "../file-store/helpers.js";
import { audit } from "../event-ledger/helpers.js";
import {
  activationInput,
  allowSkillPolicyContext,
  makeSkillFixture,
  registerInput,
  version2
} from "./helpers.js";

describe("Skill Registry", () => {
  test("discovers skill markdown without registering it", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeSkillFixture(workspace);
      await fixture.store.writeTextAtomic(
        fixture.workspace,
        "skills/scene/SKILL.md",
        "---\nname: scene-skill\ndescription: Helps write scenes.\nversion: 1\n---\nBody",
        { reason: "seed skill", createParents: true }
      );

      const discovered = await fixture.skills.discoverSkills({
        workspace: fixture.workspace.id,
        searchPaths: ["skills"],
        sourceKind: "workspace_local"
      });
      expect(discovered.ok).toBe(true);
      if (!discovered.ok) throw new Error(discovered.error.message);
      expect(discovered.value.discovered).toHaveLength(1);
      expect(discovered.value.discovered[0]?.name).toBe("scene-skill");

      const catalog = await fixture.skills.listSkills();
      expect(catalog.ok).toBe(true);
      if (catalog.ok) expect(catalog.value.total).toBe(0);

      const replay = await fixture.ledger.replayStream(skillCatalogStream, { reason: "replay discovery" });
      expect(replay.ok).toBe(true);
      if (replay.ok) expect(replay.value.events[0]?.eventType).toBe("skill_discovered");
    });
  });

  test("registers skill body as an artifact and keeps lifecycle events lightweight", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeSkillFixture(workspace);
      const ref = await fixture.skills.registerSkill(registerInput(fixture));
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);

      const record = await fixture.skills.getSkill(ref.value);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);
      expect(record.value.bodyRef.kind).toBe("artifact");
      expect(record.value.lifecycle).toBe("registered");

      const body = await fixture.skills.loadSkillBody(ref.value, { reason: "read body" });
      expect(body.ok).toBe(true);
      if (body.ok) expect(body.value.content).toContain("Novel Style");

      const summary = await fixture.skills.loadSkillSummary(ref.value, { reason: "summary" });
      expect(summary.ok).toBe(true);
      if (summary.ok) expect(summary.value).not.toHaveProperty("body");

      const replay = await fixture.ledger.replayStream(skillStream(ref.value), { reason: "replay skill" });
      expect(replay.ok).toBe(true);
      if (replay.ok) {
        const payload = JSON.stringify(replay.value.events[0]?.payload);
        expect(payload).not.toContain("Never inline this body");
      }
    });
  });

  test("requires policy to activate and keeps active skills as candidates only", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeSkillFixture(workspace);
      const ref = await fixture.skills.registerSkill(registerInput(fixture, { sourceKind: "external_package" }));
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);

      const blocked = await fixture.skills.activateSkill(ref.value, {
        ...activationInput(fixture),
        policyContext: { ...allowSkillPolicyContext(), rules: [] }
      });
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.error.code).toBe("activation_blocked");

      const activation = await fixture.skills.activateSkill(ref.value, activationInput(fixture));
      expect(activation.ok).toBe(true);
      if (!activation.ok) throw new Error(activation.error.message);
      expect(activation.value.status).toBe("enabled");
      expect(activation.value.policyDecisionId).toBeDefined();

      const active = await fixture.skills.listActiveSkills({ workspace: fixture.workspace.id });
      expect(active.ok).toBe(true);
      if (active.ok) expect(active.value.skills).toHaveLength(1);

      const candidates = await fixture.skills.findSkillCandidates({
        text: "novel scenes",
        scope: { workspace: fixture.workspace.id },
        requiredCapabilities: ["artifact.read"]
      });
      expect(candidates.ok).toBe(true);
      if (candidates.ok) {
        expect(candidates.value.candidates).toHaveLength(1);
        expect(candidates.value.candidates[0]?.limitations[0]).toContain("candidate");
      }

      const explanation = await fixture.skills.explainSkillCandidate(ref.value, {
        text: "novel",
        scope: { workspace: fixture.workspace.id }
      });
      expect(explanation.ok).toBe(true);
      if (explanation.ok) expect(explanation.value.matched).toBe(true);

      const disabled = await fixture.skills.disableSkill(ref.value, activationInput(fixture));
      expect(disabled.ok).toBe(true);
      const afterDisable = await fixture.skills.listActiveSkills({ workspace: fixture.workspace.id });
      expect(afterDisable.ok).toBe(true);
      if (afterDisable.ok) expect(afterDisable.value.skills).toHaveLength(0);
    });
  });

  test("adds immutable versions, pins, rolls back, and retracts without deleting history", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeSkillFixture(workspace);
      const v1 = await fixture.skills.registerSkill(registerInput(fixture));
      expect(v1.ok).toBe(true);
      if (!v1.ok) throw new Error(v1.error.message);
      const v2 = await fixture.skills.addSkillVersion(v1.value, {
        ...registerInput(fixture, {
          version: version2,
          body: "# Novel Style v2\nUpdated guidance.",
          description: "Updated style guidance."
        }),
        version: version2
      });
      expect(v2.ok).toBe(true);
      if (!v2.ok) throw new Error(v2.error.message);

      const diff = await fixture.skills.compareSkillVersions(v1.value, "1", "2");
      expect(diff.ok).toBe(true);
      if (diff.ok) expect(diff.value.changedFields).toContain("bodyRef");

      const pinned = await fixture.skills.pinSkillVersion(v1.value, "2", activationInput(fixture));
      expect(pinned.ok).toBe(true);
      if (pinned.ok) expect(pinned.value.status).toBe("pinned");

      const rollback = await fixture.skills.rollbackSkill(v2.value, activationInput(fixture), v1.value);
      expect(rollback.ok).toBe(true);
      if (rollback.ok) expect(rollback.value.status).toBe("rolled_back");

      const retracted = await fixture.skills.retractSkillVersion(v1.value, "2", "bad version");
      expect(retracted.ok).toBe(true);
      const activateRetracted = await fixture.skills.activateSkill(v2.value, activationInput(fixture));
      expect(activateRetracted.ok).toBe(false);
      if (!activateRetracted.ok) expect(activateRetracted.error.code).toBe("skill_retracted");

      const missing = makeRef("skill", makeSkillId("skill-missing"));
      const missingRollback = await fixture.skills.rollbackSkill(v1.value, activationInput(fixture), missing);
      expect(missingRollback.ok).toBe(false);
      if (!missingRollback.ok) expect(missingRollback.error.code).toBe("rollback_target_missing");
    });
  });

  test("ensures default feedback router as a policy-gated system skill", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeSkillFixture(workspace);
      const ref = await fixture.skills.ensureDefaultFeedbackRouter({
        ...registerInput(fixture, {
          version: version2,
          body: "# Default Feedback Router\nRoute feedback as candidates only.",
          scope: { workspace: fixture.workspace.id, systemDefault: true },
          description: "Default feedback router protocol and strategy.",
          triggerSummary: "Use for feedback routing proposals."
        }),
        version: version2,
        activate: activationInput(fixture, { scope: { workspace: fixture.workspace.id, systemDefault: true } })
      });
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);
      const record = await fixture.skills.getSkill(ref.value);
      expect(record.ok).toBe(true);
      if (record.ok) {
        expect(record.value.family).toBe("default_feedback_router");
        expect(record.value.sourceKind).toBe("system_default");
      }
      const active = await fixture.skills.listActiveSkills({ workspace: fixture.workspace.id, systemDefault: true });
      expect(active.ok).toBe(true);
      if (active.ok) expect(active.value.skills[0]?.record.family).toBe("default_feedback_router");
    });
  });

  test("blocks candidate skills and unavailable bodies explicitly", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeSkillFixture(workspace);
      const candidate = await fixture.skills.registerSkill(registerInput(fixture, { sourceKind: "upstream_proposed" }));
      expect(candidate.ok).toBe(true);
      if (!candidate.ok) throw new Error(candidate.error.message);
      const blocked = await fixture.skills.activateSkill(candidate.value, activationInput(fixture));
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.error.code).toBe("activation_blocked");

      const ref = await fixture.skills.registerSkill(registerInput(fixture, { audit: audit("register redacted body") }));
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);
      const record = await fixture.skills.getSkill(ref.value);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);
      const redacted = await fixture.artifacts.redactArtifact(record.value.bodyRef, "redact body");
      expect(redacted.ok).toBe(true);
      const loaded = await fixture.skills.loadSkillBody(ref.value, { reason: "read redacted" });
      expect(loaded.ok).toBe(false);
      if (!loaded.ok) expect(loaded.error.code).toBe("privacy_blocked");
    });
  });
});

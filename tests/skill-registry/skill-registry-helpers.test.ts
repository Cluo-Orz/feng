import { describe, expect, test } from "vitest";
import {
  makeAttemptId,
  makeGrowUnitId,
  makeHatchPackageId,
  makeRuntimeContractId,
  makeWorkspaceId,
  makeTargetWorldId
} from "../../src/domain/index.js";
import { parseSkillMarkdown } from "../../src/skill-registry/discovery.js";
import {
  activationGuard,
  activationIsActive,
  candidateFor,
  changedFields,
  defaultPolicyContext,
  initialLifecycle,
  latestActivations,
  matchesQuery,
  parseJson,
  recordUsable,
  systemSource,
  validateRegisterInput
} from "../../src/skill-registry/logic.js";
import { scopeCoversRequest, scopeMatchesFilter, scopeSummary } from "../../src/skill-registry/scope.js";
import { toSkillEventPayload } from "../../src/skill-registry/payloads.js";
import { SkillRegistryStorage } from "../../src/skill-registry/storage.js";
import { skillActivationIndexPath, skillIndexPath } from "../../src/skill-registry/paths.js";
import { makeSkillActivationId } from "../../src/skill-registry/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import { activationInput, allowSkillPolicyContext, makeSkillFixture, registerInput } from "./helpers.js";

describe("Skill Registry helper and edge behavior", () => {
  test("parses skill markdown variants and reports invalid markdown", () => {
    const frontmatter = parseSkillMarkdown(
      "skills/demo/SKILL.md",
      "---\nname: demo\ndescription: Demo skill.\nversion: 3\n---\nBody",
      "workspace_local"
    );
    expect(frontmatter.ok).toBe(true);
    if (frontmatter.ok) expect(frontmatter.value.version.schemaVersion).toBe("3");

    const inferred = parseSkillMarkdown("skills/write.skill.md", "# Write well\n\nBody", "user_imported");
    expect(inferred.ok).toBe(true);
    if (inferred.ok) {
      expect(inferred.value.name).toBe("write");
      expect(inferred.value.description).toBe("Write well");
    }

    const invalid = parseSkillMarkdown("skills/bad/SKILL.md", "---\nname: bad\n---\n", "workspace_local");
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe("schema_incompatible");

    const noClosingFrontmatter = parseSkillMarkdown("skills/noend.skill.md", "---\nname without colon\n# Fallback", "workspace_local");
    expect(noClosingFrontmatter.ok).toBe(true);
    const quoted = parseSkillMarkdown("skills/quoted/SKILL.md", "---\nname: quoted\ndescription: \"Quoted desc\"\n---\nBody", "workspace_local");
    expect(quoted.ok).toBe(true);
    if (quoted.ok) expect(quoted.value.description).toBe("Quoted desc");
  });

  test("evaluates scope filters and coverage without leaking across scopes", () => {
    const scope = {
      workspace: makeWorkspaceId("workspace-a"),
      growUnit: makeGrowUnitId("grow-1"),
      attempt: makeAttemptId("attempt-1"),
      runtimeContract: makeRuntimeContractId("runtime-1"),
      hatchPackage: makeHatchPackageId("hatch-1"),
      targetWorld: makeTargetWorldId("world-1"),
      systemDefault: true
    };
    expect(scopeMatchesFilter(undefined, scope)).toBe(true);
    expect(scopeMatchesFilter({ growUnit: makeGrowUnitId("grow-2") }, scope)).toBe(false);
    expect(scopeMatchesFilter({ attempt: makeAttemptId("attempt-2") }, scope)).toBe(false);
    expect(scopeMatchesFilter({ runtimeContract: makeRuntimeContractId("runtime-2") }, scope)).toBe(false);
    expect(scopeMatchesFilter({ hatchPackage: makeHatchPackageId("hatch-2") }, scope)).toBe(false);
    expect(scopeMatchesFilter({ targetWorld: makeTargetWorldId("world-2") }, scope)).toBe(false);
    expect(scopeMatchesFilter({ systemDefault: false }, scope)).toBe(false);
    expect(scopeCoversRequest({ workspace: scope.workspace }, scope)).toBe(true);
    expect(scopeCoversRequest({ growUnit: makeGrowUnitId("grow-2") }, scope)).toBe(false);
    expect(scopeCoversRequest({ attempt: makeAttemptId("attempt-2") }, scope)).toBe(false);
    expect(scopeCoversRequest({ runtimeContract: makeRuntimeContractId("runtime-2") }, scope)).toBe(false);
    expect(scopeCoversRequest({ hatchPackage: makeHatchPackageId("hatch-2") }, scope)).toBe(false);
    expect(scopeCoversRequest({ targetWorld: makeTargetWorldId("world-2") }, scope)).toBe(false);
    expect(scopeCoversRequest({ systemDefault: false }, scope)).toBe(false);
    expect(scopeSummary({})).toBe("unscoped");
    expect(scopeSummary({ systemDefault: true })).toContain("systemDefault:true");
  });

  test("covers validation, lifecycle, candidate, payload, and JSON helper branches", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeSkillFixture(workspace);
      const ref = await fixture.skills.registerSkill(registerInput(fixture));
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);
      const record = await fixture.skills.getSkill(ref.value);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);
      const activation = await fixture.skills.activateSkill(ref.value, activationInput(fixture));
      expect(activation.ok).toBe(true);
      if (!activation.ok) throw new Error(activation.error.message);

      expect(validateRegisterInput(registerInput(fixture, { name: " " })).ok).toBe(false);
      expect(validateRegisterInput(registerInput(fixture, { description: " " })).ok).toBe(false);
      expect(validateRegisterInput(registerInput(fixture, { triggerSummary: " " })).ok).toBe(false);
      expect(validateRegisterInput(registerInput(fixture, { body: " " })).ok).toBe(false);
      expect(validateRegisterInput(registerInput(fixture, { body: new Uint8Array() })).ok).toBe(false);
      expect(initialLifecycle("grow_generated")).toBe("candidate");
      expect(initialLifecycle("upstream_proposed")).toBe("candidate");
      expect(initialLifecycle("workspace_local")).toBe("registered");

      expect(activationGuard({ ...record.value, lifecycle: "registered" }).ok).toBe(true);
      expect(activationGuard({ ...record.value, lifecycle: "retracted" }).ok).toBe(false);
      expect(activationGuard({ ...record.value, lifecycle: "incompatible" }).ok).toBe(false);
      expect(activationGuard({ ...record.value, lifecycle: "candidate" }).ok).toBe(false);
      expect(recordUsable({ ...record.value, lifecycle: "disabled" })).toBe(false);

      expect(matchesQuery(record.value, { text: "style" })).toBe(true);
      expect(matchesQuery(record.value, { family: "other" })).toBe(false);
      expect(matchesQuery(record.value, { lifecycle: "active" })).toBe(false);
      expect(matchesQuery(record.value, { sourceKind: "external_package" })).toBe(false);
      expect(matchesQuery({ ...record.value, lifecycle: "retracted" }, {})).toBe(false);
      expect(matchesQuery({ ...record.value, lifecycle: "retracted" }, { includeRetracted: true })).toBe(true);
      expect(changedFields(record.value, record.value)).toEqual([]);

      const expired = { ...activation.value, expiresAt: "2000-01-01T00:00:00.000Z" };
      const disabled = { ...activation.value, status: "disabled" as const };
      expect(activationIsActive(activation.value)).toBe(true);
      expect(activationIsActive(expired)).toBe(false);
      expect(activationIsActive(disabled)).toBe(false);
      expect(latestActivations([activation.value, { ...activation.value, createdAt: "2999-01-01T00:00:00.000Z" }])).toHaveLength(1);

      expect(candidateFor(record.value, activation.value, { text: "missing", scope: record.value.scope })).toBeUndefined();
      expect(candidateFor(record.value, activation.value, {
        text: "style",
        scope: record.value.scope,
        requiredCapabilities: ["network.request"]
      })).toBeUndefined();
      expect(candidateFor(record.value, activation.value, { text: "", scope: record.value.scope })).toBeDefined();

      expect(defaultPolicyContext().caller).toBe("skill-registry");
      expect(systemSource(fixture.workspace.id).origin).toBe("skill-registry");
      expect(parseJson("{bad", "bad json").ok).toBe(false);
      expect(toSkillEventPayload({ keep: true, skip: undefined, fn: () => "x", nested: [1] })).toEqual({ keep: true, nested: [1] });
      expect(toSkillEventPayload(Symbol("x"))).toBe("Symbol(x)");
    });
  });

  test("covers storage empty states, pagination, policy deny, and unmatched explanations", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeSkillFixture(workspace);
      const storage = new SkillRegistryStorage(fixture.store, fixture.workspace);
      const missing = await storage.readRecord({ kind: "skill", id: "skill-missing" as never });
      expect(missing.ok).toBe(false);
      const emptyRecords = await storage.readAllRecords();
      expect(emptyRecords.ok).toBe(true);
      if (emptyRecords.ok) expect(emptyRecords.value).toHaveLength(0);
      const emptyActivations = await storage.readAllActivations();
      expect(emptyActivations.ok).toBe(true);
      if (emptyActivations.ok) expect(emptyActivations.value).toHaveLength(0);

      const first = await fixture.skills.registerSkill(registerInput(fixture, { name: "a-skill", family: "family-a" }));
      const second = await fixture.skills.registerSkill(registerInput(fixture, { name: "b-skill", family: "family-b" }));
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) throw new Error("registration failed");
      const page1 = await fixture.skills.listSkills({ limit: 1 });
      expect(page1.ok).toBe(true);
      if (!page1.ok) throw new Error(page1.error.message);
      expect(page1.value.truncated).toBe(true);
      const page2 = await fixture.skills.listSkills({
        limit: 1,
        ...(page1.value.nextCursor === undefined ? {} : { cursor: page1.value.nextCursor })
      });
      expect(page2.ok).toBe(true);
      if (page2.ok) expect(page2.value.records).toHaveLength(1);
      expect((await storage.recordsForFamily("family-a")).ok).toBe(true);
      const foundVersion = await storage.findVersion(first.value, "1");
      expect(foundVersion.ok).toBe(true);
      const missingVersion = await storage.findVersion(first.value, "missing");
      expect(missingVersion.ok).toBe(false);
      await storage.addRecordToIndex(first.value);
      await storage.addRecordToIndex(first.value);

      const denied = await fixture.skills.activateSkill(first.value, activationInput(fixture, {
        policyContext: {
          ...allowSkillPolicyContext(),
          rules: [{ capability: "skill.activate", resource: "*", verdict: "deny" }]
        }
      }));
      expect(denied.ok).toBe(false);
      if (!denied.ok) expect(denied.error.code).toBe("policy_blocked");

      const activated = await fixture.skills.activateSkill(first.value, activationInput(fixture, {
        expiresAt: "2000-01-01T00:00:00.000Z"
      }));
      expect(activated.ok).toBe(true);
      if (!activated.ok) throw new Error(activated.error.message);
      await storage.addActivationToIndex(activated.value.activationId);
      await storage.addActivationToIndex(activated.value.activationId);
      const active = await fixture.skills.listActiveSkills({ workspace: fixture.workspace.id });
      expect(active.ok).toBe(true);
      if (active.ok) expect(active.value.skills).toHaveLength(0);

      const explanation = await fixture.skills.explainSkillCandidate(first.value, {
        text: "does not match",
        scope: { workspace: fixture.workspace.id }
      });
      expect(explanation.ok).toBe(true);
      if (explanation.ok) expect(explanation.value.matched).toBe(false);

      await fixture.store.writeTextAtomic(
        fixture.workspace,
        skillActivationIndexPath,
        JSON.stringify({ activationIds: [makeSkillActivationId("activation-missing")] }),
        { reason: "missing activation index", createParents: true }
      );
      const missingActivation = await storage.readAllActivations();
      expect(missingActivation.ok).toBe(true);
      if (missingActivation.ok) expect(missingActivation.value).toHaveLength(0);
      await fixture.store.writeTextAtomic(fixture.workspace, skillIndexPath, "{bad", {
        reason: "corrupt skill index",
        createParents: true
      });
      expect((await storage.readAllRecords()).ok).toBe(false);
      await fixture.store.writeTextAtomic(fixture.workspace, skillActivationIndexPath, "{bad", {
        reason: "corrupt activation index",
        createParents: true
      });
      expect((await storage.readAllActivations()).ok).toBe(false);
    });
  });

  test("reports ignored discovery roots instead of registering them", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeSkillFixture(workspace);
      await fixture.store.writeTextAtomic(fixture.workspace, "skills/readme.txt", "not a skill", {
        reason: "seed ignored",
        createParents: true
      });
      await fixture.store.writeTextAtomic(
        fixture.workspace,
        "skills/huge/SKILL.md",
        "---\nname: huge\ndescription: Huge skill.\n---\n" + "x".repeat(300_000),
        { reason: "seed huge", createParents: true }
      );
      const report = await fixture.skills.discoverSkills({ searchPaths: ["missing", "skills"] });
      expect(report.ok).toBe(true);
      if (report.ok) {
        expect(report.value.discovered).toHaveLength(0);
        expect(report.value.ignored).toContain("missing");
        expect(report.value.ignored).toContain("skills/huge/SKILL.md");
      }
    });
  });
});

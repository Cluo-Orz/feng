import { describe, expect, test } from "vitest";
import {
  makeArtifactId,
  makeGrowUnitId,
  makeHatchPackageId,
  makeMessageListId,
  makeRef,
  makeWorkspaceId
} from "../../src/domain/index.js";
import { growUnitRecordPath } from "../../src/grow-unit-manager/paths.js";
import { withWorkspace } from "../file-store/helpers.js";
import {
  allowArchivePolicy,
  createInput,
  makeGrowUnitFixture,
  reasonInput,
  validationReport
} from "./helpers.js";

describe("Grow Unit Manager edge cases", () => {
  test("reports empty workspace and invalid create input explicitly", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeGrowUnitFixture(workspace);
      const empty = await fixture.grow.openGrowUnit(fixture.workspace);
      expect(empty.ok).toBe(false);
      if (!empty.ok) expect(empty.error.code).toBe("not_found");

      const wrongWorkspace = { ...fixture.workspace, id: makeWorkspaceId("workspace-other") };
      const wrong = await fixture.grow.openGrowUnit(wrongWorkspace);
      expect(wrong.ok).toBe(false);
      if (!wrong.ok) expect(wrong.error.code).toBe("invalid_input");

      for (const input of [
        createInput(fixture, { title: "" }),
        createInput(fixture, { goalBoundarySummary: "" }),
        createInput(fixture, { targetBehaviorSummary: "" })
      ]) {
        const created = await fixture.grow.createGrowUnit(input);
        expect(created.ok).toBe(false);
        if (!created.ok) expect(created.error.code).toBe("invalid_input");
      }
    });
  });

  test("covers additional lifecycle guards and explanation branches", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeGrowUnitFixture(workspace);
      const ref = await fixture.grow.createGrowUnit(createInput(fixture));
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);

      const fromMismatch = await fixture.grow.transitionGrowUnit(ref.value, {
        ...reasonInput(fixture, "wrong from"),
        from: "growing",
        to: "planning"
      });
      expect(fromMismatch.ok).toBe(false);
      if (!fromMismatch.ok) expect(fromMismatch.error.code).toBe("transition_conflict");

      const unblock = await fixture.grow.unblockGrowUnit(ref.value, reasonInput(fixture, "unblock non blocked"));
      expect(unblock.ok).toBe(false);
      if (!unblock.ok) expect(unblock.error.code).toBe("invalid_state");

      const blocked = await fixture.grow.blockGrowUnit(ref.value, reasonInput(fixture, "block"));
      expect(blocked.ok).toBe(true);
      const blockAgain = await fixture.grow.blockGrowUnit(ref.value, reasonInput(fixture, "block again"));
      expect(blockAgain.ok).toBe(false);
      if (!blockAgain.ok) expect(blockAgain.error.code).toBe("lifecycle_conflict");

      const noSkillSnapshot = await fixture.grow.buildGrowUnitSnapshot(ref.value, {
        reason: "skip skills",
        includeActiveSkills: false
      });
      expect(noSkillSnapshot.ok).toBe(true);
      if (noSkillSnapshot.ok) expect(noSkillSnapshot.value.activeSkillSummaries).toHaveLength(0);

      const explanation = await fixture.grow.explainGrowUnitState(ref.value);
      expect(explanation.ok).toBe(true);
      if (explanation.ok) expect(explanation.value.facts.join("\n")).toContain("ready_to_hatch evidence absent");
    });
  });

  test("links target world, updates goal boundary, supersedes, and restores those events", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeGrowUnitFixture(workspace);
      const targetRef = makeRef("artifact", makeArtifactId("artifact-target-world"));
      const replacement = await fixture.grow.createGrowUnit(createInput(fixture, { title: "replacement-grow" }));
      const ref = await fixture.grow.createGrowUnit(createInput(fixture));
      expect(replacement.ok).toBe(true);
      expect(ref.ok).toBe(true);
      if (!replacement.ok || !ref.ok) throw new Error("create failed");

      const target = await fixture.grow.linkTargetWorld(ref.value, {
        ...reasonInput(fixture, "link target world"),
        targetWorldSummaryRef: targetRef,
        targetBehaviorSummary: "Consume frame state and emit move/attack intents."
      });
      expect(target.ok).toBe(true);

      const updated = await fixture.grow.updateGoalBoundary(ref.value, {
        ...reasonInput(fixture, "update goal"),
        goalBoundarySummary: "Updated boss behavior boundary."
      });
      expect(updated.ok).toBe(true);

      const superseded = await fixture.grow.supersedeGrowUnit(ref.value, {
        ...reasonInput(fixture, "supersede"),
        supersededBy: replacement.value,
        replacementReason: "merge correction"
      });
      expect(superseded.ok).toBe(true);

      await fixture.store.removeFile(fixture.workspace, growUnitRecordPath(ref.value.id), { reason: "force restore" });
      const restored = await fixture.grow.getGrowUnit(ref.value);
      expect(restored.ok).toBe(true);
      if (restored.ok) {
        expect(restored.value.targetWorldSummaryRef?.id).toBe(targetRef.id);
        expect(restored.value.goalBoundarySummary).toContain("Updated");
      }
    });
  });

  test("maps non-ready readiness verdicts and handles missing verdict artifacts", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeGrowUnitFixture(workspace);
      const ref = await fixture.grow.createGrowUnit(createInput(fixture));
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);
      await fixture.grow.transitionGrowUnit(ref.value, { ...reasonInput(fixture), to: "planning" });
      await fixture.grow.transitionGrowUnit(ref.value, { ...reasonInput(fixture), to: "growing" });

      const missing = await fixture.grow.applyReadinessVerdict(ref.value, {
        ...reasonInput(fixture, "missing verdict"),
        readinessVerdictRef: makeRef("artifact", makeArtifactId("artifact-missing")),
        verdict: { verdict: "waiting_input", reason: "missing", evidenceRefs: [] }
      });
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.error.code).toBe("artifact_unavailable");

      const report = await validationReport(fixture);
      expect(report.ok).toBe(true);
      if (!report.ok) throw new Error(report.error.message);
      const waiting = await fixture.grow.applyReadinessVerdict(ref.value, {
        ...reasonInput(fixture, "waiting input"),
        readinessVerdictRef: report.value,
        verdict: { verdict: "waiting_input", reason: "need material", evidenceRefs: [report.value] }
      });
      expect(waiting.ok).toBe(true);
      if (waiting.ok) expect(waiting.value.to).toBe("waiting_input");

      const backToGrowing = await fixture.grow.transitionGrowUnit(ref.value, {
        ...reasonInput(fixture, "resume grow"),
        to: "growing"
      });
      expect(backToGrowing.ok).toBe(true);
      const sameLifecycle = await fixture.grow.applyReadinessVerdict(ref.value, {
        ...reasonInput(fixture, "continue grow"),
        readinessVerdictRef: report.value,
        verdict: { verdict: "continue_grow", reason: "keep going", evidenceRefs: [report.value] }
      });
      expect(sameLifecycle.ok).toBe(true);
      if (sameLifecycle.ok) expect(sameLifecycle.value.from).toBe("growing");

      const blocked = await fixture.grow.applyReadinessVerdict(ref.value, {
        ...reasonInput(fixture, "readiness blocked"),
        readinessVerdictRef: report.value,
        verdict: { verdict: "blocked", reason: "cannot validate", evidenceRefs: [report.value] }
      });
      expect(blocked.ok).toBe(true);
      if (blocked.ok) expect(blocked.value.to).toBe("blocked");
      const explanation = await fixture.grow.explainGrowUnitState(ref.value);
      expect(explanation.ok).toBe(true);
      if (explanation.ok) expect(explanation.value.facts.join("\n")).toContain("readiness verdict linked");
    });
  });

  test("lists, filters, paginates, and excludes archived grow units by default", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeGrowUnitFixture(workspace);
      const alpha = await fixture.grow.createGrowUnit(createInput(fixture, { title: "alpha boss" }));
      const beta = await fixture.grow.createGrowUnit(createInput(fixture, { title: "beta novel" }));
      expect(alpha.ok).toBe(true);
      expect(beta.ok).toBe(true);
      if (!alpha.ok || !beta.ok) throw new Error("create failed");

      const page1 = await fixture.grow.listGrowUnits({ limit: 1 });
      expect(page1.ok).toBe(true);
      if (page1.ok) {
        expect(page1.value.records).toHaveLength(1);
        expect(page1.value.truncated).toBe(true);
        expect(page1.value.nextCursor).toBeDefined();
      }

      const filtered = await fixture.grow.listGrowUnits({ text: "novel" });
      expect(filtered.ok).toBe(true);
      if (filtered.ok) expect(filtered.value.records[0]?.title).toBe("beta novel");

      const archived = await fixture.grow.archiveGrowUnit(beta.value, {
        ...reasonInput(fixture, "archive beta"),
        policyContext: allowArchivePolicy()
      });
      expect(archived.ok).toBe(true);
      const defaultList = await fixture.grow.listGrowUnits();
      expect(defaultList.ok).toBe(true);
      if (defaultList.ok) expect(defaultList.value.records.some((item) => item.growUnitId === beta.value.id)).toBe(false);

      const archivedList = await fixture.grow.listGrowUnits({ includeArchived: true, lifecycle: "archived" });
      expect(archivedList.ok).toBe(true);
      if (archivedList.ok) expect(archivedList.value.records[0]?.growUnitId).toBe(beta.value.id);
    });
  });

  test("surfaces missing grow unit stream during recovery", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeGrowUnitFixture(workspace);
      const missingRef = makeRef("grow_unit", makeGrowUnitId("grow-missing"));
      const missing = await fixture.grow.getGrowUnit(missingRef);
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.error.code).toBe("not_found");
    });
  });

  test("rejects invalid coordination shortcuts and direct hatch without package", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeGrowUnitFixture(workspace);
      const ref = await fixture.grow.createGrowUnit(createInput(fixture));
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);

      const emptyGoal = await fixture.grow.updateGoalBoundary(ref.value, {
        ...reasonInput(fixture, "empty goal"),
        goalBoundarySummary: ""
      });
      expect(emptyGoal.ok).toBe(false);
      if (!emptyGoal.ok) expect(emptyGoal.error.code).toBe("invalid_input");

      const wrongCompiler = await fixture.grow.linkMessageList(ref.value, {
        ...reasonInput(fixture, "wrong compiler"),
        compiledBy: "manual" as never,
        messageList: {
          messageListRef: makeRef("message_list", makeMessageListId("message-list-bad")),
          sourceRefs: [],
          excludedRefs: [],
          budgetSummary: "bad"
        }
      });
      expect(wrongCompiler.ok).toBe(false);
      if (!wrongCompiler.ok) expect(wrongCompiler.error.code).toBe("invalid_input");

      const hatchEarly = await fixture.grow.linkHatchPackage(ref.value, {
        ...reasonInput(fixture, "hatch early"),
        hatchPackageRef: makeRef("hatch_package", makeHatchPackageId("hatch-early"))
      });
      expect(hatchEarly.ok).toBe(false);
      if (!hatchEarly.ok) expect(hatchEarly.error.code).toBe("readiness_failed");

      await fixture.grow.transitionGrowUnit(ref.value, { ...reasonInput(fixture), to: "planning" });
      await fixture.grow.transitionGrowUnit(ref.value, { ...reasonInput(fixture), to: "growing" });
      const report = await validationReport(fixture);
      expect(report.ok).toBe(true);
      if (!report.ok) throw new Error(report.error.message);
      await fixture.grow.applyReadinessVerdict(ref.value, {
        ...reasonInput(fixture, "ready"),
        readinessVerdictRef: report.value,
        verdict: { verdict: "ready_to_hatch", reason: "ready", evidenceRefs: [report.value] }
      });

      const directHatched = await fixture.grow.transitionGrowUnit(ref.value, {
        ...reasonInput(fixture, "direct hatched"),
        to: "hatched"
      });
      expect(directHatched.ok).toBe(false);
      if (!directHatched.ok) expect(directHatched.error.code).toBe("invalid_state");
    });
  });

  test("records policy deny and restores unblock/archive lifecycle projection", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeGrowUnitFixture(workspace);
      const ref = await fixture.grow.createGrowUnit(createInput(fixture));
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);

      const denied = await fixture.grow.archiveGrowUnit(ref.value, {
        ...reasonInput(fixture, "deny archive"),
        policyContext: {
          caller: "grow-unit-manager",
          environment: {
            hostSandboxAvailable: false,
            networkAvailable: false,
            externalEnforcementAvailable: false,
            secretStoreAvailable: false
          },
          rules: [{ capability: "file.delete", resource: "grow-unit:*", verdict: "deny" }]
        }
      });
      expect(denied.ok).toBe(false);
      if (!denied.ok) expect(denied.error.code).toBe("policy_blocked");

      await fixture.grow.blockGrowUnit(ref.value, reasonInput(fixture, "block"));
      await fixture.grow.unblockGrowUnit(ref.value, { ...reasonInput(fixture, "unblock"), to: "waiting_input" });
      await fixture.store.removeFile(fixture.workspace, growUnitRecordPath(ref.value.id), { reason: "restore unblocked" });
      const unblocked = await fixture.grow.getGrowUnit(ref.value);
      expect(unblocked.ok).toBe(true);
      if (unblocked.ok) expect(unblocked.value.lifecycle).toBe("waiting_input");

      const archived = await fixture.grow.archiveGrowUnit(ref.value, {
        ...reasonInput(fixture, "archive"),
        policyContext: allowArchivePolicy()
      });
      expect(archived.ok).toBe(true);
      await fixture.store.removeFile(fixture.workspace, growUnitRecordPath(ref.value.id), { reason: "restore archived" });
      const restoredArchive = await fixture.grow.getGrowUnit(ref.value);
      expect(restoredArchive.ok).toBe(true);
      if (restoredArchive.ok) expect(restoredArchive.value.lifecycle).toBe("archived");
    });
  });
});

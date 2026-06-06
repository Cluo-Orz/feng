import { describe, expect, test } from "vitest";
import { makeRef, makeArtifactId } from "../../src/domain/index.js";
import { growUnitEventTypes, growUnitStream } from "../../src/grow-unit-manager/index.js";
import { growUnitRecordPath } from "../../src/grow-unit-manager/paths.js";
import { withWorkspace } from "../file-store/helpers.js";
import {
  activeWorkspaceSkill,
  allowArchivePolicy,
  attemptRef,
  createInput,
  hatchPackageRef,
  makeGrowUnitFixture,
  messageListRef,
  reasonInput,
  validationReport
} from "./helpers.js";

describe("Grow Unit Manager", () => {
  test("creates a grow unit as a stream-backed projection and opens without sessions", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeGrowUnitFixture(workspace);
      const created = await fixture.grow.createGrowUnit(createInput(fixture));
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error(created.error.message);

      const record = await fixture.grow.getGrowUnit(created.value);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);
      expect(record.value.lifecycle).toBe("created");
      expect(record.value.goalBoundarySummary).toContain("boss decision");

      const replay = await fixture.ledger.replayStream(growUnitStream(created.value), { reason: "replay create" });
      expect(replay.ok).toBe(true);
      if (replay.ok) expect(replay.value.events[0]?.eventType).toBe(growUnitEventTypes.created);

      const opened = await fixture.grow.openGrowUnit(fixture.workspace);
      expect(opened.ok).toBe(true);
      if (opened.ok) {
        expect(opened.value.record.growUnitId).toBe(created.value.id);
        expect(JSON.stringify(opened.value)).not.toMatch(/session/i);
      }
    });
  });

  test("validates lifecycle transitions and explicit projection versions", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeGrowUnitFixture(workspace);
      const ref = await fixture.grow.createGrowUnit(createInput(fixture));
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);

      const invalid = await fixture.grow.transitionGrowUnit(ref.value, { ...reasonInput(fixture), to: "growing" });
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) expect(invalid.error.code).toBe("transition_conflict");

      const planning = await fixture.grow.transitionGrowUnit(ref.value, {
        ...reasonInput(fixture, "start planning"),
        to: "planning",
        expectedRecordVersion: 1
      });
      expect(planning.ok).toBe(true);
      if (planning.ok) expect(planning.value.recordVersion).toBe(2);

      const stale = await fixture.grow.transitionGrowUnit(ref.value, {
        ...reasonInput(fixture, "stale transition"),
        to: "growing",
        expectedRecordVersion: 1
      });
      expect(stale.ok).toBe(false);
      if (!stale.ok) expect(stale.error.code).toBe("projection_stale");
    });
  });

  test("coordinates refs without compiling messages or treating attempts as sessions", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeGrowUnitFixture(workspace);
      const ref = await fixture.grow.createGrowUnit(createInput(fixture));
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);

      const admissionRef = makeRef("artifact", makeArtifactId("artifact-admission"));
      const agendaRef = makeRef("artifact", makeArtifactId("artifact-agenda"));
      const admission = await fixture.grow.linkAdmissionState(ref.value, {
        ...reasonInput(fixture, "link admission"),
        admission: { admissionInboxRef: admissionRef, statusSummary: "two candidates waiting" }
      });
      expect(admission.ok).toBe(true);

      const agenda = await fixture.grow.linkAgendaState(ref.value, {
        ...reasonInput(fixture, "link agenda"),
        agenda: { agendaRef, statusSummary: "DoD draft ready", openGapCount: 1 },
        recommendedLifecycle: "planning"
      });
      expect(agenda.ok).toBe(true);

      const attempt = await fixture.grow.linkAttempt(ref.value, {
        ...reasonInput(fixture, "link attempt"),
        attempt: { attemptRef: attemptRef(), statusSummary: "attempt running" }
      });
      expect(attempt.ok).toBe(true);

      const message = await fixture.grow.linkMessageList(ref.value, {
        ...reasonInput(fixture, "link message list"),
        compiledBy: "context-message-compiler",
        messageList: {
          messageListRef: messageListRef(),
          sourceRefs: [],
          excludedRefs: [],
          budgetSummary: "bounded test context"
        }
      });
      expect(message.ok).toBe(true);

      const snapshot = await fixture.grow.buildGrowUnitSnapshot(ref.value, { reason: "snapshot" });
      expect(snapshot.ok).toBe(true);
      if (snapshot.ok) {
        expect(snapshot.value.record.latestMessageListRef?.kind).toBe("message_list");
        expect(JSON.stringify(snapshot.value)).not.toMatch(/prompt|history/i);
      }
    });
  });

  test("allows ready_to_hatch only through a readiness verdict and then links hatch package", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeGrowUnitFixture(workspace);
      const ref = await fixture.grow.createGrowUnit(createInput(fixture));
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);
      await fixture.grow.transitionGrowUnit(ref.value, { ...reasonInput(fixture), to: "planning" });
      await fixture.grow.transitionGrowUnit(ref.value, { ...reasonInput(fixture), to: "growing" });

      const directReady = await fixture.grow.transitionGrowUnit(ref.value, {
        ...reasonInput(fixture, "direct ready"),
        to: "ready_to_hatch"
      });
      expect(directReady.ok).toBe(false);
      if (!directReady.ok) expect(directReady.error.code).toBe("readiness_failed");

      const report = await validationReport(fixture);
      expect(report.ok).toBe(true);
      if (!report.ok) throw new Error(report.error.message);
      const ready = await fixture.grow.applyReadinessVerdict(ref.value, {
        ...reasonInput(fixture, "apply readiness"),
        readinessVerdictRef: report.value,
        verdict: { verdict: "ready_to_hatch", reason: "all DoD evidence passed", evidenceRefs: [report.value] },
        validationReportRef: report.value
      });
      expect(ready.ok).toBe(true);
      if (ready.ok) expect(ready.value.to).toBe("ready_to_hatch");

      const hatch = await fixture.grow.linkHatchPackage(ref.value, {
        ...reasonInput(fixture, "link hatch"),
        hatchPackageRef: hatchPackageRef()
      });
      expect(hatch.ok).toBe(true);
      if (hatch.ok) expect(hatch.value.to).toBe("hatched");
    });
  });

  test("blocks attempts while blocked and blocks all mutation after archive", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeGrowUnitFixture(workspace);
      const ref = await fixture.grow.createGrowUnit(createInput(fixture));
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);

      const blocked = await fixture.grow.blockGrowUnit(ref.value, reasonInput(fixture, "missing target world"));
      expect(blocked.ok).toBe(true);
      const blockedAttempt = await fixture.grow.linkAttempt(ref.value, {
        ...reasonInput(fixture, "blocked attempt"),
        attempt: { attemptRef: attemptRef(), statusSummary: "should not run" }
      });
      expect(blockedAttempt.ok).toBe(false);
      if (!blockedAttempt.ok) expect(blockedAttempt.error.code).toBe("grow_unit_blocked");

      const unblocked = await fixture.grow.unblockGrowUnit(ref.value, { ...reasonInput(fixture, "unblock"), to: "planning" });
      expect(unblocked.ok).toBe(true);
      const archiveAsk = await fixture.grow.archiveGrowUnit(ref.value, reasonInput(fixture, "archive without approval"));
      expect(archiveAsk.ok).toBe(false);
      if (!archiveAsk.ok) expect(archiveAsk.error.code).toBe("approval_required");

      const archived = await fixture.grow.archiveGrowUnit(ref.value, {
        ...reasonInput(fixture, "archive with policy"),
        policyContext: allowArchivePolicy()
      });
      expect(archived.ok).toBe(true);
      const afterArchive = await fixture.grow.updateGoalBoundary(ref.value, {
        ...reasonInput(fixture, "mutate archived"),
        goalBoundarySummary: "new boundary"
      });
      expect(afterArchive.ok).toBe(false);
      if (!afterArchive.ok) expect(afterArchive.error.code).toBe("grow_unit_archived");
    });
  });

  test("recovers record snapshots from the grow_unit event stream", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeGrowUnitFixture(workspace);
      const ref = await fixture.grow.createGrowUnit(createInput(fixture));
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);
      await fixture.grow.transitionGrowUnit(ref.value, { ...reasonInput(fixture, "plan"), to: "planning" });

      const removed = await fixture.store.removeFile(fixture.workspace, growUnitRecordPath(ref.value.id), {
        reason: "remove projection snapshot"
      });
      expect(removed.ok).toBe(true);
      const rebuilt = await fixture.grow.getGrowUnit(ref.value);
      expect(rebuilt.ok).toBe(true);
      if (rebuilt.ok) {
        expect(rebuilt.value.lifecycle).toBe("planning");
        expect(rebuilt.value.recordVersion).toBe(2);
      }
    });
  });

  test("summarizes active skills without loading skill bodies", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeGrowUnitFixture(workspace);
      const skill = await activeWorkspaceSkill(fixture);
      expect(skill.ok).toBe(true);
      const ref = await fixture.grow.createGrowUnit(createInput(fixture));
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);

      const snapshot = await fixture.grow.buildGrowUnitSnapshot(ref.value, { reason: "skill summary" });
      expect(snapshot.ok).toBe(true);
      if (snapshot.ok) {
        expect(snapshot.value.activeSkillSummaries).toHaveLength(1);
        expect(JSON.stringify(snapshot.value)).not.toContain("Do not inline body");
      }
    });
  });

});

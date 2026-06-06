import { describe, expect, test } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import { audit, createGrowAndAgenda, source, version } from "../agenda-dod-manager/helpers.js";
import {
  AttemptStorage,
  attemptRecordPath,
  makeAttemptCheckpointId,
  makeAttemptTurnId,
  makeCandidateOutputId
} from "../../src/grow-attempt-runner/index.js";
import {
  attemptCheckpointRef,
  attemptTurnRef,
  candidateOutputRef
} from "../../src/grow-attempt-runner/refs.js";
import { makeAttemptFixture } from "./helpers.js";

describe("Grow Attempt Runner storage edge paths", () => {
  test("returns explicit errors for missing optional records and skips missing indexed attempts", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace);
      const grow = await createGrowAndAgenda(fixture);
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);
      const intent = await fixture.agenda.buildAttemptIntent(grow.value, {
        source: source(fixture, "system"),
        audit: audit("build intent")
      });
      expect(intent.ok).toBe(true);
      if (!intent.ok) throw new Error(intent.error.message);
      const attempt = await fixture.runner.createAttempt({
        growUnitRef: grow.value,
        attemptIntentRef: intent.value,
        modelSelection: { provider: "fake", model: "fake-model" },
        source: source(fixture, "system"),
        version,
        audit: audit("create attempt")
      });
      expect(attempt.ok).toBe(true);
      if (!attempt.ok) throw new Error(attempt.error.message);

      const storage = new AttemptStorage(fixture.store, fixture.workspace);
      const record = await storage.readAttempt(attempt.value);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);
      expect((await storage.readSnapshot(record.value)).ok).toBe(false);
      expect((await storage.readPlan(record.value)).ok).toBe(false);
      expect((await storage.readOutcome(record.value)).ok).toBe(false);

      const missingTurn = await storage.readTurn(record.value, attemptTurnRef(makeAttemptTurnId("missing-turn")));
      const missingCandidate = await storage.readCandidate(
        record.value,
        candidateOutputRef(makeCandidateOutputId("missing-candidate"))
      );
      const missingCheckpoint = await storage.readCheckpoint(
        record.value,
        attemptCheckpointRef(makeAttemptCheckpointId("missing-checkpoint"))
      );
      expect(missingTurn.ok).toBe(false);
      expect(missingCandidate.ok).toBe(false);
      expect(missingCheckpoint.ok).toBe(false);

      const removed = await fixture.store.removeFile(fixture.workspace, attemptRecordPath(record.value.attemptId), {
        reason: "remove indexed attempt record"
      });
      expect(removed.ok).toBe(true);
      const all = await storage.readAllAttempts();
      expect(all.ok).toBe(true);
      if (all.ok) expect(all.value).toHaveLength(0);
    });
  });
});

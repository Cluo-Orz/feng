import type {
  AttemptCheckpointId,
  AttemptExecutionPlanId,
  AttemptInputSnapshotId,
  AttemptOutcomeSummaryId,
  AttemptTurnId,
  CandidateOutputId
} from "./types.js";
import type { AttemptId } from "../domain/index.js";

const root = ".feng/attempts";

export const attemptIndexPath = `${root}/index.json`;
export const attemptDir = (attemptId: AttemptId) => `${root}/${attemptId}`;
export const attemptRecordPath = (attemptId: AttemptId) => `${attemptDir(attemptId)}/record.json`;
export const attemptSnapshotPath = (attemptId: AttemptId, id: AttemptInputSnapshotId) =>
  `${attemptDir(attemptId)}/snapshots/${id}.json`;
export const attemptPlanPath = (attemptId: AttemptId, id: AttemptExecutionPlanId) =>
  `${attemptDir(attemptId)}/plans/${id}.json`;
export const attemptTurnPath = (attemptId: AttemptId, id: AttemptTurnId) =>
  `${attemptDir(attemptId)}/turns/${id}.json`;
export const attemptCandidatePath = (attemptId: AttemptId, id: CandidateOutputId) =>
  `${attemptDir(attemptId)}/candidates/${id}.json`;
export const attemptCheckpointPath = (attemptId: AttemptId, id: AttemptCheckpointId) =>
  `${attemptDir(attemptId)}/checkpoints/${id}.json`;
export const attemptOutcomePath = (attemptId: AttemptId, id: AttemptOutcomeSummaryId) =>
  `${attemptDir(attemptId)}/outcomes/${id}.json`;

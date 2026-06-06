import type {
  AttemptCheckpointId,
  AttemptCheckpointRef,
  AttemptExecutionPlanId,
  AttemptExecutionPlanRef,
  AttemptInputSnapshotId,
  AttemptInputSnapshotRef,
  AttemptOutcomeSummaryId,
  AttemptOutcomeSummaryRef,
  AttemptTurnId,
  AttemptTurnRef,
  CandidateOutputId,
  CandidateOutputRef
} from "./types.js";

export const attemptInputSnapshotRef = (id: AttemptInputSnapshotId): AttemptInputSnapshotRef => ({
  kind: "attempt_input_snapshot",
  id,
  uri: `attempt-input-snapshot://${id}`
});

export const attemptExecutionPlanRef = (id: AttemptExecutionPlanId): AttemptExecutionPlanRef => ({
  kind: "attempt_execution_plan",
  id,
  uri: `attempt-execution-plan://${id}`
});

export const attemptTurnRef = (id: AttemptTurnId): AttemptTurnRef => ({
  kind: "attempt_turn",
  id,
  uri: `attempt-turn://${id}`
});

export const candidateOutputRef = (id: CandidateOutputId): CandidateOutputRef => ({
  kind: "candidate_output",
  id,
  uri: `candidate-output://${id}`
});

export const attemptCheckpointRef = (id: AttemptCheckpointId): AttemptCheckpointRef => ({
  kind: "attempt_checkpoint",
  id,
  uri: `attempt-checkpoint://${id}`
});

export const attemptOutcomeSummaryRef = (id: AttemptOutcomeSummaryId): AttemptOutcomeSummaryRef => ({
  kind: "attempt_outcome_summary",
  id,
  uri: `attempt-outcome-summary://${id}`
});

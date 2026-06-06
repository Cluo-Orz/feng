import { makeNonEmptyBrand } from "../domain/brand.js";
import type {
  AttemptCheckpointId,
  AttemptExecutionPlanId,
  AttemptInputSnapshotId,
  AttemptOutcomeSummaryId,
  AttemptTraceId,
  AttemptTurnId,
  CandidateOutputId
} from "./types.js";

export const makeAttemptInputSnapshotId = (value: string): AttemptInputSnapshotId =>
  makeNonEmptyBrand("AttemptInputSnapshotId", value);

export const makeAttemptExecutionPlanId = (value: string): AttemptExecutionPlanId =>
  makeNonEmptyBrand("AttemptExecutionPlanId", value);

export const makeAttemptTurnId = (value: string): AttemptTurnId =>
  makeNonEmptyBrand("AttemptTurnId", value);

export const makeCandidateOutputId = (value: string): CandidateOutputId =>
  makeNonEmptyBrand("CandidateOutputId", value);

export const makeAttemptCheckpointId = (value: string): AttemptCheckpointId =>
  makeNonEmptyBrand("AttemptCheckpointId", value);

export const makeAttemptTraceId = (value: string): AttemptTraceId =>
  makeNonEmptyBrand("AttemptTraceId", value);

export const makeAttemptOutcomeSummaryId = (value: string): AttemptOutcomeSummaryId =>
  makeNonEmptyBrand("AttemptOutcomeSummaryId", value);

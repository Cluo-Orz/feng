import { makeNonEmptyBrand, type BrandedString } from "./brand.js";

export type WorkspaceId = BrandedString<"WorkspaceId">;
export type GrowUnitId = BrandedString<"GrowUnitId">;
export type AttemptId = BrandedString<"AttemptId">;
export type EventId = BrandedString<"EventId">;
export type ArtifactId = BrandedString<"ArtifactId">;
export type MessageListId = BrandedString<"MessageListId">;
export type FeedbackUnitId = BrandedString<"FeedbackUnitId">;
export type HatchPackageId = BrandedString<"HatchPackageId">;
export type RuntimeContractId = BrandedString<"RuntimeContractId">;
export type SkillId = BrandedString<"SkillId">;
export type ToolId = BrandedString<"ToolId">;
export type PolicyDecisionId = BrandedString<"PolicyDecisionId">;
export type TargetWorldId = BrandedString<"TargetWorldId">;

export type EntityId =
  | WorkspaceId
  | GrowUnitId
  | AttemptId
  | EventId
  | ArtifactId
  | MessageListId
  | FeedbackUnitId
  | HatchPackageId
  | RuntimeContractId
  | SkillId
  | ToolId
  | PolicyDecisionId
  | TargetWorldId;

export const makeWorkspaceId = (value: string): WorkspaceId => makeNonEmptyBrand("WorkspaceId", value);
export const makeGrowUnitId = (value: string): GrowUnitId => makeNonEmptyBrand("GrowUnitId", value);
export const makeAttemptId = (value: string): AttemptId => makeNonEmptyBrand("AttemptId", value);
export const makeEventId = (value: string): EventId => makeNonEmptyBrand("EventId", value);
export const makeArtifactId = (value: string): ArtifactId => makeNonEmptyBrand("ArtifactId", value);
export const makeMessageListId = (value: string): MessageListId => makeNonEmptyBrand("MessageListId", value);
export const makeFeedbackUnitId = (value: string): FeedbackUnitId =>
  makeNonEmptyBrand("FeedbackUnitId", value);
export const makeHatchPackageId = (value: string): HatchPackageId =>
  makeNonEmptyBrand("HatchPackageId", value);
export const makeRuntimeContractId = (value: string): RuntimeContractId =>
  makeNonEmptyBrand("RuntimeContractId", value);
export const makeSkillId = (value: string): SkillId => makeNonEmptyBrand("SkillId", value);
export const makeToolId = (value: string): ToolId => makeNonEmptyBrand("ToolId", value);
export const makePolicyDecisionId = (value: string): PolicyDecisionId =>
  makeNonEmptyBrand("PolicyDecisionId", value);
export const makeTargetWorldId = (value: string): TargetWorldId =>
  makeNonEmptyBrand("TargetWorldId", value);


import type {
  ArtifactId,
  AttemptId,
  FeedbackUnitId,
  GrowUnitId,
  HatchPackageId,
  MessageListId,
  RuntimeContractId,
  SkillId,
  ToolId
} from "./ids.js";

export const refKinds = [
  "artifact",
  "message_list",
  "grow_unit",
  "attempt",
  "feedback_unit",
  "hatch_package",
  "runtime_contract",
  "skill",
  "tool",
  "tool_result",
  "trace",
  "validation_report"
] as const;

export type RefKind = (typeof refKinds)[number];

export interface BaseRef<Kind extends RefKind, Id extends string = string> {
  readonly kind: Kind;
  readonly id: Id;
  readonly uri?: string;
  readonly version?: string;
}

export type ArtifactRef = BaseRef<"artifact", ArtifactId>;
export type MessageListRef = BaseRef<"message_list", MessageListId>;
export type GrowUnitRef = BaseRef<"grow_unit", GrowUnitId>;
export type AttemptRef = BaseRef<"attempt", AttemptId>;
export type FeedbackUnitRef = BaseRef<"feedback_unit", FeedbackUnitId>;
export type HatchPackageRef = BaseRef<"hatch_package", HatchPackageId>;
export type RuntimeContractRef = BaseRef<"runtime_contract", RuntimeContractId>;
export type SkillRef = BaseRef<"skill", SkillId>;
export type ToolRef = BaseRef<"tool", ToolId>;
export type ToolResultRef = BaseRef<"tool_result", ArtifactId>;
export type TraceRef = BaseRef<"trace", ArtifactId>;
export type ValidationReportRef = BaseRef<"validation_report", ArtifactId>;

export type DomainRef =
  | ArtifactRef
  | MessageListRef
  | GrowUnitRef
  | AttemptRef
  | FeedbackUnitRef
  | HatchPackageRef
  | RuntimeContractRef
  | SkillRef
  | ToolRef
  | ToolResultRef
  | TraceRef
  | ValidationReportRef;

export type RefOptions = {
  readonly uri?: string;
  readonly version?: string;
};

export function makeRef<Kind extends RefKind, Id extends string>(
  kind: Kind,
  id: Id,
  options: RefOptions = {}
): BaseRef<Kind, Id> {
  return {
    kind,
    id,
    ...(options.uri === undefined ? {} : { uri: options.uri }),
    ...(options.version === undefined ? {} : { version: options.version })
  };
}

import type {
  ArtifactRef,
  AuditDescriptor,
  HatchPackageRef,
  MessageListRef,
  PolicyDecisionId,
  RuntimeContractRef,
  SourceDescriptor,
  VersionDescriptor
} from "../domain/index.js";
import type { ProviderNeutralMessage } from "../context-message-compiler/index.js";
import type { RuntimeInvocationRef, RuntimeTurnRef } from "./refs.js";

export type RuntimeMessageSectionKind =
  | "runtime_contract" | "target_world_input" | "current_observation" | "runtime_task"
  | "allowed_actions" | "forbidden_actions" | "short_term_context" | "long_term_memory_summary"
  | "visible_tools" | "debug_policy" | "output_contract" | "failure_policy";

export interface RuntimeMessageSection {
  readonly sectionId: string;
  readonly kind: RuntimeMessageSectionKind;
  readonly title: string;
  readonly content: string;
  readonly priority: number;
  readonly sourceMapEntryIds: readonly string[];
  readonly estimatedTokens: number;
  readonly truncated: boolean;
  readonly redacted: boolean;
}

export interface RuntimeSourceMapEntry {
  readonly entryId: string;
  readonly messagePath: string;
  readonly section: RuntimeMessageSectionKind;
  readonly sourceType: string;
  readonly sourceRef?: unknown;
  readonly inclusionReason: string;
  readonly transformation: string;
  readonly redacted: boolean;
  readonly truncated: boolean;
  readonly policyDecisionId?: PolicyDecisionId;
  readonly contentHash?: string;
}

export interface RuntimeSourceMap {
  readonly messageListRef: MessageListRef;
  readonly entries: readonly RuntimeSourceMapEntry[];
  readonly builtAt: string;
}

export interface RuntimeExclusionRecord {
  readonly sourceType: string;
  readonly sourceRef?: unknown;
  readonly reason: string;
  readonly summary: string;
  readonly section?: RuntimeMessageSectionKind;
  readonly policyDecisionId?: PolicyDecisionId;
}

export interface RuntimeExclusionList {
  readonly messageListRef: MessageListRef;
  readonly records: readonly RuntimeExclusionRecord[];
  readonly builtAt: string;
}

export interface RuntimeBudgetReport {
  readonly messageListRef: MessageListRef;
  readonly budgetModel: "rough_char_tokens";
  readonly totalBudget: number;
  readonly estimatedUsage: number;
  readonly sectionBudgets: readonly {
    readonly section: RuntimeMessageSectionKind;
    readonly budget: number;
    readonly estimatedUsage: number;
  }[];
  readonly overBudget: boolean;
  readonly compressionApplied: boolean;
  readonly truncationApplied: boolean;
  readonly unavailableSources: readonly string[];
  readonly builtAt: string;
}

export interface RuntimeMessageListRecord {
  readonly runtimeMessageListId: MessageListRef["id"];
  readonly runtimeMessageListRef: MessageListRef;
  readonly runtimeInvocationRef: RuntimeInvocationRef;
  readonly runtimeContractRef: RuntimeContractRef;
  readonly hatchPackageRef: HatchPackageRef;
  readonly turnRef: RuntimeTurnRef;
  readonly artifactRef: ArtifactRef;
  readonly providerNeutralMessages: readonly ProviderNeutralMessage[];
  readonly sections: readonly RuntimeMessageSection[];
  readonly sourceMapRef: ArtifactRef;
  readonly budgetReportRef: ArtifactRef;
  readonly exclusionListRef: ArtifactRef;
  readonly contentHash: string;
  readonly createdAt: string;
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
}

export interface RuntimeMessageListExplanation {
  readonly runtimeMessageListRef: MessageListRef;
  readonly summary: string;
  readonly sourceMap: RuntimeSourceMap;
  readonly budgetReport: RuntimeBudgetReport;
  readonly exclusionList: RuntimeExclusionList;
}

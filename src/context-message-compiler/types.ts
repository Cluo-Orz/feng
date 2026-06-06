import type { BrandedString } from "../domain/brand.js";
import type {
  ArtifactRef,
  AuditDescriptor,
  FeedbackUnitRef,
  GrowUnitRef,
  MessageListId,
  MessageListRef,
  PolicyDecisionId,
  SkillRef,
  SourceDescriptor,
  ToolId,
  VersionDescriptor
} from "../domain/index.js";
import type { Result } from "../domain/result.js";
import type { ArtifactRegistry } from "../artifact-registry/index.js";
import type { EventAppendReceipt, EventLedger } from "../event-ledger/index.js";
import type { FileNativeStore, WorkspaceHandle, WriteReceipt } from "../file-store/index.js";
import type { PolicyBoundary } from "../policy-boundary/index.js";
import type { SkillRegistry } from "../skill-registry/index.js";
import type { GrowUnitManager } from "../grow-unit-manager/index.js";
import type { AdmissionFeedbackInbox, InboxItemRef, UpstreamProposalRef } from "../admission-feedback-inbox/index.js";
import type {
  AgendaDoDManager,
  AgendaItemRef,
  AttemptIntentRef,
  DoDRef,
  GapRef
} from "../agenda-dod-manager/index.js";

export type ContextCompilePlanId = BrandedString<"ContextCompilePlanId">;
export type MessageListInvalidationId = BrandedString<"MessageListInvalidationId">;

export interface ContextCompilePlanRef {
  readonly kind: "context_compile_plan";
  readonly id: ContextCompilePlanId;
  readonly uri?: string;
  readonly version?: string;
}

export type ProviderNeutralMessageRole = "system" | "user" | "assistant";

export interface ProviderNeutralTextPart {
  readonly type: "text";
  readonly text: string;
}

export interface ProviderNeutralMessage {
  readonly role: ProviderNeutralMessageRole;
  readonly content: readonly ProviderNeutralTextPart[];
  readonly name?: string;
  readonly metadata?: Record<string, string>;
}

export const contextSectionKinds = [
  "core_invariants",
  "grow_goal",
  "target_world_summary",
  "agenda_and_dod",
  "admitted_materials",
  "feedback_state",
  "evidence_summary",
  "visible_skills",
  "visible_tools",
  "policy_boundaries",
  "attempt_intent",
  "output_expectation",
  "excluded_or_unavailable_summary"
] as const;

export type ContextSectionKind = (typeof contextSectionKinds)[number];

export interface ContextSection {
  readonly sectionId: string;
  readonly kind: ContextSectionKind;
  readonly title: string;
  readonly content: string;
  readonly priority: number;
  readonly sourceMapEntryIds: readonly string[];
  readonly estimatedTokens: number;
  readonly truncated: boolean;
  readonly redacted: boolean;
}

export type ContextSourceRef =
  | ArtifactRef
  | GrowUnitRef
  | MessageListRef
  | SkillRef
  | InboxItemRef
  | FeedbackUnitRef
  | UpstreamProposalRef
  | AgendaItemRef
  | DoDRef
  | GapRef
  | AttemptIntentRef;

export const contextSourceTypes = [
  "grow_unit_snapshot",
  "admission_item",
  "feedback_unit",
  "agenda_item",
  "attempt_intent",
  "dod_item",
  "gap_record",
  "artifact",
  "skill",
  "tool_surface",
  "policy_decision",
  "readiness_or_evidence_summary",
  "manual_instruction"
] as const;

export type ContextSourceType = (typeof contextSourceTypes)[number];

export interface SourceMapEntry {
  readonly entryId: string;
  readonly messagePath: string;
  readonly section: ContextSectionKind;
  readonly sourceType: ContextSourceType;
  readonly sourceRef?: ContextSourceRef;
  readonly sourceVersion?: VersionDescriptor;
  readonly inclusionReason: string;
  readonly transformation: string;
  readonly redacted: boolean;
  readonly truncated: boolean;
  readonly policyDecisionId?: PolicyDecisionId;
  readonly contentHash?: string;
}

export interface SourceMap {
  readonly messageListRef: MessageListRef;
  readonly entries: readonly SourceMapEntry[];
  readonly builtAt: string;
}

export const exclusionReasons = [
  "not_admitted",
  "waiting_evidence",
  "waiting_human",
  "privacy_blocked",
  "policy_blocked",
  "redacted",
  "retracted",
  "archived",
  "artifact_unavailable",
  "out_of_budget",
  "lower_priority",
  "not_relevant_to_attempt_intent",
  "incompatible_version",
  "unsafe_tool_surface"
] as const;

export type ExclusionReason = (typeof exclusionReasons)[number];

export interface ExclusionRecord {
  readonly sourceType: ContextSourceType;
  readonly sourceRef?: ContextSourceRef;
  readonly reason: ExclusionReason;
  readonly summary: string;
  readonly section?: ContextSectionKind;
  readonly policyDecisionId?: PolicyDecisionId;
}

export interface ExclusionList {
  readonly messageListRef: MessageListRef;
  readonly records: readonly ExclusionRecord[];
  readonly builtAt: string;
}

export interface SectionBudget {
  readonly section: ContextSectionKind;
  readonly budget: number;
  readonly estimatedUsage: number;
}

export interface BudgetReport {
  readonly messageListRef: MessageListRef;
  readonly budgetModel: "rough_char_tokens";
  readonly totalBudget: number;
  readonly sectionBudgets: readonly SectionBudget[];
  readonly estimatedUsage: number;
  readonly overBudget: boolean;
  readonly compressionApplied: boolean;
  readonly truncationApplied: boolean;
  readonly unavailableSources: readonly string[];
  readonly builtAt: string;
}

export interface ToolSurfaceSummary {
  readonly toolId: ToolId;
  readonly name: string;
  readonly capabilitySummary: string;
  readonly policyBoundarySummary: string;
  readonly inclusionReason: string;
  readonly safeForModel: boolean;
  readonly policyDecisionId?: PolicyDecisionId;
}

export interface ContextBudgetInput {
  readonly totalBudget?: number;
  readonly sectionBudgets?: Partial<Record<ContextSectionKind, number>>;
}

export interface ContextCompileInput {
  readonly growUnitRef: GrowUnitRef;
  readonly attemptIntentRef?: AttemptIntentRef;
  readonly artifactCandidateRefs?: readonly ArtifactRef[];
  readonly toolSurfaceSummary?: readonly ToolSurfaceSummary[];
  readonly compileReason: string;
  readonly correlationId?: string;
  readonly budget?: ContextBudgetInput;
  readonly skillBodyMode?: "summary_only" | "bounded_body";
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
}

export interface CandidateSource {
  readonly sourceType: ContextSourceType;
  readonly sourceRef?: ContextSourceRef;
  readonly intendedSection: ContextSectionKind;
  readonly inclusionReason: string;
  readonly priority: number;
}

export interface ContextCompilePlan {
  readonly compilePlanId: ContextCompilePlanId;
  readonly compilePlanRef: ContextCompilePlanRef;
  readonly growUnitRef: GrowUnitRef;
  readonly attemptIntentRef?: AttemptIntentRef;
  readonly candidateSources: readonly CandidateSource[];
  readonly sectionPlan: readonly ContextSectionKind[];
  readonly priorityRules: readonly string[];
  readonly budget: Required<ContextBudgetInput>;
  readonly redactionRules: readonly string[];
  readonly exclusionRules: readonly string[];
  readonly skillVisibilityPlan: string;
  readonly toolVisibilityPlan: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly createdAt: string;
  readonly recordVersion: number;
}

export interface CompileReport {
  readonly messageListRef: MessageListRef;
  readonly compilePlanRef: ContextCompilePlanRef;
  readonly growUnitRef: GrowUnitRef;
  readonly attemptIntentRef?: AttemptIntentRef;
  readonly artifactRef: ArtifactRef;
  readonly sourceMapRef: ArtifactRef;
  readonly budgetReportRef: ArtifactRef;
  readonly exclusionListRef: ArtifactRef;
  readonly sectionCount: number;
  readonly warnings: readonly string[];
  readonly createdAt: string;
}

export interface CompiledMessageListRecord {
  readonly messageListId: MessageListId;
  readonly messageListRef: MessageListRef;
  readonly growUnitRef: GrowUnitRef;
  readonly attemptIntentRef?: AttemptIntentRef;
  readonly compilePlanRef: ContextCompilePlanRef;
  readonly artifactRef: ArtifactRef;
  readonly providerNeutralMessages: readonly ProviderNeutralMessage[];
  readonly sections: readonly ContextSection[];
  readonly sourceMapRef: ArtifactRef;
  readonly budgetReportRef: ArtifactRef;
  readonly exclusionListRef: ArtifactRef;
  readonly compileReportRef: ArtifactRef;
  readonly contentHash: string;
  readonly createdAt: string;
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
}

export interface RecompileMessageListInput {
  readonly reason: string;
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
  readonly correlationId?: string;
  readonly budget?: ContextBudgetInput;
  readonly skillBodyMode?: "summary_only" | "bounded_body";
}

export interface MessageListInvalidationRecord {
  readonly invalidationId: MessageListInvalidationId;
  readonly messageListRef: MessageListRef;
  readonly reason: string;
  readonly replacementRef?: MessageListRef;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly createdAt: string;
}

export interface MessageListInvalidationReceipt {
  readonly messageListRef: MessageListRef;
  readonly invalidationId: MessageListInvalidationId;
  readonly eventReceipt?: EventAppendReceipt;
  readonly recordWriteReceipt?: WriteReceipt;
}

export interface MessageListExplanation {
  readonly messageListRef: MessageListRef;
  readonly summary: string;
  readonly sourceMap: SourceMap;
  readonly budgetReport: BudgetReport;
  readonly exclusionList: ExclusionList;
  readonly compileReport: CompileReport;
}

export interface CompilePlanExplanation {
  readonly compilePlanRef: ContextCompilePlanRef;
  readonly summary: string;
  readonly candidateCount: number;
  readonly sectionPlan: readonly ContextSectionKind[];
  readonly priorityRules: readonly string[];
}

export interface ContextMessageCompilerOptions {
  readonly workspace: WorkspaceHandle;
  readonly ledger: EventLedger;
  readonly artifactRegistry: ArtifactRegistry;
  readonly policyBoundary: PolicyBoundary;
  readonly skillRegistry: SkillRegistry;
  readonly growUnitManager: GrowUnitManager;
  readonly admissionInbox: AdmissionFeedbackInbox;
  readonly agendaDoDManager: AgendaDoDManager;
  readonly producer: string;
  readonly defaultBudgetTokens?: number;
}

export interface ContextMessageCompiler {
  readonly buildCompilePlan: (input: ContextCompileInput) => Promise<Result<ContextCompilePlan>>;
  readonly explainCompilePlan: (ref: ContextCompilePlanRef) => Promise<Result<CompilePlanExplanation>>;
  readonly compileMessageList: (input: ContextCompileInput) => Promise<Result<MessageListRef>>;
  readonly recompileMessageList: (
    previousMessageListRef: MessageListRef,
    input: RecompileMessageListInput
  ) => Promise<Result<MessageListRef>>;
  readonly invalidateMessageList: (
    messageListRef: MessageListRef,
    input: RecompileMessageListInput & { readonly replacementRef?: MessageListRef }
  ) => Promise<Result<MessageListInvalidationReceipt>>;
  readonly explainMessageList: (messageListRef: MessageListRef) => Promise<Result<MessageListExplanation>>;
  readonly readSourceMap: (messageListRef: MessageListRef) => Promise<Result<SourceMap>>;
  readonly readBudgetReport: (messageListRef: MessageListRef) => Promise<Result<BudgetReport>>;
  readonly readExclusionList: (messageListRef: MessageListRef) => Promise<Result<ExclusionList>>;
}

export interface ContextCompilerDependencies {
  readonly store: FileNativeStore;
  readonly options: ContextMessageCompilerOptions;
}

export interface MessageListIndex { readonly messageListRefs: readonly MessageListRef[]; }
export interface CompilePlanIndex { readonly compilePlanRefs: readonly ContextCompilePlanRef[]; }
export interface InvalidationIndex { readonly invalidationIds: readonly MessageListInvalidationId[]; }

// File-native runtime package for an authoring (e.g. novel-writing) agent.
// This is the "hatch 运行包" that is grown in one project (xiaoshuo) and
// loaded by a work project (libai-chongsheng). It must carry everything the
// concept (product-concept.md 203-211, novel-case-flow.md 184-192) requires:
// run entry, integration contract, message-list compile policy, context
// policy, trace/feedback capability, absorb/upstream boundary, validation,
// and a locked version.

export const PACKAGE_SCHEMA_VERSION = "1.0.0";

export const contextSectionKinds = [
  "observation",
  "short_term",
  "long_term",
  "feedback"
] as const;
export type ContextSectionKind = (typeof contextSectionKinds)[number];

export interface ContextSectionPolicy {
  readonly kind: ContextSectionKind;
  readonly title: string;
  readonly source: string;
  readonly maxChars: number;
}

export interface TargetWorldContract {
  readonly description: string;
  readonly inputKinds: readonly string[];
  readonly outputKinds: readonly string[];
  readonly actionBoundary: readonly string[];
  readonly failureHandling: readonly string[];
  readonly dialogueAllowed: boolean;
}

export const qualityCheckKinds = [
  "length",
  "chapter_continuity",
  "year_consistency",
  "character_continuation",
  "geography_consistency",
  "outline_continuity",
  "artifact_presence"
] as const;
export type QualityCheckKind = (typeof qualityCheckKinds)[number];

export interface QualityRule {
  readonly kind: QualityCheckKind;
  readonly minChars?: number;
  readonly maxChars?: number;
  readonly note?: string;
}

export const feedbackLayers = ["work", "capability", "system"] as const;
export type FeedbackLayer = (typeof feedbackLayers)[number];

// Maps a quality-issue kind to the lifecycle layer that owns it. Work facts
// stay in the work project; writing-capability gaps flow to the agent's grow
// project; runtime/record/system issues flow to feng.
export interface FeedbackRoutingRule {
  readonly issueKind: string;
  readonly layer: FeedbackLayer;
  readonly reason: string;
}

export interface WritingStrategy {
  readonly systemPrompt: string;
  readonly stylePrinciples: readonly string[];
  readonly constraints: readonly string[];
}

export interface PackageValidation {
  readonly readiness: "ready" | "draft";
  readonly grownInProject: string;
  readonly grownByGrowUnitId?: string;
  readonly grownByAttemptId?: string;
  readonly evidenceSummary: string;
  readonly checkedAt: string;
}

export interface AuthoringRuntimePackage {
  readonly schemaVersion: string;
  readonly packageId: string;
  readonly name: string;
  readonly kind: "serialized_authoring_agent";
  readonly version: string;
  readonly locked: boolean;
  readonly runEntry: string;
  readonly targetWorld: TargetWorldContract;
  readonly contextPolicy: readonly ContextSectionPolicy[];
  readonly writingStrategy: WritingStrategy;
  readonly qualityRules: readonly QualityRule[];
  readonly feedbackRouting: readonly FeedbackRoutingRule[];
  readonly validation: PackageValidation;
  readonly provenance: {
    readonly model: string;
    readonly provider: string;
    readonly hatchedAt: string;
  };
}

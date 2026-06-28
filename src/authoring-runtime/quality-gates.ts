import {
  qualityCheckKinds,
  type AuthoringRuntimePackage,
  type FeedbackLayer,
  type QualityCheckKind,
  type QualityRule
} from "../runtime-package/index.js";
import type { RoutedFeedback } from "./feedback.js";
import type { GoalCoverageEval } from "./goal-coverage.js";
import { WORK_CHAPTER_GOAL_COVERAGE_EVAL_FILE } from "./goal-coverage.js";
import type { QualityEval, QualityIssue } from "./quality.js";
import type { ProjectConfig } from "./state.js";

export const XIAOSHUO_QUALITY_GATE_PATH = ".feng/quality-gates/xiaoshuo.json";
export const WORK_CHAPTER_QUALITY_GATE_FILE = "quality-gates.json";
export const WORK_CHAPTER_GATE_REVIEW_FILE = "gate-review.json";

export type QualityGateLayer = FeedbackLayer | "runtime";
export type QualityGateStatus = "passed" | "failed" | "waiting_evidence" | "needs_human_judgment";
export type CoverageStatus = "covered" | "waiting_evidence" | "uncovered" | "out_of_scope";
export type WorkGateReviewDecision = "passed" | "failed";

export interface QualityGateRecord {
  readonly gateId: string;
  readonly layer: QualityGateLayer;
  readonly title: string;
  readonly sourceRequirement: string;
  readonly evidenceRequired: string;
  readonly status: QualityGateStatus;
  readonly issueKinds: readonly QualityCheckKind[];
  readonly notes: readonly string[];
}

export interface TargetCoverageRecord {
  readonly requirement: string;
  readonly source: "user_goal" | "target_world" | "quality_rule" | "feedback_route" | "runtime_contract" | "work_project" | "run_artifact";
  readonly status: CoverageStatus;
  readonly mappedGateIds: readonly string[];
  readonly notes: readonly string[];
}

export interface CapabilityFeedbackCoverageInput {
  readonly issueKind: QualityCheckKind;
  readonly feedbackKey?: string;
  readonly chapter?: number;
  readonly detail?: string;
  readonly source?: string;
  readonly gateId?: string;
  readonly artifactPath?: string;
  readonly mappedConstraint?: string;
}

export interface QualityGateSetSummary {
  readonly totalGates: number;
  readonly passed: number;
  readonly failed: number;
  readonly waitingEvidence: number;
  readonly needsHumanJudgment: number;
  readonly uncoveredRequirements: number;
  readonly blockingCount: number;
}

export interface QualityGateSet {
  readonly schemaVersion: "1.0.0";
  readonly kind: "xiaoshuo_quality_gate_set" | "work_project_quality_gate_set";
  readonly generatedAt: string;
  readonly goal: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly sampleRoundCount: number;
  readonly readiness: string;
  readonly gates: readonly QualityGateRecord[];
  readonly coverage: readonly TargetCoverageRecord[];
  readonly summary: QualityGateSetSummary;
}

export interface WorkGateReview {
  readonly schemaVersion: "1.0.0";
  readonly kind: "work_gate_review";
  readonly gateId: string;
  readonly decision: WorkGateReviewDecision;
  readonly reason: string;
  readonly reviewer?: string;
  readonly reviewedAt: string;
}

export interface SynthesizeXiaoshuoQualityGatesInput {
  readonly goal: string;
  readonly pkg: AuthoringRuntimePackage;
  readonly designArtifacts?: {
    readonly designTracePath?: string;
    readonly coveragePolicyAuthoredByGrow?: boolean;
  };
  readonly finalIssueKinds: readonly QualityCheckKind[];
  readonly capabilityFeedbackCoverage?: readonly CapabilityFeedbackCoverageInput[];
  readonly unresolvedSystemIssueKinds?: readonly QualityCheckKind[];
  readonly systemFeedbackRefs?: readonly string[];
  readonly finalFailChapters: number;
  readonly sampleGateBlockingCount?: number;
  readonly sampleRoundCount: number;
  readonly readiness: string;
  readonly now?: () => string;
}

export interface SynthesizeWorkProjectQualityGatesInput {
  readonly project: ProjectConfig;
  readonly pkg: AuthoringRuntimePackage;
  readonly chapterNumber: number;
  readonly chapterGoal?: string;
  readonly artifactDir: string;
  readonly quality: QualityEval;
  readonly feedback: RoutedFeedback;
  readonly semanticEvaluated?: boolean;
  readonly goalCoverage?: GoalCoverageEval;
  readonly now?: () => string;
}

const titles: Record<QualityCheckKind, string> = {
  length: "章节长度契约",
  chapter_continuity: "章节连续性",
  year_consistency: "年份与时间线一致性",
  character_continuation: "人物承接",
  geography_consistency: "地点设定一致性",
  outline_continuity: "大纲与章节状态连续性",
  artifact_presence: "file-native 运行记录",
  runtime_capability: "运行时能力边界",
  goal_coverage: "本章目标覆盖",
  semantic_style: "文风与可读性",
  semantic_character: "人物可信度",
  semantic_plot: "情节推进"
};

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "gate";
}

function unique<T>(values: readonly T[]): readonly T[] {
  return Array.from(new Set(values));
}

function isQualityCheckKind(value: string): value is QualityCheckKind {
  return (qualityCheckKinds as readonly string[]).includes(value);
}

function layerFor(pkg: AuthoringRuntimePackage, kind: QualityCheckKind): QualityGateLayer {
  const route = pkg.feedbackRouting.find((item) => item.issueKind === kind);
  return route?.layer ?? "work";
}

function routeFor(pkg: AuthoringRuntimePackage, kind: QualityCheckKind) {
  return pkg.feedbackRouting.find((item) => item.issueKind === kind);
}

function gateStatus(
  rule: QualityRule,
  finalIssueKinds: readonly QualityCheckKind[],
  finalFailChapters: number,
  sampleRoundCount: number
): QualityGateStatus {
  if (finalIssueKinds.includes(rule.kind)) return "failed";
  if (finalFailChapters > 0 && rule.kind === "length") return "failed";
  return sampleRoundCount > 0 ? "passed" : "waiting_evidence";
}

function evidenceText(rule: QualityRule): string {
  if (rule.kind === "artifact_presence") return "sample run writes message-list, trace, quality eval, and feedback artifacts";
  if (rule.kind === "length") return "sample chapters satisfy the grown length contract";
  if (rule.kind === "semantic_style" || rule.kind === "semantic_character" || rule.kind === "semantic_plot") {
    return "semantic judge or author review evidence, when enabled";
  }
  return "sample run structural quality evaluation";
}

function statusFromIssues(kind: QualityCheckKind, issues: readonly QualityIssue[], semanticEvaluated: boolean): QualityGateStatus {
  const matched = issues.filter((issue) => issue.kind === kind);
  if (matched.some((issue) => issue.severity === "error")) return "failed";
  if (matched.some((issue) => issue.severity === "warning")) return "needs_human_judgment";
  if ((kind === "semantic_style" || kind === "semantic_character" || kind === "semantic_plot") && !semanticEvaluated) return "waiting_evidence";
  return "passed";
}

function goalCoveragePassed(evaluated: GoalCoverageEval | undefined): boolean {
  return evaluated?.covered === true && evaluated.confidence >= 0.7 && evaluated.evidence.length > 0;
}

function goalCoverageGateStatus(
  evaluated: GoalCoverageEval | undefined,
  semanticEvaluated: boolean
): QualityGateStatus {
  if (evaluated === undefined) return semanticEvaluated ? "needs_human_judgment" : "waiting_evidence";
  if (goalCoveragePassed(evaluated)) return "passed";
  return evaluated.covered ? "needs_human_judgment" : "failed";
}

function goalCoverageStatus(evaluated: GoalCoverageEval | undefined): CoverageStatus {
  if (evaluated === undefined) return "waiting_evidence";
  return goalCoveragePassed(evaluated) ? "covered" : "uncovered";
}

function feedbackGateId(issueKind: string): string {
  return `gate-routed-${slug(issueKind)}`;
}

function splitGoalItems(goal: string): readonly string[] {
  const normalized = goal.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return [];
  const parts = normalized
    .split(/[\r\n;；。！？!?]+|[、,，]+|(?:\s+(?:and|&)\s+)|(?:并且|以及|同时|另外)/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && part !== normalized);
  return unique(parts);
}

function packageSearchText(pkg: AuthoringRuntimePackage): string {
  return [
    pkg.name,
    pkg.targetWorld.description,
    ...pkg.targetWorld.inputKinds,
    ...pkg.targetWorld.outputKinds,
    ...pkg.targetWorld.actionBoundary,
    ...pkg.targetWorld.failureHandling,
    ...pkg.contextPolicy.flatMap((policy) => [policy.kind, policy.title, policy.source]),
    pkg.writingStrategy.systemPrompt,
    ...pkg.writingStrategy.stylePrinciples,
    ...pkg.writingStrategy.constraints,
    ...pkg.storyModel.trackedFacts,
    ...pkg.storyModel.continuityDimensions,
    ...pkg.harness.steps,
    pkg.coveragePolicy.noMissingTopic.gateId,
    pkg.coveragePolicy.noMissingTopic.title,
    pkg.coveragePolicy.noMissingTopic.evidenceRequired,
    ...pkg.qualityRules.flatMap((rule) => [rule.kind, rule.note ?? ""]),
    ...pkg.feedbackRouting.flatMap((route) => [route.issueKind, route.layer, route.reason])
  ].join("\n").toLowerCase();
}

function hasPackageTermMismatch(item: string, pkgText: string): boolean {
  const text = item.toLowerCase();
  const concreteTerms = [
    "小说", "连载", "章节", "正文", "大纲", "人物", "情节", "写作",
    "音乐", "歌曲", "旋律", "作曲", "编曲", "歌词",
    "小车", "车辆", "驾驶", "导航", "避障", "传感器",
    "boss", "敌人", "战斗", "游戏", "行为树"
  ];
  return concreteTerms.some((term) => text.includes(term) && !pkgText.includes(term));
}

function existingGateIds(gates: readonly QualityGateRecord[], ids: readonly string[]): readonly string[] {
  const existing = new Set(gates.map((gate) => gate.gateId));
  return unique(ids.filter((id) => existing.has(id)));
}

function goalItemGateIds(
  item: string,
  pkg: AuthoringRuntimePackage,
  gates: readonly QualityGateRecord[],
  pkgText: string
): readonly string[] {
  if (hasPackageTermMismatch(item, pkgText)) return [];
  const text = item.toLowerCase();
  const ids: string[] = [];
  const add = (condition: boolean, values: readonly string[]): void => {
    if (condition) ids.push(...values);
  };
  const qualityGate = (kind: QualityCheckKind): string => `gate-${slug(kind)}`;
  add(/agent|智能行为|运行|运行包|runtime|接收|输入|输出|生成|能力包|hatch|可复制|小说|连载|章节|正文|大纲|计划|续写|设定|冲突|门禁|prompt|提示词|系统提示|只写/.test(text), ["gate-runtime-contract", "gate-sample-work-quality-gates"]);
  add(/反馈|候选|回流|上报|路由|调试|问题|归因|作品层|能力层|系统层/.test(text), ["gate-feedback-routing", "gate-runtime-contract"]);
  add(/质量门禁|门禁|不漏题|漏题|目标|覆盖/.test(text), ["gate-grown-coverage-policy", "gate-sample-work-quality-gates", qualityGate("goal_coverage")]);
  add(/连贯|连续|承接|上下文|长篇|前情|已有章节|提纲|伏笔/.test(text), [qualityGate("chapter_continuity"), qualityGate("outline_continuity"), qualityGate("character_continuation"), "gate-runtime-contract"]);
  add(/人物|角色|性格/.test(text), [qualityGate("character_continuation"), qualityGate("semantic_character")]);
  add(/情节|剧情|推进/.test(text), [qualityGate("semantic_plot"), qualityGate("outline_continuity")]);
  add(/文风|风格|可读/.test(text), [qualityGate("semantic_style")]);
  add(/年份|时间线|时间/.test(text), [qualityGate("year_consistency"), "gate-runtime-contract", "gate-sample-work-quality-gates"]);
  add(/地点|地理|场景/.test(text), [qualityGate("geography_consistency"), "gate-runtime-contract", "gate-sample-work-quality-gates"]);
  add(/file|文件|trace|message|记录|可追溯|可审计|证据/.test(text), [qualityGate("artifact_presence"), "gate-sample-work-quality-gates"]);
  for (const rule of pkg.qualityRules) {
    if (text.includes(rule.kind) || (rule.note !== undefined && item.includes(rule.note))) ids.push(qualityGate(rule.kind));
  }
  for (const route of pkg.feedbackRouting) {
    if (text.includes(route.issueKind) || item.includes(route.reason)) ids.push("gate-feedback-routing");
  }
  return existingGateIds(gates, ids);
}

function capabilityFeedbackRequirement(feedback: CapabilityFeedbackCoverageInput): string {
  if (feedback.feedbackKey !== undefined && feedback.feedbackKey.trim().length > 0) return `capability_feedback:${feedback.feedbackKey}`;
  return `capability_feedback:${feedback.issueKind}${feedback.chapter === undefined ? "" : `:ch${feedback.chapter}`}${feedback.detail === undefined ? "" : `:${feedback.detail}`}`;
}

function coverageStatusFromGateIds(gates: readonly QualityGateRecord[], gateIds: readonly string[]): CoverageStatus {
  const statuses = gateIds
    .map((gateId) => gates.find((gate) => gate.gateId === gateId)?.status)
    .filter((status): status is QualityGateStatus => status !== undefined);
  if (statuses.length === 0) return "waiting_evidence";
  if (statuses.some((status) => status === "failed")) return "uncovered";
  if (statuses.some((status) => status !== "passed")) return "waiting_evidence";
  return "covered";
}

export function summarizeQualityGateSet(gates: readonly QualityGateRecord[], coverage: readonly TargetCoverageRecord[]): QualityGateSetSummary {
  const count = (status: QualityGateStatus): number => gates.filter((gate) => gate.status === status).length;
  const failed = count("failed");
  const waitingEvidence = count("waiting_evidence");
  const needsHumanJudgment = count("needs_human_judgment");
  const uncoveredRequirements = coverage.filter((item) => item.status === "uncovered").length;
  return {
    totalGates: gates.length,
    passed: count("passed"),
    failed,
    waitingEvidence,
    needsHumanJudgment,
    uncoveredRequirements,
    blockingCount: failed + waitingEvidence + needsHumanJudgment + uncoveredRequirements
  };
}

export function formatQualityGateSummary(summary: QualityGateSetSummary): string {
  return `quality gates ${summary.passed}/${summary.totalGates} passed; blocking=${summary.blockingCount}; coverage_uncovered=${summary.uncoveredRequirements}`;
}

export function applyWorkGateReview(gateSet: QualityGateSet, review: WorkGateReview): QualityGateSet {
  const gateStatus: QualityGateStatus = review.decision === "passed" ? "passed" : "failed";
  const coverageStatus: CoverageStatus = review.decision === "passed" ? "covered" : "uncovered";
  const reviewNote = `review:${review.decision}:${review.reason}`;
  const gates = gateSet.gates.map((gate): QualityGateRecord => {
    if (gate.gateId !== review.gateId) return gate;
    return {
      ...gate,
      status: gateStatus,
      notes: [...gate.notes, reviewNote, ...(review.reviewer === undefined ? [] : [`reviewer:${review.reviewer}`])]
    };
  });
  const coverage = gateSet.coverage.map((item): TargetCoverageRecord => {
    if (!item.mappedGateIds.includes(review.gateId)) return item;
    return {
      ...item,
      status: coverageStatus,
      notes: [...item.notes, reviewNote]
    };
  });
  return {
    ...gateSet,
    gates,
    coverage,
    summary: summarizeQualityGateSet(gates, coverage)
  };
}

export function synthesizeXiaoshuoQualityGates(input: SynthesizeXiaoshuoQualityGatesInput): QualityGateSet {
  const generatedAt = (input.now ?? (() => new Date().toISOString()))();
  const gates: QualityGateRecord[] = input.pkg.qualityRules.map((rule) => ({
    gateId: `gate-${slug(rule.kind)}`,
    layer: layerFor(input.pkg, rule.kind),
    title: titles[rule.kind],
    sourceRequirement: rule.note ?? `quality rule ${rule.kind}`,
    evidenceRequired: evidenceText(rule),
    status: gateStatus(rule, input.finalIssueKinds, input.finalFailChapters, input.sampleRoundCount),
    issueKinds: [rule.kind],
    notes: [
      "generated from the grown runtime package quality rule",
      ...(rule.kind === "length" ? [`min=${rule.minChars ?? "unset"} max=${rule.maxChars ?? "unset"}`] : [])
    ]
  }));

  const representedIssueKinds = new Set(gates.flatMap((gate) => gate.issueKinds));
  for (const kind of unique(input.finalIssueKinds).filter((kind) => !representedIssueKinds.has(kind))) {
    gates.push({
      gateId: `gate-final-capability-${slug(kind)}`,
      layer: layerFor(input.pkg, kind),
      title: titles[kind],
      sourceRequirement: `unresolved final sample capability issue: ${kind}`,
      evidenceRequired: "final grow sample round must clear this capability feedback or explicitly route it to an upstream system gate",
      status: "failed",
      issueKinds: [kind],
      notes: ["generated from final grow round capability feedback because the grown package did not declare a dedicated quality rule for this issue kind"]
    });
  }

  const capabilityFeedbackByKind = new Map<QualityCheckKind, CapabilityFeedbackCoverageInput[]>();
  for (const feedback of input.capabilityFeedbackCoverage ?? []) {
    const existing = capabilityFeedbackByKind.get(feedback.issueKind) ?? [];
    capabilityFeedbackByKind.set(feedback.issueKind, [...existing, feedback]);
  }

  for (const [kind, feedback] of capabilityFeedbackByKind.entries()) {
    const mappedConstraint = feedback.find((item) => item.mappedConstraint !== undefined)?.mappedConstraint;
    const route = routeFor(input.pkg, kind);
    const routePreservesCapability = route?.layer === "capability";
    const gateId = `gate-seeded-capability-${slug(kind)}`;
    gates.push({
      gateId,
      layer: "capability",
      title: `下游能力反馈吸收：${titles[kind]}`,
      sourceRequirement: `downstream capability feedback: ${kind}`,
      evidenceRequired: "final grown package must contain an explicit strategy constraint or equivalent gate covering this feedback, and future matching issues must still route to the capability layer",
      status: mappedConstraint !== undefined && routePreservesCapability ? "passed" : "failed",
      issueKinds: [kind],
      notes: [
        "generated from downstream capability feedback digest",
        ...(mappedConstraint === undefined ? ["no mapped constraint in final grown package"] : [`mappedConstraint:${mappedConstraint}`]),
        ...(route === undefined ? ["route:missing"] : [`route:${route.issueKind}->${route.layer}`]),
        ...(routePreservesCapability ? [] : ["seeded capability feedback must not be downgraded to work-local routing"]),
        ...feedback.flatMap((item) => [
          ...(item.detail === undefined ? [] : [`detail:${item.detail}`]),
          ...(item.feedbackKey === undefined ? [] : [`feedbackKey:${item.feedbackKey}`]),
          ...(item.chapter === undefined ? [] : [`chapter:${item.chapter}`]),
          ...(item.source === undefined ? [] : [`source:${item.source}`]),
          ...(item.gateId === undefined ? [] : [`sourceGate:${item.gateId}`]),
          ...(item.artifactPath === undefined ? [] : [`artifact:${item.artifactPath}`])
        ])
      ]
    });
  }

  for (const kind of unique(input.unresolvedSystemIssueKinds ?? [])) {
    gates.push({
      gateId: `gate-system-${slug(kind)}`,
      layer: "system",
      title: titles[kind],
      sourceRequirement: `unresolved upstream system feedback: ${kind}`,
      evidenceRequired: "feng-level grow must resolve or explicitly reject the system feedback before hatch readiness",
      status: "failed",
      issueKinds: [kind],
      notes: [
        "generated from .feng/grow-inbox/system-feedback.json",
        ...(input.systemFeedbackRefs ?? [])
      ]
    });
  }

  gates.push({
    gateId: "gate-sample-work-quality-gates",
    layer: "runtime",
    title: "样例作品门禁全部通过",
    sourceRequirement: "grow sample chapters must pass their own file-native work-project quality gates",
    evidenceRequired: "sample chapter quality-gates.json files report blocking=0 in the final grow round",
    status: (input.sampleGateBlockingCount ?? 0) === 0 ? "passed" : "failed",
    issueKinds: [],
    notes: [
      `sampleGateBlockingCount=${input.sampleGateBlockingCount ?? 0}`,
      "prevents hatch readiness when sample chapters still have unresolved goal coverage or review gates"
    ]
  });

  gates.push({
    gateId: "gate-feedback-routing",
    layer: "runtime",
    title: "反馈归因与上报边界",
    sourceRequirement: "hatch agent must route work/capability/system issues to the right layer",
    evidenceRequired: "package feedback routing covers all generated quality issue kinds",
    status: input.pkg.feedbackRouting.length > 0 ? "passed" : "waiting_evidence",
    issueKinds: [],
    notes: input.pkg.feedbackRouting.map((route) => `${route.issueKind}->${route.layer}`)
  });

  gates.push({
    gateId: "gate-runtime-contract",
    layer: "runtime",
    title: "目标世界运行契约",
    sourceRequirement: input.pkg.targetWorld.description,
    evidenceRequired: "package declares inputs, outputs, action boundary, failure handling, and dialogue mode",
    status: input.pkg.targetWorld.inputKinds.length > 0 && input.pkg.targetWorld.outputKinds.length > 0 ? "passed" : "waiting_evidence",
    issueKinds: [],
    notes: [
      `inputs=${input.pkg.targetWorld.inputKinds.join(",")}`,
      `outputs=${input.pkg.targetWorld.outputKinds.join(",")}`,
      `dialogueAllowed=${input.pkg.targetWorld.dialogueAllowed}`
    ]
  });

  const noMissingTopic = input.pkg.coveragePolicy.noMissingTopic;
  const coveragePolicyReady =
    input.designArtifacts?.coveragePolicyAuthoredByGrow === true &&
    noMissingTopic.enabled &&
    !noMissingTopic.promptOnlyAllowed &&
    noMissingTopic.gateId.trim().length > 0 &&
    noMissingTopic.title.trim().length > 0 &&
    noMissingTopic.evidenceRequired.trim().length > 0;
  gates.push({
    gateId: "gate-grown-coverage-policy",
    layer: "runtime",
    title: "grow 产出的不漏题门禁策略",
    sourceRequirement: "hatch package must carry a grow-authored coveragePolicy.noMissingTopic instead of relying on prompt-only claims or parser defaults",
    evidenceRequired: "design model output/trace contains coveragePolicy.noMissingTopic, and the package requires file-native evidence for chapter goal coverage",
    status: coveragePolicyReady ? "passed" : "failed",
    issueKinds: ["goal_coverage"],
    notes: [
      `authoredByGrow=${input.designArtifacts?.coveragePolicyAuthoredByGrow === true}`,
      `enabled=${noMissingTopic.enabled}`,
      `gateId=${noMissingTopic.gateId}`,
      `promptOnlyAllowed=${noMissingTopic.promptOnlyAllowed}`,
      `blockingUntilReviewed=${noMissingTopic.blockingUntilReviewed}`,
      ...(input.designArtifacts?.designTracePath === undefined ? [] : [`designTrace=${input.designArtifacts.designTracePath}`])
    ]
  });

  const pkgText = packageSearchText(input.pkg);
  const goalItems = splitGoalItems(input.goal).map((item, index): TargetCoverageRecord => {
    const mappedGateIds = goalItemGateIds(item, input.pkg, gates, pkgText);
    return {
      requirement: `goal_item:${index + 1}:${item}`,
      source: "user_goal",
      status: mappedGateIds.length === 0 ? "uncovered" : coverageStatusFromGateIds(gates, mappedGateIds),
      mappedGateIds,
      notes: mappedGateIds.length === 0
        ? ["no generated runtime contract, quality gate, feedback route, or sample gate maps this user-goal item"]
        : ["user-goal item is mapped to generated package gates instead of being hidden inside the full goal text"]
    };
  });
  const goalItemStatuses = goalItems.map((item) => item.status);
  const goalItemGateStatus: QualityGateStatus = goalItems.length === 0 || goalItemStatuses.every((status) => status === "covered")
    ? "passed"
    : goalItemStatuses.some((status) => status === "uncovered") ? "failed" : "waiting_evidence";
  gates.push({
    gateId: "gate-user-goal-item-coverage",
    layer: "runtime",
    title: "用户目标项不能漏题",
    sourceRequirement: "each split user-goal item must map to generated runtime contract, package quality rules, sample work gates, or feedback routes",
    evidenceRequired: "xiaoshuo quality-gates coverage contains no uncovered goal_item:N entries",
    status: goalItemGateStatus,
    issueKinds: [],
    notes: [
      `goalItems=${goalItems.length}`,
      `uncovered=${goalItems.filter((item) => item.status === "uncovered").length}`,
      `waiting=${goalItems.filter((item) => item.status === "waiting_evidence").length}`,
      "prevents hatch readiness when the grown package silently ignores part of the requested target"
    ]
  });

  const goalGateIds = [
    "gate-runtime-contract",
    "gate-grown-coverage-policy",
    "gate-user-goal-item-coverage",
    "gate-feedback-routing",
    "gate-sample-work-quality-gates",
    ...gates.filter((gate) => gate.issueKinds.length > 0).map((gate) => gate.gateId)
  ];
  const coverage: TargetCoverageRecord[] = [
    {
      requirement: input.goal,
      source: "user_goal",
      status: coverageStatusFromGateIds(gates, goalGateIds),
      mappedGateIds: goalGateIds,
      notes: [
        "goal is mapped to runtime contract, quality rules, sample work gates, and feedback routing gates",
        ...(goalItems.length === 0 ? [] : [`splitGoalItems=${goalItems.length}`])
      ]
    },
    ...goalItems,
    {
      requirement: "coverage_policy:noMissingTopic",
      source: "runtime_contract",
      status: coveragePolicyReady ? "covered" : "uncovered",
      mappedGateIds: ["gate-grown-coverage-policy"],
      notes: [
        "the no-missing-topic policy must be an explicit grow design artifact before hatch",
        ...(input.designArtifacts?.designTracePath === undefined ? [] : [`designTrace=${input.designArtifacts.designTracePath}`])
      ]
    },
    ...input.pkg.targetWorld.inputKinds.map((requirement): TargetCoverageRecord => ({
      requirement: `input:${requirement}`,
      source: "target_world",
      status: coverageStatusFromGateIds(gates, ["gate-runtime-contract"]),
      mappedGateIds: ["gate-runtime-contract"],
      notes: ["target-world input is declared in the package contract"]
    })),
    ...input.pkg.targetWorld.outputKinds.map((requirement): TargetCoverageRecord => ({
      requirement: `output:${requirement}`,
      source: "target_world",
      status: coverageStatusFromGateIds(gates, ["gate-runtime-contract"]),
      mappedGateIds: ["gate-runtime-contract"],
      notes: ["target-world output is declared in the package contract"]
    })),
    ...input.pkg.qualityRules.map((rule): TargetCoverageRecord => ({
      requirement: `quality:${rule.kind}`,
      source: "quality_rule",
      status: coverageStatusFromGateIds(gates, [`gate-${slug(rule.kind)}`]),
      mappedGateIds: [`gate-${slug(rule.kind)}`],
      notes: [rule.note ?? "quality rule generated by package"]
    })),
    ...input.pkg.feedbackRouting.map((route): TargetCoverageRecord => ({
      requirement: `feedback:${route.issueKind}->${route.layer}`,
      source: "feedback_route",
      status: coverageStatusFromGateIds(gates, ["gate-feedback-routing"]),
      mappedGateIds: ["gate-feedback-routing"],
      notes: [route.reason]
    })),
    ...(input.capabilityFeedbackCoverage ?? []).map((feedback): TargetCoverageRecord => ({
      requirement: capabilityFeedbackRequirement(feedback),
      source: "feedback_route",
      status: coverageStatusFromGateIds(gates, [`gate-seeded-capability-${slug(feedback.issueKind)}`]),
      mappedGateIds: [`gate-seeded-capability-${slug(feedback.issueKind)}`],
      notes: [
        "downstream feedback must be explicitly absorbed before hatch",
        ...(feedback.mappedConstraint === undefined ? ["missing mapped strategy constraint"] : [`mappedConstraint:${feedback.mappedConstraint}`]),
        ...(feedback.feedbackKey === undefined ? [] : [`feedbackKey:${feedback.feedbackKey}`]),
        ...(feedback.chapter === undefined ? [] : [`chapter:${feedback.chapter}`]),
        ...(feedback.gateId === undefined ? [] : [`sourceGate:${feedback.gateId}`]),
        ...(feedback.artifactPath === undefined ? [] : [`artifact:${feedback.artifactPath}`])
      ]
    })),
    ...unique(input.unresolvedSystemIssueKinds ?? []).map((kind): TargetCoverageRecord => ({
      requirement: `system_feedback:${kind}`,
      source: "feedback_route",
      status: coverageStatusFromGateIds(gates, [`gate-system-${slug(kind)}`]),
      mappedGateIds: [`gate-system-${slug(kind)}`],
      notes: ["unresolved system feedback is represented as a blocking hatch gate"]
    }))
  ];

  return {
    schemaVersion: "1.0.0",
    kind: "xiaoshuo_quality_gate_set",
    generatedAt,
    goal: input.goal,
    packageName: input.pkg.name,
    packageVersion: input.pkg.version,
    sampleRoundCount: input.sampleRoundCount,
    readiness: input.readiness,
    gates,
    coverage,
    summary: summarizeQualityGateSet(gates, coverage)
  };
}

export function synthesizeWorkProjectQualityGates(input: SynthesizeWorkProjectQualityGatesInput): QualityGateSet {
  const generatedAt = (input.now ?? (() => new Date().toISOString()))();
  const semanticEvaluated = input.semanticEvaluated === true;
  const qualityKinds = unique(input.pkg.qualityRules.map((rule) => rule.kind));
  const feedbackIssues: QualityIssue[] = input.feedback.candidates
    .filter((candidate) => isQualityCheckKind(candidate.issueKind))
    .map((candidate) => ({
      kind: candidate.issueKind as QualityCheckKind,
      severity: candidate.severity,
      detail: candidate.detail
    }));
  const qualityIssues = unique([...input.quality.issues, ...feedbackIssues]);
  const feedbackKinds = unique(input.feedback.candidates.map((candidate) => candidate.issueKind));
  const routedOnlyKinds = feedbackKinds.filter((kind) => !qualityKinds.includes(kind as QualityCheckKind));

  const gates: QualityGateRecord[] = input.pkg.qualityRules.map((rule) => ({
    gateId: `gate-${slug(rule.kind)}`,
    layer: layerFor(input.pkg, rule.kind),
    title: titles[rule.kind],
    sourceRequirement: rule.note ?? `quality rule ${rule.kind}`,
    evidenceRequired: evidenceText(rule),
    status: statusFromIssues(rule.kind, qualityIssues, semanticEvaluated),
    issueKinds: [rule.kind],
    notes: [
      "generated from the loaded hatch package quality rule",
      `quality_status=${input.quality.status}`,
      ...(rule.kind === "length" ? [`chars=${input.quality.chars}`, `min=${rule.minChars ?? "unset"} max=${rule.maxChars ?? "unset"}`] : [])
    ]
  }));

  for (const issueKind of routedOnlyKinds) {
    const candidates = input.feedback.candidates.filter((candidate) => candidate.issueKind === issueKind);
    const worst = candidates.some((candidate) => candidate.severity === "error") ? "failed" : "needs_human_judgment";
    const knownKind = isQualityCheckKind(issueKind) ? issueKind : undefined;
    gates.push({
      gateId: feedbackGateId(issueKind),
      layer: candidates[0]?.layer ?? "work",
      title: knownKind === undefined ? `反馈问题：${issueKind}` : titles[knownKind],
      sourceRequirement: `runtime feedback candidate ${issueKind}`,
      evidenceRequired: "feedback.json records the issue and its owner layer",
      status: worst,
      issueKinds: knownKind === undefined ? [] : [knownKind],
      notes: candidates.map((candidate) => `${candidate.layer}:${candidate.severity}:${candidate.routingReason}`)
    });
  }

  gates.push({
    gateId: "gate-work-input-coverage",
    layer: "work",
    title: "作品输入覆盖",
    sourceRequirement: "work project premise/title/chapter goal must enter the run context",
    evidenceRequired: "input.json and message-list.json include the current work-project target",
    status: input.project.premise.trim().length > 0 && input.project.title.trim().length > 0 ? "passed" : "failed",
    issueKinds: [],
    notes: [
      `title=${input.project.title}`,
      `premise_chars=${input.project.premise.length}`,
      `chapter_goal=${input.chapterGoal ?? "unset"}`
    ]
  });

  const noMissingTopic = input.pkg.coveragePolicy.noMissingTopic;
  if (noMissingTopic.enabled && input.chapterGoal !== undefined && input.chapterGoal.trim().length > 0) {
    const goalCoverage = input.goalCoverage;
    const gateStatus = goalCoverageGateStatus(goalCoverage, semanticEvaluated);
    gates.push({
      gateId: noMissingTopic.gateId,
      layer: gateStatus === "failed" && goalCoverage !== undefined ? "capability" : "work",
      title: noMissingTopic.title,
      sourceRequirement: input.chapterGoal,
      evidenceRequired: noMissingTopic.evidenceRequired,
      status: gateStatus,
      issueKinds: ["goal_coverage"],
      notes: [
        "generated from the copied hatch package coveragePolicy.noMissingTopic",
        "chapter goal is tracked as an explicit gate instead of being hidden inside the prompt",
        `promptOnlyAllowed=${noMissingTopic.promptOnlyAllowed}`,
        `blockingUntilReviewed=${noMissingTopic.blockingUntilReviewed}`,
        goalCoverage === undefined
          ? "no goal-coverage evaluator has produced evidence yet"
          : `goalCoverage=${goalCoverage.covered}; confidence=${goalCoverage.confidence}; evidence=${goalCoverage.evidence.length}; missing=${goalCoverage.missing.length}; artifact=${input.artifactDir}/${WORK_CHAPTER_GOAL_COVERAGE_EVAL_FILE}`
      ]
    });
  }

  gates.push({
    gateId: "gate-feedback-routing",
    layer: "runtime",
    title: "本轮问题归因与上报",
    sourceRequirement: "every generated issue must be attributed to work/capability/system before absorption",
    evidenceRequired: "feedback.json records all generated candidates and by-layer counts",
    status: input.feedback.candidates.length >= qualityIssues.length ? "passed" : "failed",
    issueKinds: [],
    notes: [
      `work=${input.feedback.byLayer.work}`,
      `capability=${input.feedback.byLayer.capability}`,
      `system=${input.feedback.byLayer.system}`
    ]
  });

  gates.push({
    gateId: "gate-runtime-artifacts",
    layer: "runtime",
    title: "file-native 运行记录",
    sourceRequirement: "each chapter run must leave inspectable files for the next loop",
    evidenceRequired: "input, message-list, model-output, trace, quality eval, feedback, and quality gates are written under the chapter artifact dir",
    status: "passed",
    issueKinds: ["artifact_presence"],
    notes: [`artifactDir=${input.artifactDir}`]
  });

  const qualityGateId = (kind: string): string => {
    if (qualityKinds.includes(kind as QualityCheckKind)) return `gate-${slug(kind)}`;
    return feedbackGateId(kind);
  };

  const coverage: TargetCoverageRecord[] = [
    {
      requirement: `title:${input.project.title}`,
      source: "work_project",
      status: input.project.title.trim().length > 0 ? "covered" : "uncovered",
      mappedGateIds: ["gate-work-input-coverage"],
      notes: ["work project title is read from .feng/runtime/project.json"]
    },
    {
      requirement: `premise:${input.project.premise}`,
      source: "work_project",
      status: input.project.premise.trim().length > 0 ? "covered" : "uncovered",
      mappedGateIds: ["gate-work-input-coverage"],
      notes: ["work project premise is read from .feng/runtime/project.json"]
    },
    ...(input.chapterGoal === undefined || !noMissingTopic.enabled ? [] : [{
      requirement: `chapter_goal:${input.chapterGoal}`,
      source: "work_project" as const,
      status: goalCoverageStatus(input.goalCoverage),
      mappedGateIds: [noMissingTopic.gateId],
      notes: [
        "tracked explicitly so the chapter cannot silently ignore the user's current target",
        "coverage requirement was generated from the hatch package coverage policy",
        ...(input.goalCoverage === undefined ? [] : [
          `goalCoverage=${input.goalCoverage.covered}`,
          `confidence=${input.goalCoverage.confidence}`,
          `artifact:${input.artifactDir}/${WORK_CHAPTER_GOAL_COVERAGE_EVAL_FILE}`
        ])
      ]
    }]),
    ...input.pkg.qualityRules.map((rule): TargetCoverageRecord => ({
      requirement: `quality:${rule.kind}`,
      source: "quality_rule",
      status: "covered",
      mappedGateIds: [`gate-${slug(rule.kind)}`],
      notes: [rule.note ?? "quality rule generated by hatch package"]
    })),
    ...input.feedback.candidates.map((candidate): TargetCoverageRecord => ({
      requirement: `feedback:${candidate.issueKind}->${candidate.layer}`,
      source: "feedback_route",
      status: "covered",
      mappedGateIds: [qualityGateId(candidate.issueKind), "gate-feedback-routing"],
      notes: [candidate.routingReason]
    })),
    {
      requirement: `artifact:${input.artifactDir}/${WORK_CHAPTER_QUALITY_GATE_FILE}`,
      source: "run_artifact",
      status: "covered",
      mappedGateIds: ["gate-runtime-artifacts"],
      notes: ["quality gates are generated by the runtime loop for this chapter"]
    }
  ];

  return {
    schemaVersion: "1.0.0",
    kind: "work_project_quality_gate_set",
    generatedAt,
    goal: input.chapterGoal ?? input.project.premise,
    packageName: input.pkg.name,
    packageVersion: input.pkg.version,
    sampleRoundCount: input.chapterNumber,
    readiness: input.quality.status,
    gates,
    coverage,
    summary: summarizeQualityGateSet(gates, coverage)
  };
}

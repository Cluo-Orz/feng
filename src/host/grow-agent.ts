import { ok, type Result } from "../domain/result.js";
import { domainErr } from "../domain/index.js";
import type { GrowUnitRef, MessageListRef } from "../domain/index.js";
import type { AttemptIntentRef } from "../agenda-dod-manager/index.js";
import { makeLLMRequestId, summarizeLLMUsage, type LLMUsageSummary } from "../llm-gateway/index.js";
import { makePolicyRequestId } from "../policy-boundary/index.js";
import {
  defaultContextPolicy,
  defaultCoveragePolicy,
  defaultFeedbackRouting,
  defaultHarness,
  defaultNovelTargetWorld,
  defaultQualityRules,
  defaultStoryModel,
  contextSectionKinds,
  feedbackLayers,
  savePackage,
  PACKAGE_SCHEMA_VERSION,
  qualityCheckKinds,
  type AgentHarness,
  type AuthoringRuntimePackage,
  type ContextSectionKind,
  type ContextSectionPolicy,
  type CoveragePolicy,
  type FeedbackLayer,
  type FeedbackRoutingRule,
  type QualityCheckKind,
  type QualityRule,
  type StoryModel,
  type TargetWorldContract,
  type WritingStrategy
} from "../runtime-package/index.js";
import type { FengHost } from "./runtime-host.js";

export interface GrowAgentInput {
  readonly goal: string;
  readonly name?: string;
  readonly version?: string;
}

export interface GrowAgentResult {
  readonly packagePath: string;
  readonly growUnitId: string;
  readonly contextMessageListRef?: MessageListRef;
  readonly designMessageListPath: string;
  readonly designTracePath: string;
  readonly readiness: string;
  readonly lifecycle: string;
  readonly strategyChars: number;
  readonly llmUsage: LLMUsageSummary;
}

const DESIGN_PROMPT = [
  "你是 feng 的通用 agent 设计内核。你要根据用户目标设计一个可复制、可运行、可验证的 agent 运行包。",
  "注意：你不是替目标 agent 完成最终任务，而是在设计该 agent 的目标世界、上下文策略、运行边界、质量门禁、反馈归因和系统提示。",
  "输出必须紧凑，避免长段解释；整个 JSON 尽量控制在 1800 个中文字符以内，防止被截断导致 grow 退回默认值。",
  "请只输出一个 JSON 对象，字段如下：",
  '{ "systemPrompt": string(目标 agent 的系统提示，12句以内；说明目标 agent 如何处理输入、产出核心结果、保持上下文和边界；不要把运行框架会写入文件的质量门禁/反馈报告强塞进正文输出), ',
  '"targetWorld": { "description": string, "inputKinds": string[], "outputKinds": string[], "actionBoundary": string[], "failureHandling": string[], "dialogueAllowed": boolean }, ',
  '"contextPolicy": { "kind": "observation"|"short_term"|"long_term"|"feedback", "title": string, "source": string, "maxChars": number }[](运行时 message list 的上下文分层策略), ',
  '"storyModel": { "trackedFacts": string[], "continuityDimensions": string[] }, ',
  '"harness": { "steps": string[] }, ',
  '"stylePrinciples": string[](3条以内目标 agent 的输出原则), "constraints": string[](5条以内硬性约束，含连续性、上下文、目标覆盖或目标世界边界要求), ',
  '"minChars": number(若目标 agent 产出长文本/章节，则给出单次正文字符下限；否则给出合理最小输出长度), "maxChars": number(若目标 agent 产出长文本/章节，则给出单次正文字符上限，需与你给的模型能力匹配), ',
  '"qualityRules": { "kind": string, "note": string }[](该 agent 自己认为当前目标必须检查的质量门禁维度，kind 只能取 length/chapter_continuity/year_consistency/character_continuation/geography_consistency/outline_continuity/artifact_presence/runtime_capability/goal_coverage/semantic_style/semantic_character/semantic_plot), ',
  '"feedbackRouting": { "issueKind": string, "layer": "work"|"capability"|"system", "reason": string }[](每类问题应该留在作品层、回流 agent 层还是提议给 feng 系统层), ',
  '"coveragePolicy": { "noMissingTopic": { "enabled": boolean, "gateId": string, "title": string, "evidenceRequired": string, "blockingUntilReviewed": boolean } } }',
  "targetWorld 必须说明该 agent 从作品项目接收什么、输出什么、动作边界和失败处理是什么。",
  "targetWorld.inputKinds 必须使用当前 runtime kernel 可读的 kind：premise,title,chapter_goal,prior_outline,prior_outlines,last_chapter_tail,character_bible,world_bible,author_feedback,reader_feedback,accepted_feedback。",
  "targetWorld.outputKinds 必须使用当前 runtime kernel 可产出的 kind：chapter_text,updated_outline,setting_conflicts,feedback_candidates；质量门禁和调试报告由 runtime 文件系统产出，不要写进 outputKinds。",
  "当前 authoring runtime kernel 不支持对话式输入；除非用户目标明确要求对话型 agent 并接受系统层阻塞，否则 targetWorld.dialogueAllowed 必须为 false。",
  "contextPolicy/storyModel/harness 必须说明该 agent 如何管理长篇上下文、长期事实、连续性维度和运行验证步骤。",
  "qualityRules 和 feedbackRouting 必须是本次 grow 针对当前目标 agent 产出的门禁与归因规则；不要只复述通用评分表。",
  "如果下游回流或历史采纳状态标明某 issueKind 是 capability feedback，feedbackRouting 必须继续把同类问题路由到 capability，除非明确升级为 system；不能降级为 work 本地问题。",
  "coveragePolicy 用来定义该 agent 在下游项目运行后必须产出的目标覆盖门禁；不能只依赖 prompt 自称已覆盖；gateId 必须匹配 gate-[a-z0-9-]+。",
  "如果目标 agent 的能力包括质量门禁、反馈候选、调试信息或上报信息，优先把它们设计为 runtime 文件/trace/feedback artifact，而不是混入最终正文或主产物。",
  "不得把某个具体下游项目的事实写成通用 agent 规则；作品事实应留在作品项目，能力问题才回流 agent。",
  "不要输出编号长句、解释性段落、Markdown 或注释；数组项必须短。",
  "不要输出 JSON 以外的任何文字。"
].join("\n");

export interface DesignedStrategy {
  readonly strategy: WritingStrategy;
  readonly targetWorld: TargetWorldContract;
  readonly contextPolicy: readonly ContextSectionPolicy[];
  readonly storyModel: StoryModel;
  readonly harness: AgentHarness;
  readonly minChars?: number;
  readonly maxChars?: number;
  readonly coveragePolicy: CoveragePolicy;
  readonly qualityRules: readonly QualityRule[];
  readonly feedbackRouting: readonly FeedbackRoutingRule[];
  readonly generatedFields: GeneratedDesignFields;
}

export interface GeneratedDesignFields {
  readonly targetWorld: boolean;
  readonly contextPolicy: boolean;
  readonly storyModel: boolean;
  readonly harness: boolean;
  readonly qualityRules: boolean;
  readonly feedbackRouting: boolean;
  readonly coveragePolicy: boolean;
}

const generatedDesignFieldNames = [
  "targetWorld",
  "contextPolicy",
  "storyModel",
  "harness",
  "qualityRules",
  "feedbackRouting",
  "coveragePolicy"
] as const;

function noGeneratedDesignFields(): GeneratedDesignFields {
  return {
    targetWorld: false,
    contextPolicy: false,
    storyModel: false,
    harness: false,
    qualityRules: false,
    feedbackRouting: false,
    coveragePolicy: false
  };
}

function missingGeneratedFields(fields: GeneratedDesignFields): readonly string[] {
  return generatedDesignFieldNames.filter((name) => fields[name] !== true);
}

function withGeneratedFields(designed: DesignedStrategy, generatedFields: GeneratedDesignFields): DesignedStrategy {
  return { ...designed, generatedFields };
}

export interface DesignStrategyInput {
  readonly goal?: string;
  readonly growUnitRef?: GrowUnitRef;
  readonly growUnitId?: string;
  readonly attemptIntentRef?: AttemptIntentRef;
  readonly attemptLabel?: string;
  readonly feedbackContext?: string;
}

export interface DesignStrategyResult {
  readonly designed: DesignedStrategy;
  readonly raw: string;
  readonly contextMessageListRef?: MessageListRef;
  readonly messageListPath: string;
  readonly modelOutputPath: string;
  readonly tracePath: string;
  readonly llmUsage: LLMUsageSummary;
}

function descriptors(host: FengHost, reason: string) {
  const at = new Date().toISOString();
  return {
    source: { kind: "system" as const, origin: "feng-grow-agent", userProvided: false, receivedAt: at, privacyLevel: "workspace_private" as const },
    version: { schemaVersion: "1.0.0", producerVersion: "feng-grow-agent" },
    audit: { createdAt: at, createdBy: "feng-grow-agent", reason }
  };
}

function extractJson(text: string): Record<string, unknown> | undefined {
  const fenced = text.replace(/```json/gi, "```").split("```");
  const candidates = [text, ...fenced];
  for (const candidate of candidates) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return undefined;
}

function parsePositiveInt(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeGateId(value: unknown): string | undefined {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (candidate.length === 0) return undefined;
  if (/^gate-[a-z0-9-]+$/.test(candidate)) return candidate;
  const body = candidate.toLowerCase().startsWith("gate-") ? candidate.slice(5) : candidate;
  const normalized = body.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized.length === 0 ? undefined : `gate-${normalized}`;
}

function gateIdOr(value: unknown, fallback: string): string {
  return normalizeGateId(value) ?? fallback;
}

function validGateId(value: unknown): boolean {
  return normalizeGateId(value) !== undefined;
}

function stringArrayOr(value: unknown, fallback: readonly string[]): readonly string[] {
  const items = Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item.trim() : "").filter((item) => item.length > 0)
    : [];
  return items.length === 0 ? fallback : [...new Set(items)];
}

function isQualityCheckKind(value: string): value is QualityCheckKind {
  return (qualityCheckKinds as readonly string[]).includes(value);
}

function isFeedbackLayer(value: string): value is FeedbackLayer {
  return (feedbackLayers as readonly string[]).includes(value);
}

function isContextSectionKind(value: string): value is ContextSectionKind {
  return (contextSectionKinds as readonly string[]).includes(value);
}

function maxCharsOr(value: unknown, fallback: number): number {
  const parsed = parsePositiveInt(value);
  if (parsed === undefined) return fallback;
  return Math.max(200, Math.min(parsed, 12_000));
}

function defaultQualityRule(kind: QualityCheckKind): QualityRule | undefined {
  return defaultQualityRules.find((rule) => rule.kind === kind);
}

function packageQualityRules(rules: readonly QualityRule[], length: { readonly minChars: number; readonly maxChars: number }): readonly QualityRule[] {
  const byKind = new Map<QualityCheckKind, QualityRule>();
  for (const rule of rules) byKind.set(rule.kind, rule);
  if (!byKind.has("length")) byKind.set("length", { kind: "length", note: "每章中文字数区间(由 agent grow 得出)" });
  if (!byKind.has("artifact_presence")) byKind.set("artifact_presence", defaultQualityRule("artifact_presence") ?? { kind: "artifact_presence", note: "每章须有 file-native 运行记录" });
  return [...byKind.values()].map((rule): QualityRule => {
    if (rule.kind !== "length") return rule;
    return {
      ...rule,
      minChars: length.minChars,
      maxChars: length.maxChars,
      note: rule.note ?? "每章中文字数区间(由 agent grow 得出)"
    };
  });
}

function toQualityRules(parsed: Record<string, unknown> | undefined, length: { readonly minChars: number; readonly maxChars: number }): readonly QualityRule[] {
  const rawRules = Array.isArray(parsed?.qualityRules) ? parsed.qualityRules : [];
  const rules: QualityRule[] = [];
  for (const raw of rawRules) {
    const item = recordOf(raw);
    const kind = typeof item?.kind === "string" && isQualityCheckKind(item.kind) ? item.kind : undefined;
    if (kind === undefined || rules.some((rule) => rule.kind === kind)) continue;
    const note = typeof item?.note === "string" && item.note.trim().length > 0
      ? item.note.trim()
      : defaultQualityRule(kind)?.note;
    rules.push({ kind, ...(note === undefined ? {} : { note }) });
  }
  return packageQualityRules(rules.length === 0 ? defaultQualityRules : rules, length);
}

function defaultRoute(issueKind: string): FeedbackRoutingRule | undefined {
  return defaultFeedbackRouting.find((rule) => rule.issueKind === issueKind);
}

function toFeedbackRouting(
  parsed: Record<string, unknown> | undefined,
  qualityRules: readonly QualityRule[]
): readonly FeedbackRoutingRule[] {
  const rawRoutes = Array.isArray(parsed?.feedbackRouting) ? parsed.feedbackRouting : [];
  const routes: FeedbackRoutingRule[] = [];
  for (const raw of rawRoutes) {
    const item = recordOf(raw);
    const issueKind = typeof item?.issueKind === "string" && item.issueKind.trim().length > 0 ? item.issueKind.trim() : undefined;
    const layer = typeof item?.layer === "string" && isFeedbackLayer(item.layer) ? item.layer : undefined;
    if (issueKind === undefined || layer === undefined || routes.some((route) => route.issueKind === issueKind)) continue;
    const fallbackReason = defaultRoute(issueKind)?.reason ?? "由本次 grow 产出的反馈归因规则";
    routes.push({ issueKind, layer, reason: stringOr(item?.reason, fallbackReason) });
  }
  const baseRoutes = routes.length === 0 ? [...defaultFeedbackRouting] : routes;
  const byKind = new Map<string, FeedbackRoutingRule>();
  for (const route of baseRoutes) byKind.set(route.issueKind, route);
  for (const rule of qualityRules) {
    if (byKind.has(rule.kind)) continue;
    const fallback = defaultRoute(rule.kind);
    byKind.set(rule.kind, fallback ?? { issueKind: rule.kind, layer: "work", reason: "未能归因的问题默认留在作品项目，等待后续 grow 或人工判断" });
  }
  return [...byKind.values()];
}

function toCoveragePolicy(parsed: Record<string, unknown> | undefined): CoveragePolicy {
  const base = defaultCoveragePolicy.noMissingTopic;
  const coverage = recordOf(parsed?.coveragePolicy);
  const noMissingTopic = recordOf(coverage?.noMissingTopic);
  return {
    noMissingTopic: {
      enabled: booleanOr(noMissingTopic?.enabled, base.enabled),
      gateId: gateIdOr(noMissingTopic?.gateId, base.gateId),
      sourceKind: "chapter_goal",
      title: stringOr(noMissingTopic?.title, base.title),
      evidenceRequired: stringOr(noMissingTopic?.evidenceRequired, base.evidenceRequired),
      promptOnlyAllowed: false,
      blockingUntilReviewed: booleanOr(noMissingTopic?.blockingUntilReviewed, base.blockingUntilReviewed)
    }
  };
}

function hasGeneratedCoveragePolicy(parsed: Record<string, unknown> | undefined): boolean {
  const coverage = recordOf(parsed?.coveragePolicy);
  const noMissingTopic = recordOf(coverage?.noMissingTopic);
  return noMissingTopic !== undefined &&
    typeof noMissingTopic.enabled === "boolean" &&
    validGateId(noMissingTopic.gateId) &&
    typeof noMissingTopic.title === "string" &&
    noMissingTopic.title.trim().length > 0 &&
    typeof noMissingTopic.evidenceRequired === "string" &&
    noMissingTopic.evidenceRequired.trim().length > 0 &&
    typeof noMissingTopic.blockingUntilReviewed === "boolean";
}

function toTargetWorld(parsed: Record<string, unknown> | undefined): TargetWorldContract {
  const raw = recordOf(parsed?.targetWorld);
  const inputKinds = stringArrayOr(raw?.inputKinds, defaultNovelTargetWorld.inputKinds);
  const outputKinds = stringArrayOr(raw?.outputKinds, defaultNovelTargetWorld.outputKinds);
  return {
    description: stringOr(raw?.description, defaultNovelTargetWorld.description),
    inputKinds,
    outputKinds,
    actionBoundary: stringArrayOr(raw?.actionBoundary, defaultNovelTargetWorld.actionBoundary),
    failureHandling: stringArrayOr(raw?.failureHandling, defaultNovelTargetWorld.failureHandling),
    dialogueAllowed: booleanOr(raw?.dialogueAllowed, defaultNovelTargetWorld.dialogueAllowed)
  };
}

function toContextPolicy(parsed: Record<string, unknown> | undefined): readonly ContextSectionPolicy[] {
  const rawItems = Array.isArray(parsed?.contextPolicy) ? parsed.contextPolicy : [];
  const byKind = new Map<ContextSectionKind, ContextSectionPolicy>();
  for (const raw of rawItems) {
    const item = recordOf(raw);
    const kind = typeof item?.kind === "string" && isContextSectionKind(item.kind) ? item.kind : undefined;
    if (kind === undefined || byKind.has(kind)) continue;
    const fallback = defaultContextPolicy.find((policy) => policy.kind === kind);
    byKind.set(kind, {
      kind,
      title: stringOr(item?.title, fallback?.title ?? kind),
      source: stringOr(item?.source, fallback?.source ?? "grown context policy"),
      maxChars: maxCharsOr(item?.maxChars, fallback?.maxChars ?? 1200)
    });
  }
  if (byKind.size === 0) return defaultContextPolicy;
  for (const fallback of defaultContextPolicy) {
    if (!byKind.has(fallback.kind)) byKind.set(fallback.kind, fallback);
  }
  return defaultContextPolicy.map((fallback) => byKind.get(fallback.kind) ?? fallback);
}

function toStoryModel(parsed: Record<string, unknown> | undefined): StoryModel {
  const raw = recordOf(parsed?.storyModel);
  return {
    trackedFacts: stringArrayOr(raw?.trackedFacts, defaultStoryModel.trackedFacts),
    continuityDimensions: stringArrayOr(raw?.continuityDimensions, defaultStoryModel.continuityDimensions)
  };
}

function toHarness(parsed: Record<string, unknown> | undefined): AgentHarness {
  const raw = recordOf(parsed?.harness);
  return {
    steps: stringArrayOr(raw?.steps, defaultHarness.steps)
  };
}

function toStrategy(parsed: Record<string, unknown> | undefined, fallbackGoal: string): DesignedStrategy {
  const systemPrompt = typeof parsed?.systemPrompt === "string" && parsed.systemPrompt.length > 0
    ? parsed.systemPrompt
    : `你是一个连载中文小说写作 agent。目标：${fallbackGoal}。逐章写作，保持设定、人物、年份、地点与情节连贯；每章输出正文，然后另起一行 ===OUTLINE===，再用一句话概括本章。`;
  const stylePrinciples = Array.isArray(parsed?.stylePrinciples) ? parsed.stylePrinciples.filter((p): p is string => typeof p === "string") : [];
  const constraints = Array.isArray(parsed?.constraints) ? parsed.constraints.filter((c): c is string => typeof c === "string") : [];
  const min = parsePositiveInt(parsed?.minChars);
  const max = parsePositiveInt(parsed?.maxChars);
  const length = grownLengthRule(min, max);
  const qualityRules = toQualityRules(parsed, length);
  const targetWorld = toTargetWorld(parsed);
  const contextPolicy = toContextPolicy(parsed);
  const storyModel = toStoryModel(parsed);
  const harness = toHarness(parsed);
  const coveragePolicy = toCoveragePolicy(parsed);
  return {
    strategy: { systemPrompt, stylePrinciples, constraints },
    targetWorld,
    contextPolicy,
    storyModel,
    harness,
    ...(min === undefined ? {} : { minChars: min }),
    ...(max === undefined ? {} : { maxChars: max }),
    coveragePolicy,
    qualityRules,
    feedbackRouting: toFeedbackRouting(parsed, qualityRules),
    generatedFields: {
      targetWorld: recordOf(parsed?.targetWorld) !== undefined,
      contextPolicy: Array.isArray(parsed?.contextPolicy) && parsed.contextPolicy.length > 0,
      storyModel: recordOf(parsed?.storyModel) !== undefined,
      harness: recordOf(parsed?.harness) !== undefined,
      qualityRules: Array.isArray(parsed?.qualityRules) && parsed.qualityRules.length > 0,
      feedbackRouting: Array.isArray(parsed?.feedbackRouting) && parsed.feedbackRouting.length > 0,
      coveragePolicy: hasGeneratedCoveragePolicy(parsed)
    }
  };
}

function safePathSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "attempt";
}

function designAttemptDir(input: DesignStrategyInput): string {
  const growUnit = input.growUnitRef?.id ?? input.growUnitId;
  const segment = growUnit === undefined ? "standalone" : safePathSegment(growUnit);
  const label = safePathSegment(input.attemptLabel ?? "initial");
  return `.feng/grow-agent/design-attempts/${segment}/${label}`;
}

function designGrowUnitId(input: DesignStrategyInput): string | undefined {
  return input.growUnitRef?.id ?? input.growUnitId;
}

async function compileGrowDesignContext(
  host: FengHost,
  input: DesignStrategyInput,
  meta: ReturnType<typeof descriptors>
): Promise<Result<MessageListRef | undefined>> {
  if (input.growUnitRef === undefined) return ok(undefined);
  const compiled = await host.contextCompiler.compileMessageList({
    growUnitRef: input.growUnitRef,
    ...(input.attemptIntentRef === undefined ? {} : { attemptIntentRef: input.attemptIntentRef }),
    compileReason: "compile grow-agent design context",
    source: meta.source,
    version: meta.version,
    audit: meta.audit,
    skillBodyMode: "summary_only"
  });
  return compiled.ok ? ok(compiled.value) : compiled;
}

async function contextMessageText(host: FengHost, ref: MessageListRef | undefined): Promise<Result<string | undefined>> {
  if (ref === undefined) return ok(undefined);
  const explained = await host.contextCompiler.explainMessageList(ref);
  if (!explained.ok) return explained;
  const materialized = await host.artifacts.materializeArtifact(explained.value.compileReport.artifactRef, {
    reason: "read grow-agent design context message list",
    allowArchived: true,
    maxBytes: 512 * 1024
  });
  if (!materialized.ok) return materialized;
  if (materialized.value.status !== "available" || typeof materialized.value.content !== "string") return ok(undefined);
  try {
    const parsed = JSON.parse(materialized.value.content) as {
      readonly providerNeutralMessages?: readonly { readonly content?: readonly { readonly text?: string }[] }[];
    };
    const text = (parsed.providerNeutralMessages ?? [])
      .flatMap((message) => message.content ?? [])
      .map((part) => part.text ?? "")
      .filter((part) => part.length > 0)
      .join("\n\n");
    return ok(text.length === 0 ? undefined : text.slice(0, 12_000));
  } catch {
    return ok(undefined);
  }
}

function isLengthRangeConstraint(constraint: string): boolean {
  const compact = constraint.replace(/\s+/g, "");
  const hasLengthTerm = /字数|字符数|正文长度|输出长度|章节长度|单章正文|每章正文|正文字符|章节字符/.test(compact);
  const hasLengthUnitRange = /\d{2,5}(?:-|~|～|至|到)\d{2,5}(?:字|字符)/.test(compact);
  return hasLengthUnitRange || (hasLengthTerm && /\d{2,5}.*\d{2,5}/.test(compact));
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function withCanonicalLengthConstraint(
  strategy: WritingStrategy,
  length: { readonly minChars: number; readonly maxChars: number }
): WritingStrategy {
  const canonical = `正文长度必须满足 qualityRules.length：${length.minChars}-${length.maxChars} 字符。`;
  const constraints = uniqueStrings([
    ...strategy.constraints.filter((constraint) => !isLengthRangeConstraint(constraint)),
    canonical
  ]);
  return { ...strategy, constraints };
}

// The grown agent owns its own length contract. Clamp to sane bounds and ensure
// min < max so a malformed design cannot produce an impossible DoD.
export function grownLengthRule(min: number | undefined, max: number | undefined): { readonly minChars: number; readonly maxChars: number } {
  const lo = Math.max(300, Math.min(min ?? 900, 4000));
  const hi = Math.max(lo + 300, Math.min(max ?? 1500, 8000));
  return { minChars: lo, maxChars: hi };
}

export interface BuildPackageInput {
  readonly name: string;
  readonly version: string;
  readonly locked: boolean;
  readonly strategy: WritingStrategy;
  readonly targetWorld?: TargetWorldContract;
  readonly contextPolicy?: readonly ContextSectionPolicy[];
  readonly storyModel?: StoryModel;
  readonly harness?: AgentHarness;
  readonly coveragePolicy?: CoveragePolicy;
  readonly qualityRules?: readonly QualityRule[];
  readonly feedbackRouting?: readonly FeedbackRoutingRule[];
  readonly minChars?: number;
  readonly maxChars?: number;
  readonly grownInProject: string;
  readonly grownByGrowUnitId?: string;
  readonly readiness: "ready" | "draft";
  readonly evidenceSummary: string;
  readonly qualityGateRef?: string;
  readonly targetCoverageRef?: string;
  readonly qualityGateSummary?: string;
  readonly sampleEvidenceRefs?: readonly string[];
  readonly model: string;
  readonly provider: string;
}

export function buildAuthoringPackage(input: BuildPackageInput): AuthoringRuntimePackage {
  const length = grownLengthRule(input.minChars, input.maxChars);
  const qualityRules = packageQualityRules(input.qualityRules ?? defaultQualityRules, length);
  const strategy = withCanonicalLengthConstraint(input.strategy, length);
  return {
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    packageId: `pkg-${input.grownByGrowUnitId ?? input.name}-${input.version}`,
    name: input.name,
    kind: "serialized_authoring_agent",
    version: input.version,
    locked: input.locked,
    runEntry: "feng run",
    targetWorld: input.targetWorld ?? defaultNovelTargetWorld,
    contextPolicy: input.contextPolicy ?? defaultContextPolicy,
    writingStrategy: strategy,
    storyModel: input.storyModel ?? defaultStoryModel,
    harness: input.harness ?? defaultHarness,
    coveragePolicy: input.coveragePolicy ?? defaultCoveragePolicy,
    qualityRules,
    feedbackRouting: input.feedbackRouting ?? defaultFeedbackRouting,
    validation: {
      readiness: input.readiness,
      grownInProject: input.grownInProject,
      ...(input.grownByGrowUnitId === undefined ? {} : { grownByGrowUnitId: input.grownByGrowUnitId }),
      ...(input.qualityGateRef === undefined ? {} : { qualityGateRef: input.qualityGateRef }),
      ...(input.targetCoverageRef === undefined ? {} : { targetCoverageRef: input.targetCoverageRef }),
      ...(input.qualityGateSummary === undefined ? {} : { qualityGateSummary: input.qualityGateSummary }),
      ...(input.sampleEvidenceRefs === undefined ? {} : { sampleEvidenceRefs: input.sampleEvidenceRefs }),
      evidenceSummary: input.evidenceSummary,
      checkedAt: new Date().toISOString()
    },
    provenance: { model: input.model, provider: input.provider, hatchedAt: new Date().toISOString() }
  };
}

export async function designStrategy(host: FengHost, input: DesignStrategyInput = {}): Promise<Result<DesignStrategyResult>> {
  const meta = descriptors(host, "design writing strategy");
  const goal = input.goal ?? "成长出一个可复制、可运行、可验证的 agent";
  const dir = designAttemptDir(input);
  const messageListPath = `${dir}/message-list.json`;
  const modelOutputPath = `${dir}/model-output.json`;
  const tracePath = `${dir}/trace.json`;
  const contextRef = await compileGrowDesignContext(host, input, meta);
  if (!contextRef.ok) return contextRef;
  const contextText = await contextMessageText(host, contextRef.value);
  if (!contextText.ok) return contextText;
  const messages = [
    { role: "system" as const, content: [{ type: "text" as const, text: DESIGN_PROMPT }] },
    ...(contextText.value === undefined ? [] : [{
      role: "user" as const,
      content: [{ type: "text" as const, text: `【当前 grow 状态投影】\n${contextText.value}` }]
    }]),
    ...(input.feedbackContext === undefined || input.feedbackContext.trim().length === 0 ? [] : [{
      role: "user" as const,
      content: [{ type: "text" as const, text: `【下游回流与历史采纳状态】\n${input.feedbackContext.slice(0, 12_000)}` }]
    }]),
    { role: "user" as const, content: [{ type: "text" as const, text: `【用户目标】\n${goal}\n\n请根据这个目标输出紧凑、完整、可解析的 agent 策略 JSON。不要解释。` }] }
  ];
  const wroteMessageList = await host.store.writeTextAtomic(host.workspace, messageListPath, JSON.stringify({
    schemaVersion: "1.0.0",
    kind: "grow_design_message_list",
    ...(designGrowUnitId(input) === undefined ? {} : { growUnitId: designGrowUnitId(input) }),
    ...(input.attemptIntentRef === undefined ? {} : { attemptIntentRef: input.attemptIntentRef }),
    ...(contextRef.value === undefined ? {} : { contextMessageListRef: contextRef.value }),
    goal,
    messages,
    sourceSummary: [
      "design prompt asks the model to grow writing strategy",
      "targetWorld contract must be generated as part of the agent design",
      "contextPolicy, storyModel and harness must be generated as part of the agent design",
      "qualityRules and feedbackRouting must be generated as part of the agent design",
      "coveragePolicy must be generated as part of the agent design",
      "prompt-only target coverage is not allowed",
      ...(input.feedbackContext === undefined || input.feedbackContext.trim().length === 0 ? [] : ["downstream feedback seeds are included before the LLM design call"])
    ],
    ...(input.feedbackContext === undefined || input.feedbackContext.trim().length === 0 ? {} : { feedbackContextChars: input.feedbackContext.length }),
    compiledAt: new Date().toISOString()
  }, null, 2), {
    reason: "write grow design message list",
    createParents: true
  });
  if (!wroteMessageList.ok) return wroteMessageList;
  const decision = await host.policy.evaluateAction({
    requestId: makePolicyRequestId(`grow-agent-net-${Date.now()}`),
    capability: "network.request",
    requestedByModule: "feng-grow-agent",
    workspace: host.workspace.id,
    resourceSummary: `provider:${host.config.provider.provider}`,
    operation: "send",
    reason: "design writing strategy",
    source: meta.source
  }, {
    caller: "feng-grow-agent",
    environment: { hostSandboxAvailable: false, networkAvailable: true, externalEnforcementAvailable: false, secretStoreAvailable: false },
    rules: [{ capability: "network.request", resource: "*", verdict: "allow" }]
  });
  if (!decision.ok) {
    const wroteTrace = await host.store.writeTextAtomic(host.workspace, tracePath, JSON.stringify({
      schemaVersion: "1.0.0",
      kind: "grow_design_attempt_trace",
      status: "failed",
      stage: "policy",
      ...(designGrowUnitId(input) === undefined ? {} : { growUnitId: designGrowUnitId(input) }),
      ...(input.attemptIntentRef === undefined ? {} : { attemptIntentRef: input.attemptIntentRef }),
      ...(contextRef.value === undefined ? {} : { contextMessageListRef: contextRef.value }),
      goal,
      messageListPath,
      error: { code: decision.error.code, message: decision.error.message },
      tracedAt: new Date().toISOString()
    }, null, 2), { reason: "write policy-failed grow design trace", createParents: true });
    if (!wroteTrace.ok) return wroteTrace;
    return decision;
  }
  const response = await host.llmGateway.sendLLMRequest({
    requestId: makeLLMRequestId(`grow-agent-design-${Date.now()}`),
    providerNeutralMessages: messages,
    modelSelection: { provider: host.config.provider.provider, model: host.config.provider.model },
    requiredCapabilities: {},
    streaming: false,
    timeoutMs: 180_000,
    policyDecisionId: decision.value.policyDecisionId,
    source: meta.source,
    version: meta.version,
    audit: meta.audit
  });
  if (!response.ok) {
    const wroteTrace = await host.store.writeTextAtomic(host.workspace, tracePath, JSON.stringify({
      schemaVersion: "1.0.0",
      kind: "grow_design_attempt_trace",
      status: "failed",
      stage: "llm",
      ...(designGrowUnitId(input) === undefined ? {} : { growUnitId: designGrowUnitId(input) }),
      ...(input.attemptIntentRef === undefined ? {} : { attemptIntentRef: input.attemptIntentRef }),
      ...(contextRef.value === undefined ? {} : { contextMessageListRef: contextRef.value }),
      goal,
      messageListPath,
      error: { code: response.error.code, message: response.error.message },
      tracedAt: new Date().toISOString()
    }, null, 2), { reason: "write failed grow design trace", createParents: true });
    if (!wroteTrace.ok) return wroteTrace;
    return response;
  }
  const raw = response.value.contentBlocks.filter((b) => b.type === "text").map((b) => (b as { text?: string }).text ?? "").join("\n").trim();
  const parsedJson = extractJson(raw);
  const parseOk = parsedJson !== undefined;
  const finishReason = response.value.finishReason;
  const finishOk = finishReason === "stop";
  const parsedDesign = toStrategy(parsedJson, goal);
  const designed = finishOk ? parsedDesign : withGeneratedFields(parsedDesign, noGeneratedDesignFields());
  const missingFields = missingGeneratedFields(designed.generatedFields);
  const designStatus = parseOk && finishOk && missingFields.length === 0 ? "completed" : "incomplete";
  const incompleteReasons = [
    ...(parseOk ? [] : ["model output did not contain parseable strategy JSON"]),
    ...(finishOk ? [] : [`model finishReason=${finishReason}`]),
    ...missingFields.map((field) => `missing generated field:${field}`)
  ];
  const llmUsage = summarizeLLMUsage([{ phase: "grow_design", usage: response.value.usage }]);
  const wroteOutput = await host.store.writeTextAtomic(host.workspace, modelOutputPath, JSON.stringify({
    schemaVersion: "1.0.0",
    kind: "grow_design_model_output",
    ...(contextRef.value === undefined ? {} : { contextMessageListRef: contextRef.value }),
    finishReason,
    parseOk,
    designStatus,
    missingGeneratedFields: missingFields,
    incompleteReasons,
    usage: response.value.usage,
    llmUsage,
    raw,
    parsed: designed,
    writtenAt: new Date().toISOString()
  }, null, 2), { reason: "write grow design model output", createParents: true });
  if (!wroteOutput.ok) return wroteOutput;
  const wroteTrace = await host.store.writeTextAtomic(host.workspace, tracePath, JSON.stringify({
    schemaVersion: "1.0.0",
    kind: "grow_design_attempt_trace",
    status: designStatus,
    ...(designGrowUnitId(input) === undefined ? {} : { growUnitId: designGrowUnitId(input) }),
    ...(input.attemptIntentRef === undefined ? {} : { attemptIntentRef: input.attemptIntentRef }),
    ...(contextRef.value === undefined ? {} : { contextMessageListRef: contextRef.value }),
    goal,
    messageListPath,
    modelOutputPath,
    finishReason,
    parseOk,
    missingGeneratedFields: missingFields,
    incompleteReasons,
    targetWorldInputKinds: designed.targetWorld.inputKinds,
    targetWorldOutputKinds: designed.targetWorld.outputKinds,
    contextSections: designed.contextPolicy.map((policy) => `${policy.kind}:${policy.maxChars}`),
    storyContinuityDimensions: designed.storyModel.continuityDimensions,
    harnessSteps: designed.harness.steps,
    coveragePolicyGateId: designed.coveragePolicy.noMissingTopic.gateId,
    generatedFields: designed.generatedFields,
    qualityRuleKinds: designed.qualityRules.map((rule) => rule.kind),
    feedbackRoutingKinds: designed.feedbackRouting.map((route) => `${route.issueKind}->${route.layer}`),
    promptOnlyAllowed: designed.coveragePolicy.noMissingTopic.promptOnlyAllowed,
    llmUsage,
    cacheHitRatePct: llmUsage.cacheHitRatePct,
    ...(input.feedbackContext === undefined || input.feedbackContext.trim().length === 0 ? {} : { feedbackContextChars: input.feedbackContext.length }),
    tracedAt: new Date().toISOString()
  }, null, 2), { reason: "write grow design trace", createParents: true });
  if (!wroteTrace.ok) return wroteTrace;
  return ok({
    designed,
    raw,
    ...(contextRef.value === undefined ? {} : { contextMessageListRef: contextRef.value }),
    messageListPath,
    modelOutputPath,
    tracePath,
    llmUsage
  });
}

export async function growXiaoshuoAgent(host: FengHost, input: GrowAgentInput): Promise<Result<GrowAgentResult>> {
  const meta = descriptors(host, "grow xiaoshuo agent");
  const name = input.name ?? "xiaoshuo";
  const grow = await host.grow.createGrowUnit({
    title: name,
    goalBoundarySummary: input.goal,
    targetBehaviorSummary: "接收作品设定/前情/反馈，输出连贯章节与大纲，并形成反馈候选。",
    source: meta.source, version: meta.version, audit: meta.audit
  });
  if (!grow.ok) return grow;
  const agenda = await host.agenda.createAgenda(grow.value, {
    goalBoundarySummary: input.goal, currentFocus: "设计并验证小说写作 agent 的运行策略",
    source: meta.source, version: meta.version, audit: meta.audit
  });
  if (!agenda.ok) return agenda;
  const dod = await host.agenda.defineDoD(grow.value, {
    statement: "写作 agent 能在作品项目中产出连贯、设定一致、字数达标的章节，并形成可归因反馈。",
    scope: "xiaoshuo runtime hatch gate",
    evidenceRequirement: "存在已验证的写作策略、样例运行、质量门禁和反馈契约",
    validationIntent: "sample run + structural quality checks",
    source: meta.source, version: meta.version, audit: meta.audit
  });
  if (!dod.ok) return dod;

  const intent = await host.agenda.buildAttemptIntent(grow.value, {
    purpose: "Design the xiaoshuo runtime package strategy, coverage policy, and length contract as JSON.",
    toolNeedSummary: "LLM design call only; no external tools are required for this attempt.",
    policyBoundarySummary: "May call the configured LLM provider; must write file-native message-list, model-output, and trace artifacts.",
    stopCondition: "A parseable strategy JSON with coveragePolicy and sane length bounds is produced or a failure trace is written.",
    source: meta.source,
    audit: meta.audit
  });
  if (!intent.ok) return intent;

  const designed = await designStrategy(host, { growUnitRef: grow.value, attemptIntentRef: intent.value, goal: input.goal, attemptLabel: "initial" });
  if (!designed.ok) return designed;

  // Advance beyond intake, but do not claim ready_to_hatch from a design-only
  // attempt. Readiness requires the loop path's sample runs and quality gates.
  for (const to of ["planning", "growing", "verifying"] as const) {
    const moved = await host.grow.transitionGrowUnit(grow.value, { to, reason: `advance to ${to} while growing the agent`, source: meta.source, audit: meta.audit });
    if (!moved.ok) return moved;
  }

  const evidence = await host.evidence.recordEvidenceCandidate({
    growUnitRef: grow.value,
    sourceKind: "candidate_output",
    summary: "design-only candidate writing strategy and contracts for the xiaoshuo runtime; sample validation is still required before hatch",
    content: JSON.stringify({
      designed: designed.value.designed,
      artifacts: {
        messageListPath: designed.value.messageListPath,
        modelOutputPath: designed.value.modelOutputPath,
        tracePath: designed.value.tracePath
      }
    }, null, 2),
    artifactKind: "candidate_output",
    relationHints: [{ relation: "supports", relatedDoDRef: dod.value, criticality: "normal", reason: "design candidate supports the hatch DoD but does not satisfy sample-run readiness by itself" }],
    quality: { trustLevel: "weak" },
    source: meta.source, version: meta.version, audit: meta.audit
  });
  if (!evidence.ok) return evidence;
  const accepted = await host.evidence.acceptEvidenceForEvaluation(evidence.value, { reason: "accept grown strategy", source: meta.source, audit: meta.audit });
  if (!accepted.ok) return accepted;
  const finalRecord = await host.grow.getGrowUnit(grow.value);
  const lifecycle = finalRecord.ok ? finalRecord.value.lifecycle : "unknown";

  const pkg: AuthoringRuntimePackage = {
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    packageId: `pkg-${grow.value.id}`,
    name,
    kind: "serialized_authoring_agent",
    version: input.version ?? "1.0.0",
    locked: false,
    runEntry: "feng run",
    targetWorld: designed.value.designed.targetWorld,
    contextPolicy: designed.value.designed.contextPolicy,
    writingStrategy: designed.value.designed.strategy,
    storyModel: designed.value.designed.storyModel,
    harness: designed.value.designed.harness,
    coveragePolicy: designed.value.designed.coveragePolicy,
    qualityRules: designed.value.designed.qualityRules,
    feedbackRouting: designed.value.designed.feedbackRouting,
    validation: {
      readiness: "draft",
      grownInProject: host.config.workspaceRoot,
      grownByGrowUnitId: grow.value.id,
      evidenceSummary: "design-only draft; run grow-agent --loop to produce sample-run evidence, quality gates, and a locked hatch package",
      checkedAt: new Date().toISOString()
    },
    provenance: { model: host.config.provider.model, provider: host.config.provider.provider, hatchedAt: new Date().toISOString() }
  };
  const saved = await savePackage(host.store, host.workspace, pkg);
  if (!saved.ok) return saved;
  if (designed.value.designed.strategy.systemPrompt.length === 0) {
    return domainErr({ module: "feng-grow-agent", code: "invalid_state", message: "grown strategy is empty", severity: "error" });
  }
  return ok({
    packagePath: saved.value,
    growUnitId: grow.value.id,
    ...(designed.value.contextMessageListRef === undefined ? {} : { contextMessageListRef: designed.value.contextMessageListRef }),
    designMessageListPath: designed.value.messageListPath,
    designTracePath: designed.value.tracePath,
    readiness: "draft",
    lifecycle,
    strategyChars: designed.value.designed.strategy.systemPrompt.length,
    llmUsage: designed.value.llmUsage
  });
}

import type { ProviderNeutralMessage } from "../context-message-compiler/index.js";
import type { AuthoringRuntimePackage, ContextSectionKind } from "../runtime-package/index.js";

export interface AuthoringRunState {
  readonly premise: string;
  readonly title: string;
  readonly chapterNumber: number;
  readonly chapterGoal?: string;
  readonly priorOutlines: readonly string[];
  readonly lastChapterTail?: string;
  readonly characterBible?: string;
  readonly worldBible?: string;
  readonly acceptedFeedback?: readonly string[];
}

export interface CompiledSection {
  readonly kind: ContextSectionKind;
  readonly title: string;
  readonly source: string;
  readonly charsUsed: number;
  readonly content: string;
}

export interface CompiledMessageList {
  readonly chapterNumber: number;
  readonly sections: readonly CompiledSection[];
  readonly systemPrompt: string;
  readonly systemPromptChars: number;
  readonly cachePrefix: string;
  readonly cachePrefixChars: number;
  readonly stablePrefixMessageCount: number;
  readonly coveragePolicy?: {
    readonly noMissingTopicGateId: string;
    readonly promptOnlyAllowed: boolean;
    readonly blockingUntilReviewed: boolean;
  };
  readonly compiledAt: string;
}

function sectionContent(state: AuthoringRunState, kind: ContextSectionKind): string {
  if (kind === "observation") {
    const goal = state.chapterGoal === undefined || state.chapterGoal.length === 0
      ? `请创作第 ${state.chapterNumber} 章，自然推进剧情。`
      : state.chapterGoal;
    return `【小说设定】\n${state.premise}\n\n【本章目标】\n${goal}`;
  }
  if (kind === "short_term") {
    const outline = state.priorOutlines.length === 0
      ? "（这是第一章，暂无前情）"
      : state.priorOutlines.map((o, i) => `第${i + 1}章：${o}`).join("\n");
    const tail = state.lastChapterTail === undefined || state.lastChapterTail.length === 0
      ? ""
      : `\n\n【上一章结尾】\n${state.lastChapterTail}`;
    return `【前情大纲】\n${outline}${tail}`;
  }
  if (kind === "long_term") {
    const parts: string[] = [];
    if (state.characterBible && state.characterBible.length > 0) parts.push(`【人物设定】\n${state.characterBible}`);
    if (state.worldBible && state.worldBible.length > 0) parts.push(`【世界设定】\n${state.worldBible}`);
    return parts.length === 0 ? "（暂无长期设定）" : parts.join("\n\n");
  }
  const feedback = state.acceptedFeedback ?? [];
  return feedback.length === 0 ? "（暂无已采纳反馈）" : `【需遵循的反馈】\n${feedback.map((f) => `- ${f}`).join("\n")}`;
}

const AUTHORING_RUNTIME_STABLE_PROTOCOL = [
  "【稳定运行契约】",
  "你正在作为一个已 hatch 的写作 agent 运行。运行包的系统提示、写作原则、硬性约束、目标世界、质量门禁和反馈路由都属于稳定前缀，应在同一作品项目的多章运行中保持不变。",
  "动态材料只包括本章目标、前情摘要、上一章尾部、作者本轮反馈和需要修订的上一稿。不要把动态材料改写进稳定契约，也不要把稳定契约复制进正文。",
  "写作时必须先在内部对照稳定作品上下文和本章动态输入，再输出正文。正文必须推进事件、角色选择或冲突，而不是只复述设定、目标或质量规则。",
  "输出格式固定：先输出章节正文；随后另起一行输出 ===OUTLINE===；最后用一句话概括本章后续前情。不要输出质量报告、反馈候选、调试信息、JSON、Markdown 表格或上游上报内容。",
  "运行时会把 message-list、trace、quality-gates、feedback-candidates、setting-conflicts 写成文件。模型只负责本章文本和一句话大纲。"
].join("\n");

function sectionOf(sections: readonly CompiledSection[], kind: ContextSectionKind): CompiledSection | undefined {
  return sections.find((section) => section.kind === kind);
}

function listBlock(title: string, values: readonly string[]): string {
  return values.length === 0 ? "" : `${title}\n${values.map((value) => `- ${value}`).join("\n")}`;
}

function stablePackageContract(pkg: AuthoringRuntimePackage): string {
  return [
    "【稳定目标世界契约】",
    `目标世界：${pkg.targetWorld.description}`,
    listBlock("可接收输入", pkg.targetWorld.inputKinds),
    listBlock("可产出结果", pkg.targetWorld.outputKinds),
    listBlock("动作边界", pkg.targetWorld.actionBoundary),
    listBlock("失败处理", pkg.targetWorld.failureHandling),
    `dialogueAllowed=${pkg.targetWorld.dialogueAllowed}`,
    listBlock("长期追踪事实", pkg.storyModel.trackedFacts),
    listBlock("运行验证步骤", pkg.harness.steps),
    "【稳定质量门禁】",
    ...pkg.qualityRules.map((rule) => `- ${rule.kind}: ${rule.note}`),
    "【稳定反馈归因】",
    ...pkg.feedbackRouting.map((route) => `- ${route.issueKind}->${route.layer}: ${route.reason}`)
  ].filter((part) => part.length > 0).join("\n");
}

export function compileMessageList(
  pkg: AuthoringRuntimePackage,
  state: AuthoringRunState
): { readonly messages: readonly ProviderNeutralMessage[]; readonly record: CompiledMessageList } {
  const sections: CompiledSection[] = [];
  for (const policy of pkg.contextPolicy) {
    const raw = sectionContent(state, policy.kind);
    const content = raw.length > policy.maxChars ? raw.slice(0, policy.maxChars) : raw;
    sections.push({ kind: policy.kind, title: policy.title, source: policy.source, charsUsed: content.length, content });
  }

  const systemParts = [
    pkg.writingStrategy.systemPrompt,
    pkg.writingStrategy.stylePrinciples.length === 0 ? "" : `写作原则：\n${pkg.writingStrategy.stylePrinciples.map((p) => `- ${p}`).join("\n")}`,
    pkg.writingStrategy.constraints.length === 0 ? "" : `硬性约束：\n${pkg.writingStrategy.constraints.map((c) => `- ${c}`).join("\n")}`,
    pkg.storyModel.continuityDimensions.length === 0 ? "" : `连贯性检查维度（写作时必须维持）：\n${pkg.storyModel.continuityDimensions.map((d) => `- ${d}`).join("\n")}`,
    pkg.coveragePolicy.noMissingTopic.enabled
      ? `目标覆盖门禁：${pkg.coveragePolicy.noMissingTopic.title}；gate=${pkg.coveragePolicy.noMissingTopic.gateId}；promptOnlyAllowed=${pkg.coveragePolicy.noMissingTopic.promptOnlyAllowed}`
      : "",
    "运行输出边界：本轮模型输出只写目标正文与 ===OUTLINE=== 后的一句话大纲；质量门禁、反馈候选、调试信息和上报信息由 runtime 写入文件，不要混入正文。"
  ].filter((p) => p.length > 0);
  const systemPrompt = systemParts.join("\n\n");

  const longTerm = sectionOf(sections, "long_term");
  const shortTerm = sectionOf(sections, "short_term");
  const feedback = sectionOf(sections, "feedback");
  const stableBody = [
    "【稳定作品上下文】",
    `作品标题：${state.title}`,
    `小说设定：\n${state.premise}`,
    longTerm === undefined ? "" : `${longTerm.title}\n${longTerm.content}`,
    stablePackageContract(pkg),
    AUTHORING_RUNTIME_STABLE_PROTOCOL
  ].filter((part) => part.length > 0).join("\n\n");

  const goal = state.chapterGoal === undefined || state.chapterGoal.length === 0
    ? `请创作第 ${state.chapterNumber} 章，自然推进剧情。`
    : state.chapterGoal;
  const dynamicBody = [
    "【本章动态输入】",
    `章节编号：第 ${state.chapterNumber} 章`,
    `本章目标：\n${goal}`,
    shortTerm === undefined ? "" : `${shortTerm.title}\n${shortTerm.content}`,
    feedback === undefined ? "" : `${feedback.title}\n${feedback.content}`,
    `请输出第 ${state.chapterNumber} 章正文，然后另起一行输出 ===OUTLINE===，再用一句话(50字内)概括本章作为后续前情。`
  ].filter((part) => part.length > 0).join("\n\n");

  const messages: readonly ProviderNeutralMessage[] = [
    { role: "system", content: [{ type: "text", text: systemPrompt }] },
    { role: "user", content: [{ type: "text", text: stableBody }] },
    { role: "user", content: [{ type: "text", text: dynamicBody }] }
  ];
  const cachePrefix = `${systemPrompt}\n\n${stableBody}`;
  return {
    messages,
    record: {
      chapterNumber: state.chapterNumber,
      sections,
      systemPrompt,
      systemPromptChars: systemPrompt.length,
      cachePrefix,
      cachePrefixChars: cachePrefix.length,
      stablePrefixMessageCount: 2,
      coveragePolicy: {
        noMissingTopicGateId: pkg.coveragePolicy.noMissingTopic.gateId,
        promptOnlyAllowed: pkg.coveragePolicy.noMissingTopic.promptOnlyAllowed,
        blockingUntilReviewed: pkg.coveragePolicy.noMissingTopic.blockingUntilReviewed
      },
      compiledAt: new Date().toISOString()
    }
  };
}

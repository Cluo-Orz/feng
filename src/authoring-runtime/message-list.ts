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
    pkg.storyModel.continuityDimensions.length === 0 ? "" : `连贯性检查维度（写作时必须维持）：\n${pkg.storyModel.continuityDimensions.map((d) => `- ${d}`).join("\n")}`
  ].filter((p) => p.length > 0);
  const systemPrompt = systemParts.join("\n\n");

  const userBody = [
    ...sections.map((s) => `${s.title}\n${s.content}`),
    `请输出第 ${state.chapterNumber} 章正文，然后另起一行输出 ===OUTLINE===，再用一句话(50字内)概括本章作为后续前情。`
  ].join("\n\n");

  const messages: readonly ProviderNeutralMessage[] = [
    { role: "system", content: [{ type: "text", text: systemPrompt }] },
    { role: "user", content: [{ type: "text", text: userBody }] }
  ];
  return {
    messages,
    record: { chapterNumber: state.chapterNumber, sections, systemPrompt, systemPromptChars: systemPrompt.length, compiledAt: new Date().toISOString() }
  };
}

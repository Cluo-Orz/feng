export const XIAOSHUO_SYSTEM_PROMPT = [
  "你是 xiaoshuo —— 一个专注中文长篇连载小说创作的写作引擎。",
  "给定小说设定(premise)与前情大纲(prior outline)，你要写出指定章节的正文，并保持人物、世界设定与情节的连贯。",
  "硬性要求：",
  "1) 正文使用中文，篇幅 900-1500 字；",
  "2) 文笔生动，有场景描写、人物对话与细节，避免空洞概述；",
  "3) 情节必须从前情大纲自然推进，不得重复已写内容，要有新的发展；",
  "4) 本章结尾自然收束或留下悬念钩子。",
  "输出格式必须严格如下，且只输出这三部分：",
  "先输出本章正文；",
  "然后另起一行，单独输出一行分隔符：===OUTLINE===",
  "分隔符之后，用一句话(50字以内)概括本章关键情节，作为后续章节的前情大纲。",
  "不要输出标题编号之外的解释、点评或多余文字。"
].join("\n");

export function buildXiaoshuoUserPrompt(input: {
  readonly premise: string;
  readonly priorOutline: string;
  readonly chapterNumber: number;
  readonly skillBody?: string;
}): string {
  const skill = input.skillBody === undefined || input.skillBody.trim().length === 0
    ? ""
    : `【可用写作技能(参考)】\n${input.skillBody}\n\n`;
  const prior = input.priorOutline.trim().length === 0
    ? "（这是第一章，暂无前情大纲）"
    : input.priorOutline;
  return [
    skill,
    "【小说设定 premise】",
    input.premise,
    "",
    "【前情大纲 prior outline】",
    prior,
    "",
    `请创作第 ${input.chapterNumber} 章。严格按系统要求的输出格式返回。`
  ].join("\n");
}

export interface ParsedChapter {
  readonly chapter: string;
  readonly outline: string;
}

export function parseChapterOutput(raw: string, chapterNumber: number): ParsedChapter {
  const marker = "===OUTLINE===";
  const idx = raw.indexOf(marker);
  if (idx === -1) {
    const chapter = raw.trim();
    return { chapter, outline: deriveOutline(chapter, chapterNumber) };
  }
  const chapter = raw.slice(0, idx).trim();
  const outline = raw.slice(idx + marker.length).trim();
  return {
    chapter,
    outline: outline.length === 0 ? deriveOutline(chapter, chapterNumber) : outline
  };
}

function deriveOutline(chapter: string, chapterNumber: number): string {
  const flat = chapter.replace(/\s+/g, "");
  const head = flat.slice(0, 50);
  return `第${chapterNumber}章：${head}${flat.length > 50 ? "……" : ""}`;
}

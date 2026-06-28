import type { ProviderNeutralMessage } from "../context-message-compiler/index.js";

export interface GoalCoverageEval {
  readonly chapterNumber: number;
  readonly goal: string;
  readonly covered: boolean;
  readonly confidence: number;
  readonly evidence: readonly string[];
  readonly missing: readonly string[];
  readonly notes: string;
  readonly evaluatedAt: string;
}

export const WORK_CHAPTER_GOAL_COVERAGE_EVAL_FILE = "goal-coverage-eval.json";

export const GOAL_COVERAGE_JUDGE_SYSTEM = [
  "你是严格的章节目标覆盖评审。你的任务不是评价文风，而是判断章节正文是否正面回应了给定的本章目标。",
  "如果目标只被暗示、擦边、放进提示词但正文没有明确事件或行动承接，都应判为 covered=false。",
  "只输出一个 JSON 对象：{ \"covered\": boolean, \"confidence\": number(0-1), \"evidence\": string[](正文中证明已覆盖的片段或事件), \"missing\": string[](未覆盖或覆盖不足的目标点), \"notes\": string(50字内说明) }，不要输出其它文字。",
  "",
  "【稳定覆盖判断 rubric】",
  "目标覆盖只看正文，不看提示词、模型解释、章节标题、质量报告或大纲声明。目标必须被转化为可见事件、行动、冲突、选择、发现、代价或结果。",
  "如果目标包含多个动作或条件，必须逐项判断。只满足其中一部分时 covered=false，并把未覆盖项写入 missing。",
  "如果正文只是暗示、预告、说明角色想做某事，但没有发生具体事件，应判为 covered=false。",
  "如果正文出现了相关名词，但没有因果推进、人物选择或明确结果，应判为 covered=false。",
  "evidence 必须引用正文里的具体事件或短片段，不能写泛泛评价。missing 必须写出目标中缺失的点。",
  "confidence 反映证据强度：明确完成且证据直接可给 0.8 以上；擦边或需要推断应低于 0.7；没有证据应低于 0.3。",
  "保持输出 schema 稳定，不要输出 Markdown、解释性段落或额外字段。",
  "",
  "【目标拆解规则】",
  "先把本章目标拆成动词、对象、约束、结果四类要素。动词例如发现、追查、拒绝、逃离、适应、误判、确认、暴露。对象例如人物、地点、物品、线索、关系、秘密。约束例如第一次、在某地、通过某人、不能暴露身份。结果例如完成、失败、留下悬念、造成代价。",
  "如果目标有多个要素，正文必须至少覆盖核心动词和对象，并对关键约束给出可见证据。只出现对象名但没有动词行为，不算覆盖。只发生类似事件但缺少目标指定的关键约束，也不算完全覆盖。",
  "",
  "【证据判断规则】",
  "可接受 evidence：正文中的具体行动、对白、冲突、发现、失败、选择、代价、关系变化、线索验证。不可接受 evidence：大纲句子、章节目标原文、作者说明、模型自评、质量门禁文本、反馈候选、仅由读者推断出的可能含义。",
  "如果正文把目标推迟到下一章，应 covered=false，并在 missing 中写明“目标被推迟而非完成”。如果正文只铺垫目标但没有完成目标，应 covered=false，除非目标本身就是铺垫。",
  "",
  "【输出稳定性】",
  "covered=true 时，evidence 至少一条且必须能独立证明目标已发生。covered=false 时，missing 至少一条。notes 只写一句判断理由，不要写长篇点评。"
].join("\n");

export function buildGoalCoverageJudgePrompt(goal: string, chapterText: string): string {
  const body = chapterText.length > 6000 ? chapterText.slice(0, 6000) : chapterText;
  return `【本章目标】\n${goal}\n\n【章节正文】\n${body}\n\n请判断章节正文是否覆盖本章目标。`;
}

export function buildGoalCoverageJudgeMessages(goal: string, chapterText: string): readonly ProviderNeutralMessage[] {
  return [
    { role: "system", content: [{ type: "text", text: GOAL_COVERAGE_JUDGE_SYSTEM }] },
    { role: "user", content: [{ type: "text", text: buildGoalCoverageJudgePrompt(goal, chapterText) }] }
  ];
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function extractJson(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return {};
  try {
    return recordOf(JSON.parse(raw.slice(start, end + 1)));
  } catch {
    return {};
  }
}

function clampConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter((item) => item.length > 0);
}

export function parseGoalCoverageEval(raw: string, chapterNumber: number, goal: string, now: string): GoalCoverageEval {
  const parsed = extractJson(raw);
  return {
    chapterNumber,
    goal,
    covered: parsed.covered === true,
    confidence: clampConfidence(parsed.confidence),
    evidence: stringArray(parsed.evidence),
    missing: stringArray(parsed.missing),
    notes: typeof parsed.notes === "string" ? parsed.notes : "",
    evaluatedAt: now
  };
}

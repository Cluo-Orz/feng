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
  "只输出一个 JSON 对象：{ \"covered\": boolean, \"confidence\": number(0-1), \"evidence\": string[](正文中证明已覆盖的片段或事件), \"missing\": string[](未覆盖或覆盖不足的目标点), \"notes\": string(50字内说明) }，不要输出其它文字。"
].join("\n");

export function buildGoalCoverageJudgePrompt(goal: string, chapterText: string): string {
  const body = chapterText.length > 6000 ? chapterText.slice(0, 6000) : chapterText;
  return `【本章目标】\n${goal}\n\n【章节正文】\n${body}\n\n请判断章节正文是否覆盖本章目标。`;
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

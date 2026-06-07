// Optional semantic (LLM-judge) quality eval, written as a file-native eval
// artifact. This is the second layer the acceptance boundary calls for:
// deterministic structural checks (quality.ts) + an optional semantic eval
// whose result must be persisted to a file. The judge is the model scoring its
// own chapter on dimensions the structural checks cannot measure.

export interface SemanticScores {
  readonly style: number;
  readonly character: number;
  readonly plot: number;
}

export interface SemanticEval {
  readonly chapterNumber: number;
  readonly overall: number;
  readonly scores: SemanticScores;
  readonly notes: string;
  readonly evaluatedAt: string;
}

export const SEMANTIC_JUDGE_SYSTEM = [
  "你是中文小说质量评审。对给定章节正文，从三个维度各打 1-10 分：",
  "style(文风与可读性)、character(人物可信度与一致性)、plot(情节吸引力与推进)。",
  "只输出一个 JSON 对象：{ \"style\": number, \"character\": number, \"plot\": number, \"notes\": string(50字内中文点评) }，不要输出其它文字。"
].join("\n");

export function buildSemanticJudgePrompt(chapterText: string): string {
  const body = chapterText.length > 6000 ? chapterText.slice(0, 6000) : chapterText;
  return `请评审以下章节正文并按要求输出 JSON：\n\n${body}`;
}

function clampScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
}

export function parseSemanticEval(raw: string, chapterNumber: number, now: string): SemanticEval {
  let parsed: Record<string, unknown> = {};
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  }
  const scores: SemanticScores = {
    style: clampScore(parsed.style),
    character: clampScore(parsed.character),
    plot: clampScore(parsed.plot)
  };
  const overall = Math.round(((scores.style + scores.character + scores.plot) / 3) * 10) / 10;
  const notes = typeof parsed.notes === "string" ? parsed.notes : "";
  return { chapterNumber, overall, scores, notes, evaluatedAt: now };
}

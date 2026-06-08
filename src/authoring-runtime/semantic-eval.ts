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

export interface SemanticProblem {
  readonly dimension: string;
  readonly evidence: string;
  readonly suggestion: string;
}

export interface SemanticEval {
  readonly chapterNumber: number;
  readonly overall: number;
  readonly scores: SemanticScores;
  readonly problems: readonly SemanticProblem[];
  readonly notes: string;
  readonly evaluatedAt: string;
}

export const SEMANTIC_JUDGE_SYSTEM = [
  "你是严格的中文小说质量评审，倾向于找问题而不是给好评。对给定章节正文：",
  "1) 从三个维度各打 1-10 分：style(文风与可读性)、character(人物可信度与一致性)、plot(情节吸引力与推进)。",
  "2) 必须列出具体问题，每个问题包含：dimension(所属维度)、evidence(引用原文片段或具体位置)、suggestion(可执行的修复建议)。若确无问题可给空数组，但应尽量找出可改进点。",
  "只输出一个 JSON 对象：{ \"style\": number, \"character\": number, \"plot\": number, \"problems\": [{\"dimension\": string, \"evidence\": string, \"suggestion\": string}], \"notes\": string(50字内总评) }，不要输出其它文字。"
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
  const problems = Array.isArray(parsed.problems)
    ? parsed.problems
        .map((p): SemanticProblem | undefined => {
          const rec = typeof p === "object" && p !== null ? (p as Record<string, unknown>) : undefined;
          if (rec === undefined) return undefined;
          return {
            dimension: typeof rec.dimension === "string" ? rec.dimension : "unknown",
            evidence: typeof rec.evidence === "string" ? rec.evidence : "",
            suggestion: typeof rec.suggestion === "string" ? rec.suggestion : ""
          };
        })
        .filter((p): p is SemanticProblem => p !== undefined)
    : [];
  return { chapterNumber, overall, scores, problems, notes, evaluatedAt: now };
}

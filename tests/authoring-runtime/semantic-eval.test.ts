import { describe, expect, it } from "vitest";
import { parseSemanticEval, buildSemanticJudgePrompt, SEMANTIC_JUDGE_SYSTEM } from "../../src/authoring-runtime/index.js";

describe("semantic eval parsing", () => {
  it("parses a clean score JSON and computes the overall average", () => {
    const e = parseSemanticEval('{"style": 8, "character": 7, "plot": 9, "notes": "节奏好"}', 2, "t");
    expect(e.scores).toEqual({ style: 8, character: 7, plot: 9 });
    expect(e.overall).toBe(8);
    expect(e.notes).toBe("节奏好");
    expect(e.chapterNumber).toBe(2);
  });

  it("extracts JSON embedded in surrounding text and clamps scores", () => {
    const e = parseSemanticEval('评分如下：{"style": 12, "character": -3, "plot": "6"} 完毕', 1, "t");
    expect(e.scores.style).toBe(10);
    expect(e.scores.character).toBe(0);
    expect(e.scores.plot).toBe(6);
  });

  it("degrades to zeros on non-JSON output", () => {
    const e = parseSemanticEval("我无法给出评分", 3, "t");
    expect(e.overall).toBe(0);
    expect(e.notes).toBe("");
  });

  it("builds a judge prompt that truncates very long chapters", () => {
    expect(SEMANTIC_JUDGE_SYSTEM).toContain("style");
    const prompt = buildSemanticJudgePrompt("字".repeat(9000));
    expect(prompt.length).toBeLessThan(6200);
  });
});

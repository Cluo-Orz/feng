import { describe, expect, it } from "vitest";
import { parseSemanticEval, buildSemanticJudgeMessages, buildSemanticJudgePrompt, semanticCapabilityIssues, SEMANTIC_JUDGE_SYSTEM } from "../../src/authoring-runtime/index.js";

describe("semantic eval parsing", () => {
  it("parses scores, structured problems, notes, and computes the overall average", () => {
    const e = parseSemanticEval('{"style": 8, "character": 7, "plot": 9, "problems": [{"dimension":"character","evidence":"李白突然变得胆小","suggestion":"保持其豪放性格"}], "notes": "节奏好"}', 2, "t");
    expect(e.scores).toEqual({ style: 8, character: 7, plot: 9 });
    expect(e.overall).toBe(8);
    expect(e.problems).toHaveLength(1);
    expect(e.problems[0]?.dimension).toBe("character");
    expect(e.problems[0]?.suggestion).toContain("豪放");
    expect(e.notes).toBe("节奏好");
    expect(e.chapterNumber).toBe(2);
  });

  it("tolerates malformed problem entries and missing fields", () => {
    const e = parseSemanticEval('{"style": 6, "character": 6, "plot": 6, "problems": ["bad", {"dimension":"plot"}]}', 1, "t");
    expect(e.problems).toHaveLength(1);
    expect(e.problems[0]?.dimension).toBe("plot");
    expect(e.problems[0]?.evidence).toBe("");
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
    expect(SEMANTIC_JUDGE_SYSTEM).toContain("稳定评审 rubric");
    const prompt = buildSemanticJudgePrompt("字".repeat(9000));
    expect(prompt.length).toBeLessThan(6200);
  });

  it("keeps judge rubric stable while chapter text stays dynamic", () => {
    const first = buildSemanticJudgeMessages("第一章正文");
    const second = buildSemanticJudgeMessages("第二章正文");
    expect(first).toHaveLength(2);
    expect(first[0]).toEqual(second[0]);
    expect(first[1]).not.toEqual(second[1]);
    expect(first[0]?.content[0]?.text).toContain("稳定评审 rubric");
    expect(first[0]?.content[0]?.text).not.toContain("第一章正文");
    expect(first[1]?.content[0]?.text).toContain("第一章正文");
  });
});

describe("semanticCapabilityIssues", () => {
  it("turns problems on below-bar dimensions into capability issues", () => {
    const e = parseSemanticEval('{"style": 6, "character": 7, "plot": 9, "problems": [{"dimension":"style","evidence":"比喻堆叠","suggestion":"精简"},{"dimension":"character","evidence":"反应轻率","suggestion":"加层次"},{"dimension":"plot","evidence":"过场","suggestion":"加冲突"}]}', 2, "t");
    const issues = semanticCapabilityIssues(e);
    const kinds = issues.map((i) => i.kind);
    expect(kinds).toContain("semantic_style");
    expect(kinds).toContain("semantic_character");
    // plot scored 9 (>= bar 8) so its problem is not escalated
    expect(kinds).not.toContain("semantic_plot");
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
  });

  it("returns nothing when all flagged dimensions are at or above the bar", () => {
    const e = parseSemanticEval('{"style": 9, "character": 8, "plot": 8, "problems": [{"dimension":"style","evidence":"x","suggestion":"y"}]}', 1, "t");
    expect(semanticCapabilityIssues(e)).toHaveLength(0);
  });

  it("turns below-bar scores without structured problems into review-blocking capability issues", () => {
    const e = parseSemanticEval('{"style": 0, "character": 7, "plot": 9, "problems": []}', 1, "t");
    const issues = semanticCapabilityIssues(e);
    expect(issues.map((i) => i.kind)).toEqual(["semantic_style", "semantic_character"]);
    expect(issues[0]?.detail).toContain("未给出结构化问题");
  });

  it("ignores unknown problem dimensions but still escalates below-bar tracked scores", () => {
    const e = parseSemanticEval('{"style": 4, "character": 4, "plot": 4, "problems": [{"dimension":"pacing","evidence":"x","suggestion":"y"}]}', 1, "t");
    expect(semanticCapabilityIssues(e).map((issue) => issue.kind)).toEqual(["semantic_style", "semantic_character", "semantic_plot"]);
  });
});

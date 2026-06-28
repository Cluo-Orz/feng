import { describe, expect, it } from "vitest";
import {
  buildGoalCoverageJudgePrompt,
  GOAL_COVERAGE_JUDGE_SYSTEM,
  parseGoalCoverageEval
} from "../../src/authoring-runtime/index.js";

describe("goal coverage eval parsing", () => {
  it("parses explicit coverage evidence and confidence", () => {
    const evaluated = parseGoalCoverageEval(
      '{"covered": true, "confidence": 0.82, "evidence": ["扫码支付"], "missing": [], "notes": "已覆盖"}',
      1,
      "写出李白第一次适应手机支付",
      "t"
    );
    expect(evaluated.covered).toBe(true);
    expect(evaluated.confidence).toBe(0.82);
    expect(evaluated.evidence).toEqual(["扫码支付"]);
    expect(evaluated.goal).toContain("手机支付");
  });

  it("defaults malformed output to uncovered so a gate cannot pass without evidence", () => {
    const evaluated = parseGoalCoverageEval("我觉得挺好", 2, "目标", "t");
    expect(evaluated.covered).toBe(false);
    expect(evaluated.confidence).toBe(0);
    expect(evaluated.evidence).toHaveLength(0);
  });

  it("builds a strict prompt that separates goal coverage from generic style quality", () => {
    expect(GOAL_COVERAGE_JUDGE_SYSTEM).toContain("不是评价文风");
    const prompt = buildGoalCoverageJudgePrompt("写出手机支付", "字".repeat(9000));
    expect(prompt).toContain("写出手机支付");
    expect(prompt.length).toBeLessThan(6200);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildGoalCoverageJudgeMessages,
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
    expect(evaluated.parseOk).toBe(true);
    expect(evaluated.covered).toBe(true);
    expect(evaluated.confidence).toBe(0.82);
    expect(evaluated.evidence).toEqual(["扫码支付"]);
    expect(evaluated.goal).toContain("手机支付");
  });

  it("defaults malformed output to uncovered so a gate cannot pass without evidence", () => {
    const evaluated = parseGoalCoverageEval("我觉得挺好", 2, "目标", "t");
    expect(evaluated.parseOk).toBe(false);
    expect(evaluated.covered).toBe(false);
    expect(evaluated.confidence).toBe(0);
    expect(evaluated.evidence).toHaveLength(0);
    expect(evaluated.raw).toBe("我觉得挺好");
  });

  it("builds a strict prompt that separates goal coverage from generic style quality", () => {
    expect(GOAL_COVERAGE_JUDGE_SYSTEM).toContain("不是评价文风");
    expect(GOAL_COVERAGE_JUDGE_SYSTEM).toContain("稳定覆盖判断 rubric");
    const prompt = buildGoalCoverageJudgePrompt("写出手机支付", "字".repeat(9000));
    expect(prompt).toContain("写出手机支付");
    expect(prompt.length).toBeLessThan(6200);
  });

  it("keeps coverage rubric stable while goal and chapter text stay dynamic", () => {
    const first = buildGoalCoverageJudgeMessages("写出手机支付", "第一章正文");
    const second = buildGoalCoverageJudgeMessages("写出直播吟诗", "第二章正文");
    expect(first).toHaveLength(2);
    expect(first[0]).toEqual(second[0]);
    expect(first[1]).not.toEqual(second[1]);
    expect(first[0]?.content[0]?.text).toContain("稳定覆盖判断 rubric");
    expect(first[0]?.content[0]?.text).not.toContain("手机支付");
    expect(first[1]?.content[0]?.text).toContain("手机支付");
  });
});

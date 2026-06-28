import { describe, expect, it } from "vitest";
import {
  SAMPLE_GOAL_COVERAGE_CONSTRAINT,
  constraintFor,
  reviseStrategyForFeedbackDetails,
  reviseStrategyForIssues,
  reviseStrategyForSampleGoalCoverage
} from "../../src/host/grow-revise.js";
import type { WritingStrategy } from "../../src/runtime-package/index.js";

const base: WritingStrategy = { systemPrompt: "写作 agent", stylePrinciples: [], constraints: ["保持连贯"] };

describe("grow-revise", () => {
  it("appends a targeted constraint for a capability issue", () => {
    const revised = reviseStrategyForIssues(base, ["character_continuation"]);
    expect(revised.added).toHaveLength(1);
    expect(revised.strategy.constraints.some((c) => c.includes("人物承接"))).toBe(true);
  });

  it("is idempotent and de-duplicates constraints", () => {
    const once = reviseStrategyForIssues(base, ["character_continuation"]);
    const twice = reviseStrategyForIssues(once.strategy, ["character_continuation"]);
    expect(twice.added).toHaveLength(0);
    expect(twice.strategy).toBe(once.strategy);
  });

  it("revises for multiple distinct issue kinds at once", () => {
    const revised = reviseStrategyForIssues(base, ["character_continuation", "length", "year_consistency"]);
    expect(revised.added).toHaveLength(3);
  });

  it("ignores issue kinds with no known revision", () => {
    const revised = reviseStrategyForIssues(base, ["artifact_presence"]);
    expect(revised.added).toHaveLength(0);
  });

  it("exposes the constraint text per kind", () => {
    expect(constraintFor("length")).toContain("字数");
    expect(constraintFor("artifact_presence")).toBeUndefined();
  });

  it("maps semantic-judge capability kinds to writing constraints", () => {
    const revised = reviseStrategyForIssues(base, ["semantic_character", "semantic_plot", "semantic_style"]);
    expect(revised.added).toHaveLength(3);
    expect(constraintFor("semantic_character")).toContain("人物");
    expect(constraintFor("semantic_plot")).toContain("情节");
    expect(constraintFor("semantic_style")).toContain("文风");
  });

  it("maps downstream goal coverage failures to the no-missing-topic strategy constraint", () => {
    const revised = reviseStrategyForIssues(base, ["goal_coverage"]);
    expect(revised.added).toEqual([SAMPLE_GOAL_COVERAGE_CONSTRAINT]);
    expect(constraintFor("goal_coverage")).toBe(SAMPLE_GOAL_COVERAGE_CONSTRAINT);
  });

  it("revises for sample goal coverage gate failures without duplicating the constraint", () => {
    const revised = reviseStrategyForSampleGoalCoverage(base, 1);
    expect(revised.added).toEqual([SAMPLE_GOAL_COVERAGE_CONSTRAINT]);
    expect(revised.strategy.constraints).toContain(SAMPLE_GOAL_COVERAGE_CONSTRAINT);
    const twice = reviseStrategyForSampleGoalCoverage(revised.strategy, 2);
    expect(twice.added).toHaveLength(0);
    expect(twice.strategy).toBe(revised.strategy);
  });

  it("derives reusable constraints from concrete semantic feedback details", () => {
    const revised = reviseStrategyForFeedbackDetails(base, [
      { issueKind: "semantic_plot", detail: "关键线索出现得过于直接，像是巧合式答案。" },
      { issueKind: "semantic_character", detail: "主角行动动机不足，缺少个人牵连和必然性。" },
      { issueKind: "semantic_style", detail: "比喻和意象堆叠，造成阅读消耗。" }
    ]);
    expect(revised.added).toHaveLength(3);
    expect(revised.strategy.constraints.some((item) => item.includes("关键线索"))).toBe(true);
    expect(revised.strategy.constraints.some((item) => item.includes("可见动机"))).toBe(true);
    expect(revised.strategy.constraints.some((item) => item.includes("高价值比喻"))).toBe(true);
    const twice = reviseStrategyForFeedbackDetails(revised.strategy, [
      { issueKind: "semantic_plot", detail: "关键线索出现得过于直接，像是巧合式答案。" }
    ]);
    expect(twice.added).toHaveLength(0);
  });
});

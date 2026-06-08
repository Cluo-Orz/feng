import { describe, expect, it } from "vitest";
import { reviseStrategyForIssues, constraintFor } from "../../src/host/grow-revise.js";
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
});

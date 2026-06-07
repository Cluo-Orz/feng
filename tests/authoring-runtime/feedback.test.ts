import { describe, expect, it } from "vitest";
import { routeFeedback } from "../../src/authoring-runtime/index.js";
import { defaultFeedbackRouting } from "../../src/runtime-package/index.js";
import type { QualityIssue } from "../../src/authoring-runtime/index.js";

describe("feedback routing", () => {
  it("routes each issue kind to its lifecycle layer", () => {
    const issues: readonly QualityIssue[] = [
      { kind: "length", severity: "error", detail: "字数" },
      { kind: "year_consistency", severity: "error", detail: "年份" },
      { kind: "geography_consistency", severity: "warning", detail: "地理" },
      { kind: "character_continuation", severity: "warning", detail: "人物" },
      { kind: "outline_continuity", severity: "error", detail: "大纲" },
      { kind: "chapter_continuity", severity: "error", detail: "章序" },
      { kind: "artifact_presence", severity: "error", detail: "trace" }
    ];
    const routed = routeFeedback(defaultFeedbackRouting, 3, issues);
    expect(routed.byLayer.work).toBe(3);
    expect(routed.byLayer.capability).toBe(3);
    expect(routed.byLayer.system).toBe(1);
    expect(routed.candidates).toHaveLength(7);
    expect(routed.candidates.every((c) => c.chapterNumber === 3)).toBe(true);
  });

  it("falls back to work layer for unknown issue kinds", () => {
    const issues: readonly QualityIssue[] = [{ kind: "mystery" as never, severity: "error", detail: "x" }];
    const routed = routeFeedback(defaultFeedbackRouting, 1, issues);
    expect(routed.candidates[0]?.layer).toBe("work");
  });
});

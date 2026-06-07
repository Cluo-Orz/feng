import { describe, expect, it } from "vitest";
import { evaluateChapter, extractYears, type QualityInput } from "../../src/authoring-runtime/index.js";
import { defaultQualityRules } from "../../src/runtime-package/index.js";

function base(overrides: Partial<QualityInput>): QualityInput {
  return {
    rules: defaultQualityRules,
    chapterNumber: 2,
    chapterText: "一".repeat(1200),
    outline: "第2章梗概",
    priorChapterNumbers: [1],
    priorOutlines: ["第1章梗概"],
    messageListWritten: true,
    traceWritten: true,
    ...overrides
  };
}

describe("quality extractYears", () => {
  it("extracts plausible years", () => {
    expect(extractYears("时间是2024年，后来到了2025")).toEqual([2024, 2025]);
    expect(extractYears("没有年份")).toEqual([]);
  });
});

describe("quality evaluateChapter", () => {
  it("passes a healthy chapter", () => {
    const evalResult = evaluateChapter(base({}));
    expect(evalResult.passed).toBe(true);
    expect(evalResult.issues).toHaveLength(0);
  });

  it("flags a chapter below the length floor", () => {
    const r = evaluateChapter(base({ chapterText: "短".repeat(100) }));
    expect(r.passed).toBe(false);
    expect(r.issues.some((i) => i.kind === "length" && i.severity === "error")).toBe(true);
  });

  it("warns are non-blocking but a chapter over the hard ceiling FAILS", () => {
    const r = evaluateChapter(base({ chapterText: "长".repeat(3000) }));
    // length over max is a hard DoD violation, not a soft warning
    expect(r.issues.some((i) => i.kind === "length" && i.severity === "error")).toBe(true);
    expect(r.status).toBe("fail");
    expect(r.passed).toBe(false);
  });

  it("classifies status as pass / pass_with_warnings / fail", () => {
    expect(evaluateChapter(base({})).status).toBe("pass");
    expect(evaluateChapter(base({ conflictTerms: ["采石矶"], chapterText: `${"成都".repeat(700)}采石矶` })).status).toBe("pass_with_warnings");
    expect(evaluateChapter(base({ establishedYear: 2024, chapterText: `${"叙述".repeat(600)}已是2025年` })).status).toBe("fail");
  });

  it("catches a year drift (2024 -> 2025)", () => {
    const r = evaluateChapter(base({ establishedYear: 2024, chapterText: `${"叙述".repeat(600)}时间已是2025年` }));
    expect(r.issues.some((i) => i.kind === "year_consistency")).toBe(true);
    expect(r.passed).toBe(false);
  });

  it("catches a chapter numbering gap", () => {
    const r = evaluateChapter(base({ chapterNumber: 4, priorChapterNumbers: [1, 2] }));
    expect(r.issues.some((i) => i.kind === "chapter_continuity")).toBe(true);
  });

  it("warns when the opening drops every established character", () => {
    const r = evaluateChapter(base({
      establishedCharacters: ["李白", "杨慎之"],
      chapterText: `${"一个全新的陌生人登场".repeat(80)}`
    }));
    expect(r.issues.some((i) => i.kind === "character_continuation")).toBe(true);
  });

  it("accepts an opening that continues an established character", () => {
    const r = evaluateChapter(base({
      establishedCharacters: ["李白"],
      chapterText: `李白睁开眼睛，${"继续前情".repeat(300)}`
    }));
    expect(r.issues.some((i) => i.kind === "character_continuation")).toBe(false);
  });

  it("warns on a conflicting geography term", () => {
    const r = evaluateChapter(base({ conflictTerms: ["采石矶"], chapterText: `${"成都的街头".repeat(200)}这里以前叫采石矶` }));
    expect(r.issues.some((i) => i.kind === "geography_consistency")).toBe(true);
  });

  it("flags outline count mismatch and missing outline", () => {
    const mismatch = evaluateChapter(base({ priorOutlines: [] }));
    expect(mismatch.issues.some((i) => i.kind === "outline_continuity")).toBe(true);
    const missing = evaluateChapter(base({ outline: "  " }));
    expect(missing.issues.some((i) => i.kind === "outline_continuity")).toBe(true);
  });

  it("flags missing runtime artifacts", () => {
    const r = evaluateChapter(base({ messageListWritten: false, traceWritten: false }));
    const presence = r.issues.filter((i) => i.kind === "artifact_presence");
    expect(presence.length).toBe(2);
    expect(r.passed).toBe(false);
  });

  it("skips checks whose rules are absent", () => {
    const r = evaluateChapter(base({ rules: [], chapterText: "短", messageListWritten: false }));
    expect(r.issues).toHaveLength(0);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildXiaoshuoUserPrompt,
  parseChapterOutput,
  XIAOSHUO_SYSTEM_PROMPT
} from "../../src/host/index.js";

describe("xiaoshuo prompts", () => {
  it("includes hard requirements in the system prompt", () => {
    expect(XIAOSHUO_SYSTEM_PROMPT).toContain("===OUTLINE===");
    expect(XIAOSHUO_SYSTEM_PROMPT).toContain("900-1500");
  });

  it("builds a user prompt with premise, prior outline and chapter number", () => {
    const prompt = buildXiaoshuoUserPrompt({ premise: "李白重生", priorOutline: "第1章：穿越", chapterNumber: 2 });
    expect(prompt).toContain("李白重生");
    expect(prompt).toContain("第1章：穿越");
    expect(prompt).toContain("第 2 章");
  });

  it("marks the first chapter when there is no prior outline and folds in a skill body", () => {
    const prompt = buildXiaoshuoUserPrompt({ premise: "p", priorOutline: "", chapterNumber: 1, skillBody: "skill-xyz" });
    expect(prompt).toContain("这是第一章");
    expect(prompt).toContain("skill-xyz");
  });

  it("splits chapter and outline on the marker", () => {
    const parsed = parseChapterOutput("正文内容。\n===OUTLINE===\n本章梗概。", 1);
    expect(parsed.chapter).toBe("正文内容。");
    expect(parsed.outline).toBe("本章梗概。");
  });

  it("derives an outline when the marker is missing", () => {
    const parsed = parseChapterOutput("只有正文没有分隔符的内容", 3);
    expect(parsed.chapter).toContain("只有正文");
    expect(parsed.outline).toContain("第3章：");
  });

  it("derives an outline when the marker is present but the outline is empty", () => {
    const parsed = parseChapterOutput("正文。\n===OUTLINE===\n   ", 5);
    expect(parsed.outline).toContain("第5章：");
  });
});

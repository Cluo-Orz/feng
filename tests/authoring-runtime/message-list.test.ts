import { describe, expect, it } from "vitest";
import { compileMessageList, type AuthoringRunState } from "../../src/authoring-runtime/index.js";
import {
  defaultContextPolicy,
  defaultNovelTargetWorld,
  defaultQualityRules,
  defaultFeedbackRouting,
  defaultStoryModel,
  defaultHarness,
  PACKAGE_SCHEMA_VERSION,
  type AuthoringRuntimePackage
} from "../../src/runtime-package/index.js";

function pkg(): AuthoringRuntimePackage {
  return {
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    packageId: "pkg-1",
    name: "xiaoshuo",
    kind: "serialized_authoring_agent",
    version: "1.0.0",
    locked: true,
    runEntry: "feng run",
    targetWorld: defaultNovelTargetWorld,
    contextPolicy: defaultContextPolicy,
    writingStrategy: { systemPrompt: "你是写作 agent。", stylePrinciples: ["生动"], constraints: ["900-1500字"] },
    storyModel: defaultStoryModel,
    harness: defaultHarness,
    qualityRules: defaultQualityRules,
    feedbackRouting: defaultFeedbackRouting,
    validation: { readiness: "ready", grownInProject: "/x", evidenceSummary: "ok", checkedAt: "t" },
    provenance: { model: "m", provider: "deepseek", hatchedAt: "t" }
  };
}

function state(overrides: Partial<AuthoringRunState> = {}): AuthoringRunState {
  return {
    premise: "李白重生现代",
    title: "李白重生了",
    chapterNumber: 2,
    priorOutlines: ["第1章：穿越"],
    lastChapterTail: "他握紧了酒葫芦。",
    characterBible: "李白：诗仙",
    worldBible: "现代成都",
    acceptedFeedback: ["注意年份一致"],
    ...overrides
  };
}

describe("compileMessageList", () => {
  it("produces system + user messages with all context sections", () => {
    const { messages, record } = compileMessageList(pkg(), state());
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("system");
    expect(messages[1]?.role).toBe("user");
    const kinds = record.sections.map((s) => s.kind);
    expect(kinds).toEqual(["observation", "short_term", "long_term", "feedback"]);
    const userText = messages[1]?.content[0]?.text ?? "";
    expect(userText).toContain("李白重生现代");
    expect(userText).toContain("第1章：穿越");
    expect(userText).toContain("他握紧了酒葫芦");
    expect(userText).toContain("李白：诗仙");
    expect(userText).toContain("注意年份一致");
    expect(userText).toContain("===OUTLINE===");
  });

  it("embeds the grown system prompt, style principles and constraints", () => {
    const { messages, record } = compileMessageList(pkg(), state());
    const sys = messages[0]?.content[0]?.text ?? "";
    expect(sys).toContain("你是写作 agent");
    expect(sys).toContain("生动");
    expect(sys).toContain("900-1500字");
    expect(sys).toContain("连贯性检查维度");
    expect(sys).toContain("人物承接");
    expect(record.systemPromptChars).toBeGreaterThan(0);
  });

  it("marks first chapter and empty long-term/feedback gracefully", () => {
    const { messages } = compileMessageList(pkg(), {
      premise: "李白重生现代",
      title: "李白重生了",
      chapterNumber: 1,
      priorOutlines: [],
      acceptedFeedback: []
    });
    const userText = messages[1]?.content[0]?.text ?? "";
    expect(userText).toContain("这是第一章");
    expect(userText).toContain("暂无长期设定");
    expect(userText).toContain("暂无已采纳反馈");
  });

  it("truncates sections beyond their max chars", () => {
    const huge = "字".repeat(9000);
    const { record } = compileMessageList(pkg(), state({ premise: huge }));
    const observation = record.sections.find((s) => s.kind === "observation");
    expect(observation?.charsUsed).toBeLessThanOrEqual(2000);
  });
});

import { describe, expect, it } from "vitest";
import { compileMessageList, type AuthoringRunState } from "../../src/authoring-runtime/index.js";
import {
  defaultContextPolicy,
  defaultNovelTargetWorld,
  defaultQualityRules,
  defaultFeedbackRouting,
  defaultStoryModel,
  defaultHarness,
  defaultCoveragePolicy,
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
    coveragePolicy: defaultCoveragePolicy,
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
    expect(record.messages).toEqual(messages);
    const kinds = record.sections.map((s) => s.kind);
    expect(kinds).toEqual(["observation", "short_term", "long_term", "feedback"]);
    const userText = messages.flatMap((message) => message.content.map((part) => part.text)).join("\n");
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
    expect(sys).toContain("目标覆盖门禁");
    expect(sys).toContain("gate-chapter-goal-coverage");
    expect(sys).toContain("质量门禁、反馈候选、调试信息和上报信息由 runtime 写入文件");
    expect(record.systemPromptChars).toBeGreaterThan(0);
    expect(record.cachePrefixChars).toBeGreaterThan(record.systemPromptChars);
    expect(record.stablePrefixMessageCount).toBe(1);
    expect(record.stablePrefixBoundary.messageIndex).toBe(1);
    // the message-list file must record the full system prompt text, not just
    // its length, so it is a complete file-native record of what was sent.
    expect(record.systemPrompt).toBe(sys);
    expect(record.systemPrompt).toContain("900-1500字");
    expect(record.coveragePolicy?.noMissingTopicGateId).toBe("gate-chapter-goal-coverage");
    expect(record.coveragePolicy?.promptOnlyAllowed).toBe(false);
  });

  it("marks first chapter and empty long-term/feedback gracefully", () => {
    const { messages } = compileMessageList(pkg(), {
      premise: "李白重生现代",
      title: "李白重生了",
      chapterNumber: 1,
      priorOutlines: [],
      acceptedFeedback: []
    });
    const userText = messages.flatMap((message) => message.content.map((part) => part.text)).join("\n");
    expect(userText).toContain("这是第一章");
    expect(userText).toContain("暂无长期设定");
    expect(userText).toContain("暂无已采纳反馈");
  });

  it("keeps the cacheable prefix stable when chapter-specific inputs change", () => {
    const firstState: AuthoringRunState = {
      premise: "李白重生现代",
      title: "李白重生了",
      chapterNumber: 1,
      chapterGoal: "写出李白第一次扫码失败",
      priorOutlines: [],
      characterBible: "李白：诗仙",
      worldBible: "现代成都",
      acceptedFeedback: ["注意年份一致"]
    };
    const first = compileMessageList(pkg(), firstState);
    const second = compileMessageList(pkg(), state({
      chapterNumber: 2,
      chapterGoal: "写出李白在直播间吟诗",
      priorOutlines: ["第1章：李白扫码失败"],
      lastChapterTail: "他看着二维码沉默。"
    }));
    expect(first.messages[0]).toEqual(second.messages[0]);
    expect(first.messages[1]).not.toEqual(second.messages[1]);
    expect(first.record.cachePrefix).toBe(second.record.cachePrefix);
    expect(first.record.messages).toEqual(first.messages);
    expect(first.record.cachePrefixChars).toBeGreaterThan(8000);
    const boundary = first.record.stablePrefixBoundary.charOffset;
    const firstUser = first.messages[1]?.content[0]?.text ?? "";
    const secondUser = second.messages[1]?.content[0]?.text ?? "";
    expect(firstUser.slice(0, boundary)).toBe(secondUser.slice(0, boundary));
    expect(firstUser.slice(boundary)).not.toBe(secondUser.slice(boundary));
    expect(first.messages[1]?.content[0]?.text).toContain("稳定作品上下文");
    expect(first.messages[1]?.content[0]?.text).toContain("稳定长程运行手册");
    expect(firstUser.slice(0, boundary)).not.toContain("扫码失败");
    expect(firstUser.slice(boundary)).toContain("扫码失败");
    expect(second.messages[1]?.content[0]?.text).toContain("直播间吟诗");
  });

  it("truncates sections beyond their max chars", () => {
    const huge = "字".repeat(9000);
    const { record } = compileMessageList(pkg(), state({ premise: huge }));
    const observation = record.sections.find((s) => s.kind === "observation");
    expect(observation?.charsUsed).toBeLessThanOrEqual(2000);
  });
});

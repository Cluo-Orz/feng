import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileMessageList } from "../../src/authoring-runtime/index.js";
import { buildAuthoringPackage, createFengHost, growXiaoshuoAgent, grownLengthRule } from "../../src/host/index.js";
import { makeGrowUnitId, makeRef } from "../../src/domain/index.js";
import {
  defaultContextPolicy,
  defaultCoveragePolicy,
  defaultFeedbackRouting,
  defaultHarness,
  defaultNovelTargetWorld,
  defaultStoryModel,
  PACKAGE_PATH
} from "../../src/runtime-package/index.js";
import type { FetchLike } from "../../src/providers/index.js";

const provider = { provider: "deepseek", apiKey: "k", baseUrl: "https://api.deepseek.com", model: "m", maxTokens: 256, reasoningModel: true };

function designFetch(content: string, finishReason = "stop"): FetchLike {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: "d", model: "m", choices: [{ message: { content }, finish_reason: finishReason }], usage: { prompt_tokens: 10, completion_tokens: 50, total_tokens: 60 } }),
    text: async () => ""
  });
}

async function withRoot(body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "feng-growagent-"));
  try {
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const STRATEGY_JSON = JSON.stringify({
  systemPrompt: "你是连载小说写作 agent，保持设定、人物、年份、地点连贯，每章输出正文与 ===OUTLINE===。",
  targetWorld: {
    description: "连载小说创作项目：接收作品设定、章节目标、读者反馈和作者反馈，输出章节正文、更新大纲和反馈候选。",
    inputKinds: ["premise", "chapter_goal", "prior_outline", "reader_feedback", "author_feedback"],
    outputKinds: ["chapter_text", "updated_outline", "feedback_candidates"],
    actionBoundary: ["可写章节草稿", "可更新大纲", "未经确认不得发布作品"],
    failureHandling: ["上下文不足时记录待澄清问题", "输出不满足门禁时形成反馈候选"],
    dialogueAllowed: false
  },
  contextPolicy: [
    { kind: "observation", title: "本轮作品目标", source: "premise + chapter_goal + reader_feedback", maxChars: 1600 },
    { kind: "short_term", title: "近期章节线索", source: "prior outlines + last chapter tail", maxChars: 1800 },
    { kind: "long_term", title: "长期世界与人物事实", source: "world bible + character bible + hooks", maxChars: 2200 },
    { kind: "feedback", title: "已采纳作者反馈", source: "accepted author/reader feedback", maxChars: 900 }
  ],
  storyModel: {
    trackedFacts: ["premise", "character_arc", "unresolved_hooks", "reader_promises"],
    continuityDimensions: ["人物弧线", "伏笔继承", "读者承诺"]
  },
  harness: {
    steps: ["run_chapter", "evaluate_goal_coverage", "route_feedback", "re_grow_package"]
  },
  stylePrinciples: ["有画面感", "有对话"],
  constraints: ["每章字数达标", "章节编号连续"],
  minChars: 1500,
  maxChars: 2800,
  qualityRules: [
    { kind: "length", note: "每章需要保持连载节奏的正文长度" },
    { kind: "semantic_plot", note: "每章必须有明确冲突、推进或回收" },
    { kind: "semantic_character", note: "人物动机必须符合已建立设定" }
  ],
  feedbackRouting: [
    { issueKind: "length", layer: "work", reason: "单章长度由作品项目本地修订" },
    { issueKind: "semantic_plot", layer: "capability", reason: "情节推进反复失败说明小说 agent 能力需要 re-grow" },
    { issueKind: "semantic_character", layer: "capability", reason: "人物可信度反复失败说明小说 agent 能力需要 re-grow" }
  ],
  coveragePolicy: {
    noMissingTopic: {
      enabled: true,
      gateId: "gate-grown-goal-coverage",
      title: "章节目标必须被正面回应",
      evidenceRequired: "author review confirms the chapter directly answered the chapter goal",
      promptOnlyAllowed: true,
      blockingUntilReviewed: true
    }
  }
});

describe("growXiaoshuoAgent", () => {
  it("clamps the grown length contract to sane bounds", () => {
    expect(grownLengthRule(1500, 2800)).toEqual({ minChars: 1500, maxChars: 2800 });
    expect(grownLengthRule(undefined, undefined)).toEqual({ minChars: 900, maxChars: 1500 });
    expect(grownLengthRule(50, 50)).toEqual({ minChars: 300, maxChars: 600 });
    expect(grownLengthRule(99999, 99999)).toEqual({ minChars: 4000, maxChars: 8000 });
  });

  it("keeps hatch writing constraints consistent with the executable length gate", () => {
    const pkg = buildAuthoringPackage({
      name: "xiaoshuo",
      version: "1.0.0",
      locked: true,
      strategy: {
        systemPrompt: "写作 agent",
        stylePrinciples: [],
        constraints: [
          "单章正文字符数在 1500~3000 之间",
          "保持人物连续"
        ]
      },
      targetWorld: defaultNovelTargetWorld,
      contextPolicy: defaultContextPolicy,
      storyModel: defaultStoryModel,
      harness: defaultHarness,
      coveragePolicy: defaultCoveragePolicy,
      qualityRules: [{ kind: "length", note: "章节正文字数在1500-4000之间" }],
      feedbackRouting: defaultFeedbackRouting,
      minChars: 1500,
      maxChars: 4000,
      grownInProject: "/x",
      readiness: "ready",
      evidenceSummary: "ok",
      model: "m",
      provider: "deepseek"
    });
    expect(pkg.writingStrategy.constraints).not.toContain("单章正文字符数在 1500~3000 之间");
    expect(pkg.writingStrategy.constraints).toContain("正文长度必须满足 qualityRules.length：1500-4000 字符。");
    expect(pkg.writingStrategy.constraints).toContain("保持人物连续");
    const lengthRule = pkg.qualityRules.find((rule) => rule.kind === "length");
    expect(lengthRule?.minChars).toBe(1500);
    expect(lengthRule?.maxChars).toBe(4000);
  });

  it("grows a real grow unit and writes a draft design package without claiming hatch readiness", async () => {
    await withRoot(async (root) => {
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: designFetch(STRATEGY_JSON) });
      const result = await growXiaoshuoAgent(host, { goal: "成长出一个连贯的连载小说写作 agent" });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.strategyChars).toBeGreaterThan(0);
      expect(result.value.lifecycle).toBe("verifying");
      expect(result.value.readiness).toBe("draft");
      expect(result.value.contextMessageListRef?.kind).toBe("message_list");
      expect(result.value.designMessageListPath).toContain(`.feng/grow-agent/design-attempts/${result.value.growUnitId}/initial/message-list.json`);
      expect(result.value.designTracePath).toContain(`.feng/grow-agent/design-attempts/${result.value.growUnitId}/initial/trace.json`);

      const pkgText = await readFile(path.join(root, PACKAGE_PATH), "utf8");
      const pkg = JSON.parse(pkgText);
      expect(pkg.kind).toBe("serialized_authoring_agent");
      expect(pkg.locked).toBe(false);
      expect(pkg.validation.readiness).toBe("draft");
      expect(pkg.validation.evidenceSummary).toContain("design-only draft");
      expect(pkg.targetWorld.description).toContain("读者反馈");
      expect(pkg.targetWorld.inputKinds).toContain("reader_feedback");
      expect(pkg.targetWorld.outputKinds).toEqual(expect.arrayContaining(["chapter_text", "updated_outline", "feedback_candidates"]));
      expect(pkg.targetWorld.actionBoundary).toContain("未经确认不得发布作品");
      expect(pkg.targetWorld.dialogueAllowed).toBe(false);
      expect(pkg.contextPolicy.find((policy: { kind: string }) => policy.kind === "observation")?.title).toBe("本轮作品目标");
      expect(pkg.contextPolicy.find((policy: { kind: string }) => policy.kind === "feedback")?.maxChars).toBe(900);
      expect(pkg.storyModel.trackedFacts).toContain("reader_promises");
      expect(pkg.storyModel.continuityDimensions).toContain("读者承诺");
      expect(pkg.harness.steps).toContain("evaluate_goal_coverage");
      expect(pkg.writingStrategy.systemPrompt).toContain("写作 agent");
      expect(pkg.writingStrategy.stylePrinciples.length).toBeGreaterThan(0);
      expect(pkg.qualityRules.length).toBeGreaterThan(0);
      expect(pkg.feedbackRouting.length).toBeGreaterThan(0);
      expect(pkg.qualityRules.some((rule: { kind: string; note?: string }) =>
        rule.kind === "semantic_plot" && rule.note === "每章必须有明确冲突、推进或回收"
      )).toBe(true);
      expect(pkg.feedbackRouting.some((route: { issueKind: string; layer: string; reason: string }) =>
        route.issueKind === "semantic_plot" &&
        route.layer === "capability" &&
        route.reason.includes("小说 agent 能力需要 re-grow")
      )).toBe(true);
      expect(pkg.coveragePolicy.noMissingTopic.gateId).toBe("gate-grown-goal-coverage");
      expect(pkg.coveragePolicy.noMissingTopic.title).toBe("章节目标必须被正面回应");
      expect(pkg.coveragePolicy.noMissingTopic.evidenceRequired).toContain("directly answered");
      expect(pkg.coveragePolicy.noMissingTopic.promptOnlyAllowed).toBe(false);
      expect(pkg.validation.grownByGrowUnitId).toBe(result.value.growUnitId);

      // the length DoD is owned by the grown agent, not a hardcoded feng default
      const lengthRule = pkg.qualityRules.find((r: { kind: string }) => r.kind === "length");
      expect(lengthRule.minChars).toBe(1500);
      expect(lengthRule.maxChars).toBe(2800);
      expect(lengthRule.note).toBe("每章需要保持连载节奏的正文长度");

      const messageList = JSON.parse(await readFile(path.join(root, result.value.designMessageListPath), "utf8"));
      expect(messageList.kind).toBe("grow_design_message_list");
      expect(messageList.growUnitId).toBe(result.value.growUnitId);
      expect(messageList.contextMessageListRef.id).toBe(result.value.contextMessageListRef?.id);
      expect(messageList.attemptIntentRef.kind).toBe("attempt_intent");
      expect(messageList.messages[0].content[0].text).toContain("coveragePolicy");
      expect(messageList.messages[0].content[0].text).toContain("不能降级为 work 本地问题");
      expect(messageList.messages.some((message: { content: { text: string }[] }) => message.content[0]?.text.includes("当前 grow 状态投影"))).toBe(true);
      const modelOutputPath = result.value.designMessageListPath.replace(/message-list\.json$/, "model-output.json");
      const modelOutput = JSON.parse(await readFile(path.join(root, modelOutputPath), "utf8"));
      expect(modelOutput.kind).toBe("grow_design_model_output");
      expect(modelOutput.contextMessageListRef.id).toBe(result.value.contextMessageListRef?.id);
      expect(modelOutput.parsed.targetWorld.inputKinds).toContain("reader_feedback");
      expect(modelOutput.parsed.contextPolicy.find((policy: { kind: string }) => policy.kind === "observation")?.title).toBe("本轮作品目标");
      expect(modelOutput.parsed.storyModel.continuityDimensions).toContain("读者承诺");
      expect(modelOutput.parsed.harness.steps).toContain("evaluate_goal_coverage");
      expect(modelOutput.parsed.coveragePolicy.noMissingTopic.gateId).toBe("gate-grown-goal-coverage");
      expect(modelOutput.parsed.qualityRules.some((rule: { kind: string }) => rule.kind === "semantic_plot")).toBe(true);
      expect(modelOutput.parsed.feedbackRouting.some((route: { issueKind: string; layer: string }) =>
        route.issueKind === "semantic_plot" && route.layer === "capability"
      )).toBe(true);
      const trace = JSON.parse(await readFile(path.join(root, result.value.designTracePath), "utf8"));
      expect(trace.status).toBe("completed");
      expect(trace.messageListPath).toBe(result.value.designMessageListPath);
      expect(trace.contextMessageListRef.id).toBe(result.value.contextMessageListRef?.id);
      expect(trace.targetWorldInputKinds).toContain("reader_feedback");
      expect(trace.targetWorldOutputKinds).toContain("chapter_text");
      expect(trace.contextSections).toContain("observation:1600");
      expect(trace.storyContinuityDimensions).toContain("读者承诺");
      expect(trace.harnessSteps).toContain("evaluate_goal_coverage");
      expect(trace.coveragePolicyGateId).toBe("gate-grown-goal-coverage");
      expect(trace.qualityRuleKinds).toContain("semantic_plot");
      expect(trace.feedbackRoutingKinds).toContain("semantic_plot->capability");
      expect(trace.promptOnlyAllowed).toBe(false);

      const growRef = makeRef("grow_unit", makeGrowUnitId(result.value.growUnitId));
      const growRecord = await host.grow.getGrowUnit(growRef);
      expect(growRecord.ok).toBe(true);
      if (!growRecord.ok) throw new Error(growRecord.error.message);
      expect(growRecord.value.latestMessageListRef?.id).toBe(result.value.contextMessageListRef?.id);
      if (result.value.contextMessageListRef === undefined) throw new Error("missing context message list ref");
      const explainedMessageList = await host.contextCompiler.explainMessageList(result.value.contextMessageListRef);
      expect(explainedMessageList.ok).toBe(true);
      if (!explainedMessageList.ok) throw new Error(explainedMessageList.error.message);
      expect(explainedMessageList.value.compileReport.growUnitRef.id).toBe(result.value.growUnitId);
      const evidence = await host.evidence.listEvidence(growRef, { sourceKind: "candidate_output" });
      expect(evidence.ok).toBe(true);
      if (!evidence.ok) throw new Error(evidence.error.message);
      const artifactRef = evidence.value.records[0]?.artifactRef;
      expect(artifactRef).toBeDefined();
      if (artifactRef === undefined) throw new Error("missing candidate evidence artifact");
      const materialized = await host.artifacts.materializeArtifact(artifactRef, { reason: "read grown design evidence", maxBytes: 64 * 1024 });
      expect(materialized.ok).toBe(true);
      if (!materialized.ok) throw new Error(materialized.error.message);
      const grownDesign = typeof materialized.value.content === "string" ? JSON.parse(materialized.value.content) : {};
      expect(grownDesign.designed.targetWorld.inputKinds).toContain("reader_feedback");
      expect(grownDesign.designed.contextPolicy.find((policy: { kind: string }) => policy.kind === "observation")?.title).toBe("本轮作品目标");
      expect(grownDesign.designed.storyModel.trackedFacts).toContain("reader_promises");
      expect(grownDesign.designed.coveragePolicy.noMissingTopic.gateId).toBe("gate-grown-goal-coverage");
      expect(grownDesign.designed.qualityRules.some((rule: { kind: string }) => rule.kind === "semantic_plot")).toBe(true);
      expect(grownDesign.artifacts.messageListPath).toBe(result.value.designMessageListPath);

      const compiled = compileMessageList(pkg, {
        premise: "李白重生现代",
        title: "李白重生了",
        chapterNumber: 1,
        chapterGoal: "李白第一次面对读者直播反馈",
        priorOutlines: [],
        characterBible: "李白：诗仙",
        worldBible: "现代成都",
        acceptedFeedback: ["读者希望保留诗意"]
      });
      expect(compiled.record.sections.find((section) => section.kind === "observation")?.title).toBe("本轮作品目标");
      expect(compiled.record.sections.find((section) => section.kind === "feedback")?.charsUsed).toBeLessThanOrEqual(900);
      expect(compiled.record.systemPrompt).toContain("读者承诺");

      // grow unit really exists and advanced beyond a bare intake record
      const grow = await host.grow.getGrowUnit({ kind: "grow_unit", id: result.value.growUnitId } as never);
      expect(grow.ok).toBe(true);
    });
  });

  it("falls back to a default strategy when the model returns non-JSON", async () => {
    await withRoot(async (root) => {
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: designFetch("抱歉我无法输出 JSON") });
      const result = await growXiaoshuoAgent(host, { goal: "写小说 agent" });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.writingStrategy.systemPrompt.length).toBeGreaterThan(0);
      expect(pkg.coveragePolicy.noMissingTopic.gateId).toBe("gate-chapter-goal-coverage");
      expect(pkg.locked).toBe(false);
      expect(pkg.validation.readiness).toBe("draft");
      const modelOutputPath = result.value.designMessageListPath.replace(/message-list\.json$/, "model-output.json");
      const modelOutput = JSON.parse(await readFile(path.join(root, modelOutputPath), "utf8"));
      expect(modelOutput.parseOk).toBe(false);
      expect(modelOutput.designStatus).toBe("incomplete");
      expect(modelOutput.incompleteReasons).toContain("model output did not contain parseable strategy JSON");
      expect(modelOutput.missingGeneratedFields).toEqual(expect.arrayContaining(["targetWorld", "contextPolicy", "qualityRules", "feedbackRouting", "coveragePolicy"]));
      const trace = JSON.parse(await readFile(path.join(root, result.value.designTracePath), "utf8"));
      expect(trace.status).toBe("incomplete");
      expect(trace.parseOk).toBe(false);
      expect(trace.incompleteReasons).toContain("model output did not contain parseable strategy JSON");
      expect(trace.missingGeneratedFields).toEqual(expect.arrayContaining(["targetWorld", "contextPolicy", "qualityRules", "feedbackRouting", "coveragePolicy"]));
    });
  });

  it("marks truncated design output incomplete instead of trusting parsed fallback fields", async () => {
    await withRoot(async (root) => {
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: designFetch(STRATEGY_JSON, "length") });
      const result = await growXiaoshuoAgent(host, { goal: "写小说 agent" });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const modelOutputPath = result.value.designMessageListPath.replace(/message-list\.json$/, "model-output.json");
      const modelOutput = JSON.parse(await readFile(path.join(root, modelOutputPath), "utf8"));
      expect(modelOutput.finishReason).toBe("length");
      expect(modelOutput.parseOk).toBe(true);
      expect(modelOutput.designStatus).toBe("incomplete");
      expect(modelOutput.incompleteReasons).toContain("model finishReason=length");
      expect(modelOutput.parsed.generatedFields).toEqual({
        targetWorld: false,
        contextPolicy: false,
        storyModel: false,
        harness: false,
        qualityRules: false,
        feedbackRouting: false,
        coveragePolicy: false
      });
      const trace = JSON.parse(await readFile(path.join(root, result.value.designTracePath), "utf8"));
      expect(trace.status).toBe("incomplete");
      expect(trace.finishReason).toBe("length");
      expect(trace.incompleteReasons).toContain("model finishReason=length");
      expect(trace.missingGeneratedFields).toEqual(["targetWorld", "contextPolicy", "storyModel", "harness", "qualityRules", "feedbackRouting", "coveragePolicy"]);
    });
  });

  it("parses a fenced JSON code block", async () => {
    await withRoot(async (root) => {
      const fenced = "```json\n" + STRATEGY_JSON + "\n```";
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: designFetch(fenced) });
      const result = await growXiaoshuoAgent(host, { goal: "写小说 agent", name: "xiaoshuo", version: "2.0.0" });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.version).toBe("2.0.0");
      expect(pkg.writingStrategy.stylePrinciples).toContain("有对话");
    });
  });

  it("normalizes a grow-authored coverage gate id instead of silently falling back", async () => {
    await withRoot(async (root) => {
      const raw = JSON.parse(STRATEGY_JSON);
      raw.coveragePolicy.noMissingTopic.gateId = "output-requirements";
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: designFetch(JSON.stringify(raw)) });
      const result = await growXiaoshuoAgent(host, { goal: "写小说 agent" });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.coveragePolicy.noMissingTopic.gateId).toBe("gate-output-requirements");
      const trace = JSON.parse(await readFile(path.join(root, result.value.designTracePath), "utf8"));
      expect(trace.generatedFields.coveragePolicy).toBe(true);
      expect(trace.coveragePolicyGateId).toBe("gate-output-requirements");
    });
  });
});

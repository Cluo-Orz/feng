import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFengHost, feedbackDigestDetailKey, growXiaoshuoAgentLoop, resolveSystemFeedback, SYSTEM_DIGEST_PATH } from "../../src/host/index.js";
import { XIAOSHUO_QUALITY_GATE_PATH } from "../../src/authoring-runtime/index.js";
import { makeGrowUnitId, makeRef } from "../../src/domain/index.js";
import { PACKAGE_PATH } from "../../src/runtime-package/index.js";
import type { FetchLike } from "../../src/providers/index.js";

const provider = { provider: "deepseek", apiKey: "k", baseUrl: "https://api.deepseek.com", model: "m", maxTokens: 256, reasoningModel: true };
const CAPABILITY_ADOPTION_PATH = ".feng/grow-inbox/capability-feedback-adoption.json";

const STRATEGY = JSON.stringify({
  systemPrompt: "你是连载小说写作 agent，保持连贯。",
  stylePrinciples: ["生动"],
  constraints: ["章节连续"],
  minChars: 800,
  maxChars: 4000,
  targetWorld: {
    description: "连载式中文小说创作",
    inputKinds: ["premise", "chapter_goal", "prior_outline"],
    outputKinds: ["chapter_text", "updated_outline", "feedback_candidates"],
    actionBoundary: ["只写入作品目录和 .feng 运行记录"],
    failureHandling: ["质量不达标时记录反馈并重试"],
    dialogueAllowed: false
  },
  contextPolicy: [
    { kind: "observation", title: "本轮目标", source: "chapter_goal", maxChars: 1000 },
    { kind: "short_term", title: "前情", source: "chapter_outlines", maxChars: 1000 },
    { kind: "long_term", title: "设定", source: "character_bible", maxChars: 1000 }
  ],
  storyModel: {
    trackedFacts: ["premise", "character_bible", "chapter_outlines"],
    continuityDimensions: ["人物承接", "大纲连续", "文风一致"]
  },
  harness: {
    steps: ["run_chapter", "evaluate_chapter", "route_feedback"]
  },
  coveragePolicy: {
    noMissingTopic: {
      enabled: true,
      gateId: "gate-grown-loop-goal-coverage",
      title: "本章目标必须落到正文事件",
      evidenceRequired: "review evidence proves the chapter goal is answered by concrete plot events",
      promptOnlyAllowed: true,
      blockingUntilReviewed: true
    }
  },
  qualityRules: [
    { kind: "length", minChars: 800, maxChars: 4000, note: "每章中文字数区间" },
    { kind: "chapter_continuity", note: "章节编号必须连续" },
    { kind: "character_continuation", note: "人物承接必须连续" },
    { kind: "artifact_presence", note: "每章须有 message-list / trace / quality eval" }
  ],
  feedbackRouting: [
    { issueKind: "length", layer: "work", reason: "单章字数是作品级问题" },
    { issueKind: "character_continuation", layer: "capability", reason: "反复忘前文是写作能力问题" },
    { issueKind: "goal_coverage", layer: "capability", reason: "章节漏题是目标执行能力问题" },
    { issueKind: "semantic_style", layer: "capability", reason: "文风不足是写作能力问题" },
    { issueKind: "semantic_character", layer: "capability", reason: "人物可信度不足是写作能力问题" },
    { issueKind: "semantic_plot", layer: "capability", reason: "情节推进不足是写作能力问题" },
    { issueKind: "runtime_capability", layer: "system", reason: "运行 kernel 不能表达所需能力" },
    { issueKind: "artifact_presence", layer: "system", reason: "运行记录缺失是系统问题" }
  ]
});

const body = (chars: number) => "正文".repeat(chars);

function llmResponse(content: string, id = "judge", finishReason = "stop") {
  return {
    ok: true,
    status: 200,
    json: async () => ({ id, model: "m", choices: [{ message: { content }, finish_reason: finishReason }], usage: {} }),
    text: async () => ""
  };
}

function requestText(init: Parameters<FetchLike>[1]): string {
  try {
    const parsed = JSON.parse(init.body) as { readonly messages?: readonly { readonly content?: string }[] };
    return (parsed.messages ?? []).map((message) => message.content ?? "").join("\n");
  } catch {
    return init.body;
  }
}

function withJudges(fetch: FetchLike, options: { readonly goalCovered?: boolean | readonly boolean[] } = {}): FetchLike {
  let goalJudgeCalls = 0;
  return async (url, init) => {
    const text = requestText(init);
    if (text.includes("严格的中文小说质量评审")) {
      return llmResponse('{"style": 9, "character": 9, "plot": 9, "problems": [], "notes": "样例达标"}');
    }
    if (text.includes("严格的章节目标覆盖评审")) {
      const rawCovered = options.goalCovered ?? true;
      const covered = Array.isArray(rawCovered)
        ? rawCovered[Math.min(goalJudgeCalls, rawCovered.length - 1)] ?? true
        : rawCovered;
      goalJudgeCalls += 1;
      return llmResponse(covered
        ? '{"covered": true, "confidence": 0.92, "evidence": ["样例章节回应了本章目标"], "missing": [], "notes": "目标已覆盖"}'
        : '{"covered": false, "confidence": 0.91, "evidence": [], "missing": ["样例章节没有回应本章目标"], "notes": "目标未覆盖"}');
    }
    return fetch(url, init);
  };
}

// Round 1 (calls 2-3): chapter 2's opening does NOT mention 林越 -> capability
// issue (character_continuation). Round 2 (calls 4-5): openings DO mention 林越
// -> no capability issue. The design call is call 1.
function loopFetch(): FetchLike {
  let n = 0;
  return async () => {
    n += 1;
    let content: string;
    if (n === 1) content = STRATEGY;
    else if (n === 2) content = `林越捡到徽章。${body(500)}\n===OUTLINE===\n第1章`;
    else if (n === 3) content = `一个全新的陌生人登场了。${body(500)}\n===OUTLINE===\n第2章`;
    else content = `林越继续行动。${body(500)}\n===OUTLINE===\n续章`;
    return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
  };
}

function semanticRedesignFetch(): FetchLike {
  let designCalls = 0;
  return async (_url, init) => {
    const text = requestText(init);
    if (text.includes("feng 的通用 agent 设计内核")) {
      designCalls += 1;
      const strategy = JSON.parse(STRATEGY);
      strategy.systemPrompt = designCalls === 1
        ? "initial semantic strategy"
        : "redesigned semantic strategy";
      strategy.constraints = designCalls === 1
        ? ["章节连续"]
        : ["章节连续", "语义反馈必须改变写作策略"];
      return llmResponse(JSON.stringify(strategy), `design-${designCalls}`);
    }
    if (text.includes("严格的中文小说质量评审")) {
      return designCalls < 2
        ? llmResponse('{"style": 7, "character": 9, "plot": 9, "problems": [{"dimension":"style","evidence":"比喻堆叠","suggestion":"减少修辞堆叠"}], "notes": "文风需修"}')
        : llmResponse('{"style": 9, "character": 9, "plot": 9, "problems": [], "notes": "样例达标"}');
    }
    if (text.includes("严格的章节目标覆盖评审")) {
      return llmResponse('{"covered": true, "confidence": 0.92, "evidence": ["样例章节回应了本章目标"], "missing": [], "notes": "目标已覆盖"}');
    }
    return llmResponse(`林越登场并追查徽章。${body(500)}\n===OUTLINE===\n章`);
  };
}

function truncatedSemanticRedesignFetch(): FetchLike {
  let designCalls = 0;
  return async (_url, init) => {
    const text = requestText(init);
    if (text.includes("feng 的通用 agent 设计内核")) {
      designCalls += 1;
      if (designCalls === 1) return llmResponse(STRATEGY, "design-1");
      return llmResponse('{"systemPrompt":"truncated redesign"', "design-2", "length");
    }
    if (text.includes("严格的中文小说质量评审")) {
      return designCalls < 2
        ? llmResponse('{"style": 7, "character": 9, "plot": 9, "problems": [{"dimension":"style","evidence":"样例语句平直","suggestion":"增加场景压力"}], "notes": "文风需修"}')
        : llmResponse('{"style": 9, "character": 9, "plot": 9, "problems": [], "notes": "样例达标"}');
    }
    if (text.includes("严格的章节目标覆盖评审")) {
      return llmResponse('{"covered": true, "confidence": 0.92, "evidence": ["样例章节回应了本章目标"], "missing": [], "notes": "目标已覆盖"}');
    }
    return llmResponse(`林越登场并追查徽章。${body(500)}\n===OUTLINE===\n章`);
  };
}

function checkpointThenFailureFetch(): FetchLike {
  let chapterCalls = 0;
  let goalCoverageCalls = 0;
  return async (_url, init) => {
    const text = requestText(init);
    if (text.includes("feng 的通用 agent 设计内核")) {
      return llmResponse(STRATEGY, "design");
    }
    if (text.includes("严格的中文小说质量评审")) {
      return llmResponse('{"style": 9, "character": 9, "plot": 9, "problems": [], "notes": "样例达标"}');
    }
    if (text.includes("严格的章节目标覆盖评审")) {
      goalCoverageCalls += 1;
      return llmResponse(goalCoverageCalls === 1
        ? '{"covered": false, "confidence": 0.91, "evidence": [], "missing": ["样例章节没有回应本章目标"], "notes": "目标未覆盖"}'
        : '{"covered": true, "confidence": 0.92, "evidence": ["样例章节回应了本章目标"], "missing": [], "notes": "目标已覆盖"}');
    }
    chapterCalls += 1;
    if (chapterCalls > 1) {
      return { ok: false, status: 500, json: async () => ({}), text: async () => "simulated provider failure after checkpoint" };
    }
    return llmResponse(`林越登场并追查徽章。${body(500)}\n===OUTLINE===\n章`);
  };
}

async function withRoot(b: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "feng-loop-"));
  try {
    await b(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("growXiaoshuoAgentLoop", () => {
  it("runs multiple rounds, revises after a capability failure, and improves", async () => {
    await withRoot(async (root) => {
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: withJudges(loopFetch()) });
      const result = await growXiaoshuoAgentLoop(host, { goal: "成长出连贯小说 agent", maxRounds: 2, sampleChapters: 2 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);

      // round 1 found a capability issue; round 2 added a constraint and cleared it
      expect(result.value.rounds.length).toBe(2);
      expect(result.value.rounds[0]?.capabilityIssueKinds).toContain("character_continuation");
      expect(result.value.rounds[0]?.addedConstraints.length).toBeGreaterThan(0);
      expect(result.value.rounds[1]?.capabilityIssueKinds.length).toBe(0);
      expect(result.value.improved).toBe(true);
      expect(result.value.finalCapabilityIssues).toBe(0);
      expect(result.value.readiness).toBe("ready");
      expect(result.value.lifecycle).toBe("ready_to_hatch");
      expect(result.value.contextMessageListRef?.kind).toBe("message_list");
      expect(result.value.designMessageListPath).toContain(`.feng/grow-agent/design-attempts/${result.value.growUnitId}/loop-design/message-list.json`);
      const designMessageList = JSON.parse(await readFile(path.join(root, result.value.designMessageListPath), "utf8"));
      expect(designMessageList.kind).toBe("grow_design_message_list");
      expect(designMessageList.contextMessageListRef.id).toBe(result.value.contextMessageListRef?.id);
      expect(designMessageList.messages[0].content[0].text).toContain("coveragePolicy");
      const designTrace = JSON.parse(await readFile(path.join(root, result.value.designTracePath), "utf8"));
      expect(designTrace.messageListPath).toBe(result.value.designMessageListPath);
      expect(designTrace.contextMessageListRef.id).toBe(result.value.contextMessageListRef?.id);
      expect(designTrace.coveragePolicyGateId).toBe("gate-grown-loop-goal-coverage");
      const growRef = makeRef("grow_unit", makeGrowUnitId(result.value.growUnitId));
      const growRecord = await host.grow.getGrowUnit(growRef);
      expect(growRecord.ok).toBe(true);
      if (!growRecord.ok) throw new Error(growRecord.error.message);
      expect(growRecord.value.latestMessageListRef?.id).toBe(result.value.contextMessageListRef?.id);

      // file-native round evidence exists
      const sampleRoot = path.join(root, ".feng", "grow-samples", result.value.growUnitId);
      const r1 = JSON.parse(await readFile(path.join(sampleRoot, "round-1", "round-report.json"), "utf8"));
      expect(r1.capabilityIssueKinds).toContain("character_continuation");
      const gates = JSON.parse(await readFile(path.join(root, XIAOSHUO_QUALITY_GATE_PATH), "utf8"));
      expect(result.value.qualityGatePath).toBe(XIAOSHUO_QUALITY_GATE_PATH);
      expect(gates.kind).toBe("xiaoshuo_quality_gate_set");
      expect(gates.summary.blockingCount).toBe(0);
      expect(gates.coverage.some((item: { requirement: string; status: string }) => item.requirement === "成长出连贯小说 agent" && item.status === "covered")).toBe(true);
      expect(gates.gates.some((gate: { gateId: string; status: string }) => gate.gateId === "gate-character-continuation" && gate.status === "passed")).toBe(true);
      expect(gates.gates.some((gate: { gateId: string; status: string }) => gate.gateId === "gate-grown-coverage-policy" && gate.status === "passed")).toBe(true);
      expect(gates.gates.some((gate: { gateId: string; status: string }) => gate.gateId === "gate-user-goal-item-coverage" && gate.status === "passed")).toBe(true);

      // final package is locked and ready, and carries the revised constraint
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.locked).toBe(true);
      expect(pkg.validation.readiness).toBe("ready");
      expect(pkg.validation.qualityGateRef).toBe(XIAOSHUO_QUALITY_GATE_PATH);
      expect(pkg.validation.targetCoverageRef).toContain("#coverage");
      expect(pkg.validation.qualityGateSummary).toContain("blocking=0");
      expect(pkg.validation.sampleEvidenceRefs).toContain(`.feng/grow-samples/${result.value.growUnitId}/round-1/round-report.json`);
      expect(pkg.validation.sampleEvidenceRefs).toContain(`.feng/grow-samples/${result.value.growUnitId}/round-2/.feng/runtime/chapters/chapter-01/quality-gates.json`);
      expect(pkg.validation.sampleEvidenceRefs).toContain(`.feng/grow-samples/${result.value.growUnitId}/round-2/.feng/runtime/chapters/chapter-01/goal-coverage-eval.json`);
      expect(pkg.writingStrategy.constraints.some((c: string) => c.includes("人物承接"))).toBe(true);
      expect(pkg.storyModel.trackedFacts.length).toBeGreaterThan(0);
      expect(pkg.coveragePolicy.noMissingTopic.gateId).toBe("gate-grown-loop-goal-coverage");
      expect(pkg.coveragePolicy.noMissingTopic.title).toBe("本章目标必须落到正文事件");
      expect(pkg.coveragePolicy.noMissingTopic.promptOnlyAllowed).toBe(false);
    });
  });

  it("keeps sample projects isolated per grow unit", async () => {
    await withRoot(async (root) => {
      const fetch: FetchLike = async (_url, init) => {
        const text = requestText(init);
        if (text.includes("feng 的通用 agent 设计内核")) return llmResponse(STRATEGY, "design");
        return llmResponse(`林越登场并追查徽章。${body(500)}\n===OUTLINE===\n第1章`);
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: withJudges(fetch) });
      const first = await growXiaoshuoAgentLoop(host, { goal: "第一次 grow", maxRounds: 1, sampleChapters: 1 });
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error(first.error.message);
      const second = await growXiaoshuoAgentLoop(host, { goal: "第二次 grow", maxRounds: 1, sampleChapters: 1 });
      expect(second.ok).toBe(true);
      if (!second.ok) throw new Error(second.error.message);

      expect(first.value.growUnitId).not.toBe(second.value.growUnitId);
      const firstState = JSON.parse(await readFile(path.join(root, ".feng", "grow-samples", first.value.growUnitId, "round-1", ".feng", "runtime", "novel-state.json"), "utf8"));
      const secondState = JSON.parse(await readFile(path.join(root, ".feng", "grow-samples", second.value.growUnitId, "round-1", ".feng", "runtime", "novel-state.json"), "utf8"));
      expect(firstState.chapters).toHaveLength(1);
      expect(secondState.chapters).toHaveLength(1);
      expect(second.value.rounds[0]?.sampleDir).toBe(`.feng/grow-samples/${second.value.growUnitId}/round-1`);
    });
  });

  it("writes a draft checkpoint after a completed round before a later round fails", async () => {
    await withRoot(async (root) => {
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: checkpointThenFailureFetch() });
      const result = await growXiaoshuoAgentLoop(host, { goal: "成长出连贯小说 agent", maxRounds: 2, sampleChapters: 1 });
      expect(result.ok).toBe(false);

      const checkpoint = JSON.parse(await readFile(path.join(root, ".feng", "grow-samples", "latest-checkpoint.json"), "utf8"));
      expect(checkpoint.status).toBe("checkpoint_draft");
      expect(checkpoint.latestRound).toBe(1);
      expect(checkpoint.packagePath).toBe(PACKAGE_PATH);
      expect(checkpoint.qualityGatePath).toBe(XIAOSHUO_QUALITY_GATE_PATH);
      expect(checkpoint.note).toContain("not a ready hatch result");

      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.locked).toBe(false);
      expect(pkg.validation.readiness).toBe("draft");
      expect(pkg.validation.evidenceSummary).toContain("checkpoint_draft");
      expect(pkg.validation.qualityGateRef).toBe(XIAOSHUO_QUALITY_GATE_PATH);

      const gates = JSON.parse(await readFile(path.join(root, XIAOSHUO_QUALITY_GATE_PATH), "utf8"));
      expect(gates.readiness).toBe("checkpoint_draft");
      expect(gates.sampleRoundCount).toBe(1);
      expect(gates.summary.blockingCount).toBeGreaterThan(0);
    });
  });

  it("redesigns the strategy from semantic sample feedback instead of only appending constraints", async () => {
    await withRoot(async (root) => {
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: semanticRedesignFetch() });
      const result = await growXiaoshuoAgentLoop(host, { goal: "成长出高质量小说 agent", maxRounds: 2, sampleChapters: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.rounds).toHaveLength(2);
      expect(result.value.rounds[0]?.capabilityIssueKinds).toContain("semantic_style");
      expect(result.value.rounds[1]?.capabilityIssueKinds).toHaveLength(0);
      expect(result.value.designMessageListPath).toContain(`.feng/grow-agent/design-attempts/${result.value.growUnitId}/round-1-redesign/message-list.json`);

      const redesignMessageList = JSON.parse(await readFile(path.join(root, result.value.designMessageListPath), "utf8"));
      expect(JSON.stringify(redesignMessageList)).toContain("sample round 1 evidence");
      expect(JSON.stringify(redesignMessageList)).toContain("比喻堆叠");
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.writingStrategy.systemPrompt).toBe("redesigned semantic strategy");
      expect(pkg.writingStrategy.constraints).toContain("语义反馈必须改变写作策略");
      expect(pkg.locked).toBe(true);
    });
  });

  it("does not let an incomplete sample redesign replace a complete grown design", async () => {
    await withRoot(async (root) => {
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: truncatedSemanticRedesignFetch() });
      const result = await growXiaoshuoAgentLoop(host, { goal: "成长出高质量小说 agent", maxRounds: 2, sampleChapters: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.rounds).toHaveLength(2);
      expect(result.value.rounds[0]?.capabilityIssueKinds).toContain("semantic_style");
      expect(result.value.rounds[1]?.capabilityIssueKinds).toHaveLength(0);
      expect(result.value.designMessageListPath).toContain(`.feng/grow-agent/design-attempts/${result.value.growUnitId}/loop-design/message-list.json`);

      const redesignTrace = JSON.parse(await readFile(path.join(root, ".feng", "grow-agent", "design-attempts", result.value.growUnitId, "round-1-redesign", "trace.json"), "utf8"));
      expect(redesignTrace.status).toBe("incomplete");
      expect(redesignTrace.finishReason).toBe("length");
      expect(redesignTrace.generatedFields.coveragePolicy).toBe(false);

      const gates = JSON.parse(await readFile(path.join(root, XIAOSHUO_QUALITY_GATE_PATH), "utf8"));
      expect(gates.gates.some((gate: { gateId: string; status: string }) => gate.gateId === "gate-grown-coverage-policy" && gate.status === "passed")).toBe(true);
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.locked).toBe(true);
      expect(pkg.validation.readiness).toBe("ready");
      expect(pkg.writingStrategy.systemPrompt).toBe("你是连载小说写作 agent，保持连贯。");
      expect(pkg.writingStrategy.constraints.some((constraint: string) => constraint.includes("提升文风与可读性"))).toBe(true);
      expect(pkg.coveragePolicy.noMissingTopic.gateId).toBe("gate-grown-loop-goal-coverage");
      expect(pkg.validation.qualityGateSummary).toContain("blocking=0");
    });
  });

  it("stays draft (unlocked) when capability issues persist across all rounds", async () => {
    await withRoot(async (root) => {
      // every chapter opening lacks 林越 -> capability issue never clears
      let n = 0;
      const persistent: FetchLike = async () => {
        n += 1;
        const content = n === 1 ? STRATEGY : `陌生人登场。${body(500)}\n===OUTLINE===\n章`;
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: withJudges(persistent) });
      const result = await growXiaoshuoAgentLoop(host, { goal: "g", maxRounds: 2, sampleChapters: 2 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.finalCapabilityIssues).toBeGreaterThan(0);
      const gates = JSON.parse(await readFile(path.join(root, XIAOSHUO_QUALITY_GATE_PATH), "utf8"));
      expect(gates.summary.blockingCount).toBeGreaterThan(0);
      expect(gates.gates.some((gate: { gateId: string; status: string }) => gate.gateId === "gate-character-continuation" && gate.status === "failed")).toBe(true);
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.locked).toBe(false);
      expect(pkg.validation.readiness).toBe("draft");
      expect(pkg.validation.qualityGateSummary).toContain("blocking=");
    });
  });

  it("locks on the first round when the sample run has no capability issues", async () => {
    await withRoot(async (root) => {
      let n = 0;
      const cleanFetch: FetchLike = async () => {
        n += 1;
        const content = n === 1
          ? STRATEGY
          : `林越登场。${"正文".repeat(500)}\n===OUTLINE===\n章`;
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: withJudges(cleanFetch) });
      const result = await growXiaoshuoAgentLoop(host, { goal: "g", maxRounds: 3, sampleChapters: 2 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.rounds.length).toBe(1);
      expect(result.value.improved).toBe(true);
      expect(result.value.finalCapabilityIssues).toBe(0);
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.locked).toBe(true);
      expect(pkg.validation.readiness).toBe("ready");
    });
  });

  it("keeps the package draft when the design output omits its own no-missing-topic gate", async () => {
    await withRoot(async (root) => {
      let n = 0;
      const missingCoveragePolicyFetch: FetchLike = async () => {
        n += 1;
        const content = n === 1
          ? JSON.stringify({ systemPrompt: "你是写作 agent。", stylePrinciples: [], constraints: [] })
          : `林越登场。${"正文".repeat(500)}\n===OUTLINE===\n章`;
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: withJudges(missingCoveragePolicyFetch) });
      const result = await growXiaoshuoAgentLoop(host, { goal: "g", maxRounds: 1, sampleChapters: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.finalCapabilityIssues).toBe(0);
      expect(result.value.readiness).toBe("draft");

      const trace = JSON.parse(await readFile(path.join(root, result.value.designTracePath), "utf8"));
      expect(trace.generatedFields.coveragePolicy).toBe(false);
      const gates = JSON.parse(await readFile(path.join(root, XIAOSHUO_QUALITY_GATE_PATH), "utf8"));
      const designGate = gates.gates.find((gate: { gateId: string }) => gate.gateId === "gate-grown-coverage-policy");
      expect(designGate?.status).toBe("failed");
      expect(designGate?.notes).toContain("authoredByGrow=false");
      const coverage = gates.coverage.find((item: { requirement: string }) => item.requirement === "coverage_policy:noMissingTopic");
      expect(coverage?.status).toBe("uncovered");
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.locked).toBe(false);
      expect(pkg.validation.readiness).toBe("draft");
    });
  });

  it("keeps the package draft when a user-goal item has no generated gate coverage", async () => {
    await withRoot(async (root) => {
      let n = 0;
      const cleanFetch: FetchLike = async () => {
        n += 1;
        const content = n === 1
          ? STRATEGY
          : `林越登场。${"正文".repeat(500)}\n===OUTLINE===\n章`;
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: withJudges(cleanFetch) });
      const result = await growXiaoshuoAgentLoop(host, {
        goal: "成长出连贯小说 agent、写音乐 agent",
        maxRounds: 1,
        sampleChapters: 1
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.finalCapabilityIssues).toBe(0);
      expect(result.value.readiness).toBe("draft");
      const gates = JSON.parse(await readFile(path.join(root, XIAOSHUO_QUALITY_GATE_PATH), "utf8"));
      const coveredItem = gates.coverage.find((item: { requirement: string }) => item.requirement.startsWith("goal_item:") && item.requirement.includes("连贯小说"));
      const uncoveredItem = gates.coverage.find((item: { requirement: string }) => item.requirement.startsWith("goal_item:") && item.requirement.includes("写音乐"));
      expect(coveredItem?.status).toBe("covered");
      expect(coveredItem?.mappedGateIds.length).toBeGreaterThan(0);
      expect(uncoveredItem?.status).toBe("uncovered");
      expect(uncoveredItem?.mappedGateIds).toEqual([]);
      expect(uncoveredItem?.notes.join("\n")).toContain("no generated runtime contract");
      const noMissingGoalGate = gates.gates.find((gate: { gateId: string }) => gate.gateId === "gate-user-goal-item-coverage");
      expect(noMissingGoalGate?.status).toBe("failed");
      expect(noMissingGoalGate?.notes).toContain("uncovered=1");
      expect(gates.summary.uncoveredRequirements).toBeGreaterThan(0);
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.locked).toBe(false);
      expect(pkg.validation.readiness).toBe("draft");
      expect(pkg.validation.qualityGateSummary).toContain("coverage_uncovered=");
    });
  });

  it("keeps the package draft when sample chapter goal coverage gates are blocking", async () => {
    await withRoot(async (root) => {
      let n = 0;
      const cleanFetch: FetchLike = async () => {
        n += 1;
        const content = n === 1
          ? STRATEGY
          : `林越登场。${"正文".repeat(500)}\n===OUTLINE===\n章`;
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: withJudges(cleanFetch, { goalCovered: false }) });
      const result = await growXiaoshuoAgentLoop(host, { goal: "g", maxRounds: 1, sampleChapters: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.finalCapabilityIssues).toBe(0);
      expect(result.value.readiness).toBe("draft");
      expect(result.value.lifecycle).not.toBe("ready_to_hatch");
      expect(result.value.rounds[0]?.qualityGateBlockingCount).toBeGreaterThan(0);
      const sampleRoot = path.join(root, ".feng", "grow-samples", result.value.growUnitId);
      const round = JSON.parse(await readFile(path.join(sampleRoot, "round-1", "round-report.json"), "utf8"));
      expect(round.qualityGateBlockingCount).toBeGreaterThan(0);
      const sampleGates = JSON.parse(await readFile(path.join(sampleRoot, "round-1", ".feng", "runtime", "chapters", "chapter-01", "quality-gates.json"), "utf8"));
      expect(sampleGates.gates.some((gate: { gateId: string; status: string }) =>
        gate.gateId === "gate-grown-loop-goal-coverage" && gate.status === "failed"
      )).toBe(true);
      const gates = JSON.parse(await readFile(path.join(root, XIAOSHUO_QUALITY_GATE_PATH), "utf8"));
      expect(gates.gates.some((gate: { gateId: string; status: string; notes: string[] }) =>
        gate.gateId === "gate-sample-work-quality-gates" &&
        gate.status === "failed" &&
        gate.notes.some((note) => note.includes("sampleGateBlockingCount="))
      )).toBe(true);
      const goalCoverage = gates.coverage.find((item: { requirement: string }) => item.requirement === "g");
      expect(goalCoverage?.status).toBe("uncovered");
      expect(goalCoverage?.mappedGateIds).toContain("gate-sample-work-quality-gates");
      expect(gates.summary.uncoveredRequirements).toBeGreaterThan(0);
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.locked).toBe(false);
      expect(pkg.validation.readiness).toBe("draft");
      expect(pkg.validation.evidenceSummary).toContain("sampleGateBlocking=");
      expect(pkg.validation.qualityGateSummary).toContain("coverage_uncovered=");
      expect(pkg.validation.sampleEvidenceRefs).toContain(`.feng/grow-samples/${result.value.growUnitId}/round-1/round-report.json`);
      expect(pkg.validation.sampleEvidenceRefs).toContain(`.feng/grow-samples/${result.value.growUnitId}/round-1/.feng/runtime/chapters/chapter-01/quality-gates.json`);
      expect(pkg.validation.sampleEvidenceRefs).toContain(`.feng/grow-samples/${result.value.growUnitId}/round-1/.feng/runtime/chapters/chapter-01/goal-coverage-eval.json`);
    });
  });

  it("revises the strategy after a sample goal coverage failure and can hatch after revalidation", async () => {
    await withRoot(async (root) => {
      let n = 0;
      const cleanFetch: FetchLike = async () => {
        n += 1;
        const content = n === 1
          ? STRATEGY
          : `林越登场并追查徽章。${"正文".repeat(500)}\n===OUTLINE===\n章`;
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const host = await createFengHost({
        config: { workspaceRoot: root, provider },
        fetchImpl: withJudges(cleanFetch, { goalCovered: [false, true] })
      });
      const result = await growXiaoshuoAgentLoop(host, { goal: "g", maxRounds: 2, sampleChapters: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.rounds).toHaveLength(2);
      expect(result.value.rounds[0]?.goalCoverageIssueCount).toBe(1);
      expect(result.value.rounds[0]?.qualityGateBlockingCount).toBeGreaterThan(0);
      expect(result.value.rounds[0]?.addedConstraints.some((constraint) => constraint.includes("本章目标"))).toBe(true);
      expect(result.value.rounds[1]?.goalCoverageIssueCount).toBe(0);
      expect(result.value.rounds[1]?.qualityGateBlockingCount).toBe(0);
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.locked).toBe(true);
      expect(pkg.validation.readiness).toBe("ready");
      expect(pkg.writingStrategy.constraints.some((constraint: string) => constraint.includes("本章目标"))).toBe(true);
    });
  });

  it("calibrates its length contract upward when sample chapters overflow", async () => {
    await withRoot(async (root) => {
      let n = 0;
      // agent declares a tight max (900) but the model writes ~2000 chars;
      // the loop should widen maxChars from sample evidence
      const overflowFetch: FetchLike = async () => {
        n += 1;
        const content = n === 1
          ? JSON.stringify({
            systemPrompt: "你是写作 agent。",
            stylePrinciples: [],
            constraints: [],
            minChars: 600,
            maxChars: 900,
            coveragePolicy: {
              noMissingTopic: {
                enabled: true,
                gateId: "gate-grown-loop-goal-coverage",
                title: "本章目标必须落到正文事件",
                evidenceRequired: "review evidence proves the chapter goal is answered by concrete plot events",
                promptOnlyAllowed: true,
                blockingUntilReviewed: true
              }
            }
          })
          : `林越登场。${"正文".repeat(1000)}\n===OUTLINE===\n章`;
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: withJudges(overflowFetch) });
      const result = await growXiaoshuoAgentLoop(host, { goal: "g", maxRounds: 3, sampleChapters: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      const lengthRule = pkg.qualityRules.find((r: { kind: string }) => r.kind === "length");
      // widened from the declared 900 to accommodate the ~2000-char samples
      expect(lengthRule.maxChars).toBeGreaterThan(900);
    });
  });

  it("calibrates output budget upward when the model stops for length", async () => {
    await withRoot(async (root) => {
      let chapterCalls = 0;
      const budgetFetch: FetchLike = async (_url, init) => {
        const text = requestText(init);
        if (text.includes("feng 的通用 agent 设计内核")) {
          return llmResponse(JSON.stringify({
            systemPrompt: "你是写作 agent。",
            stylePrinciples: [],
            constraints: [],
            minChars: 600,
            maxChars: 900,
            coveragePolicy: {
              noMissingTopic: {
                enabled: true,
                gateId: "gate-grown-loop-goal-coverage",
                title: "本章目标必须落到正文事件",
                evidenceRequired: "review evidence proves the chapter goal is answered by concrete plot events",
                promptOnlyAllowed: true,
                blockingUntilReviewed: true
              }
            }
          }), "design");
        }
        chapterCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: `chapter-${chapterCalls}`,
            model: "m",
            choices: [{ message: { content: `林越登场并留下线索。${"正文".repeat(350)}\n===OUTLINE===\n章` }, finish_reason: chapterCalls === 1 ? "length" : "stop" }],
            usage: {}
          }),
          text: async () => ""
        };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: withJudges(budgetFetch) });
      const result = await growXiaoshuoAgentLoop(host, { goal: "g", maxRounds: 2, sampleChapters: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.rounds).toHaveLength(2);
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      const lengthRule = pkg.qualityRules.find((r: { kind: string }) => r.kind === "length");
      expect(lengthRule.maxChars).toBeGreaterThan(900);
    });
  });

  it("seeds writing constraints from a downstream capability-feedback digest", async () => {
    await withRoot(async (root) => {
      // route-feedback wrote this digest into the agent workspace from a work project
      await mkdir(path.join(root, ".feng", "grow-inbox"), { recursive: true });
      await writeFile(
        path.join(root, ".feng", "grow-inbox", "capability-feedback.json"),
        JSON.stringify({
          issueKinds: ["semantic_character"],
          count: 1,
          updatedAt: "t",
          details: [{
            issueKind: "semantic_character",
            chapter: 4,
            detail: "人物动机失真",
            source: "quality_gate",
            gateId: "gate-semantic-character",
            qualityGateStatus: "waiting_evidence",
            artifactPath: ".feng/runtime/chapters/chapter-04/quality-gates.json"
          }]
        }),
        "utf8"
      );
      let n = 0;
      const cleanFetch: FetchLike = async () => {
        n += 1;
        const content = n === 1
          ? STRATEGY
          : `林越登场。${"正文".repeat(500)}\n===OUTLINE===\n章`;
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: withJudges(cleanFetch) });
      const result = await growXiaoshuoAgentLoop(host, { goal: "g", maxRounds: 2, sampleChapters: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.seededConstraints.length).toBeGreaterThan(0);
      expect(result.value.seededFeedbackPath).toBe(".feng/grow-samples/seeded-feedback.json");
      expect(result.value.capabilityAdoptionPath).toBe(CAPABILITY_ADOPTION_PATH);
      const designMessageList = JSON.parse(await readFile(path.join(root, result.value.designMessageListPath), "utf8"));
      const designText = JSON.stringify(designMessageList);
      expect(designText).toContain("下游回流与历史采纳状态");
      expect(designText).toContain("人物动机失真");
      expect(designText).toContain("gate-semantic-character");
      expect(designMessageList.feedbackContextChars).toBeGreaterThan(0);
      const seeded = JSON.parse(await readFile(path.join(root, ".feng", "grow-samples", "seeded-feedback.json"), "utf8"));
      expect(seeded.kind).toBe("feedback_seed_set");
      expect(seeded.seeds[0].layer).toBe("capability");
      expect(seeded.seeds[0].issueKinds).toEqual(["semantic_character"]);
      expect(seeded.seeds[0].details[0].source).toBe("quality_gate");
      expect(seeded.seeds[0].details[0].gateId).toBe("gate-semantic-character");
      expect(seeded.seeds[0].details[0].artifactPath).toContain("quality-gates.json");
      expect(seeded.seededConstraints.length).toBeGreaterThan(0);
      const growRef = makeRef("grow_unit", makeGrowUnitId(result.value.growUnitId));
      const evidence = await host.evidence.listEvidence(growRef, { sourceKind: "validation_report" });
      expect(evidence.ok).toBe(true);
      if (!evidence.ok) throw new Error(evidence.error.message);
      const reportArtifactRef = evidence.value.records[0]?.artifactRef;
      expect(reportArtifactRef).toBeDefined();
      if (reportArtifactRef === undefined) throw new Error("missing validation report artifact");
      const materialized = await host.artifacts.materializeArtifact(reportArtifactRef, { reason: "read validation report", maxBytes: 64 * 1024 });
      expect(materialized.ok).toBe(true);
      if (!materialized.ok) throw new Error(materialized.error.message);
      const validationReport = typeof materialized.value.content === "string" ? JSON.parse(materialized.value.content) : {};
      expect(validationReport.seededFeedback.reportPath).toBe(".feng/grow-samples/seeded-feedback.json");
      expect(validationReport.seededFeedback.seeds[0].details[0].gateId).toBe("gate-semantic-character");
      const gates = JSON.parse(await readFile(path.join(root, XIAOSHUO_QUALITY_GATE_PATH), "utf8"));
      expect(gates.gates.some((gate: { gateId: string; status: string; notes: string[] }) =>
        gate.gateId === "gate-seeded-capability-semantic-character" &&
        gate.status === "passed" &&
        gate.notes.some((note) => note.startsWith("mappedConstraint:"))
      )).toBe(true);
      const feedbackCoverage = gates.coverage.find((item: { requirement: string }) =>
        item.requirement.startsWith("capability_feedback:semantic_character")
      );
      expect(feedbackCoverage?.status).toBe("covered");
      expect(feedbackCoverage?.mappedGateIds).toContain("gate-seeded-capability-semantic-character");
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      // the re-grow folded the downstream capability feedback into its strategy
      expect(pkg.writingStrategy.constraints.some((c: string) => c.includes("人物"))).toBe(true);
      const adoption = JSON.parse(await readFile(path.join(root, CAPABILITY_ADOPTION_PATH), "utf8"));
      expect(adoption.kind).toBe("capability_feedback_adoption");
      expect(adoption.decisions[0].status).toBe("adopted");
      expect(adoption.decisions[0].issueKind).toBe("semantic_character");
      expect(adoption.decisions[0].growUnitId).toBe(result.value.growUnitId);
      expect(adoption.decisions[0].packagePath).toBe(result.value.packagePath);
      expect(adoption.decisions[0].mappedConstraint).toContain("人物");
    });
  });

  it("seeds no-missing-topic constraints from downstream goal coverage feedback", async () => {
    await withRoot(async (root) => {
      await mkdir(path.join(root, ".feng", "grow-inbox"), { recursive: true });
      await writeFile(
        path.join(root, ".feng", "grow-inbox", "capability-feedback.json"),
        JSON.stringify({
          issueKinds: ["goal_coverage"],
          count: 1,
          updatedAt: "t",
          details: [{
            issueKind: "goal_coverage",
            chapter: 1,
            detail: "本章目标不漏题: 写出李白第一次适应手机支付 (failed)",
            source: "quality_gate",
            gateId: "gate-chapter-goal-coverage",
            qualityGateStatus: "failed",
            artifactPath: ".feng/runtime/chapters/chapter-01/quality-gates.json"
          }]
        }),
        "utf8"
      );
      let n = 0;
      const cleanFetch: FetchLike = async () => {
        n += 1;
        const content = n === 1
          ? STRATEGY
          : `林越登场。${"正文".repeat(500)}\n===OUTLINE===\n章`;
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: withJudges(cleanFetch) });
      const result = await growXiaoshuoAgentLoop(host, { goal: "g", maxRounds: 2, sampleChapters: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.seededConstraints.some((constraint) => constraint.includes("本章目标"))).toBe(true);
      const gates = JSON.parse(await readFile(path.join(root, XIAOSHUO_QUALITY_GATE_PATH), "utf8"));
      expect(gates.gates.some((gate: { gateId: string; status: string; notes: string[] }) =>
        gate.gateId === "gate-seeded-capability-goal-coverage" &&
        gate.status === "passed" &&
        gate.notes.some((note) => note.includes("本章目标"))
      )).toBe(true);
      const coverage = gates.coverage.find((item: { requirement: string }) =>
        item.requirement.startsWith("capability_feedback:goal_coverage")
      );
      expect(coverage?.status).toBe("covered");
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.locked).toBe(true);
      expect(pkg.writingStrategy.constraints.some((constraint: string) => constraint.includes("本章目标"))).toBe(true);
      const adoption = JSON.parse(await readFile(path.join(root, CAPABILITY_ADOPTION_PATH), "utf8"));
      expect(adoption.decisions[0].issueKind).toBe("goal_coverage");
      expect(adoption.decisions[0].status).toBe("adopted");
    });
  });

  it("keeps same-kind capability feedback from different chapters as separate adoption decisions", async () => {
    await withRoot(async (root) => {
      await mkdir(path.join(root, ".feng", "grow-inbox"), { recursive: true });
      const firstDetail = {
        issueKind: "semantic_plot",
        chapter: 1,
        detail: "情节推进不足",
        source: "quality_gate",
        gateId: "gate-semantic-plot"
      };
      const secondDetail = {
        issueKind: "semantic_plot",
        chapter: 2,
        detail: "情节推进不足",
        source: "quality_gate",
        gateId: "gate-semantic-plot"
      };
      const firstKey = feedbackDigestDetailKey(firstDetail);
      const secondKey = feedbackDigestDetailKey(secondDetail);
      await writeFile(
        path.join(root, ".feng", "grow-inbox", "capability-feedback.json"),
        JSON.stringify({
          issueKinds: ["semantic_plot"],
          count: 2,
          updatedAt: "t",
          details: [
            { ...firstDetail, feedbackKey: firstKey },
            { ...secondDetail, feedbackKey: secondKey }
          ]
        }),
        "utf8"
      );
      let n = 0;
      const cleanFetch: FetchLike = async () => {
        n += 1;
        const content = n === 1
          ? STRATEGY
          : `林越登场。${"正文".repeat(500)}\n===OUTLINE===\n章`;
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: withJudges(cleanFetch) });
      const result = await growXiaoshuoAgentLoop(host, { goal: "g", maxRounds: 2, sampleChapters: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const adoption = JSON.parse(await readFile(path.join(root, CAPABILITY_ADOPTION_PATH), "utf8"));
      const current = adoption.decisions.filter((decision: { growUnitId: string; issueKind: string }) =>
        decision.growUnitId === result.value.growUnitId && decision.issueKind === "semantic_plot"
      );
      expect(current).toHaveLength(2);
      expect(current.map((decision: { feedbackKey: string }) => decision.feedbackKey)).toEqual(expect.arrayContaining([firstKey, secondKey]));
      expect(new Set(current.map((decision: { feedbackKey: string }) => decision.feedbackKey)).size).toBe(2);
      expect(current.map((decision: { chapter?: number }) => decision.chapter)).toEqual(expect.arrayContaining([1, 2]));
      const gates = JSON.parse(await readFile(path.join(root, XIAOSHUO_QUALITY_GATE_PATH), "utf8"));
      const coverage = gates.coverage.filter((item: { requirement: string }) => item.requirement.startsWith("capability_feedback:semantic_plot|"));
      expect(coverage).toHaveLength(2);
      expect(coverage.map((item: { requirement: string }) => item.requirement)).toEqual(expect.arrayContaining([
        `capability_feedback:${firstKey}`,
        `capability_feedback:${secondKey}`
      ]));
    });
  });

  it("preserves previously adopted capability feedback as long-term grow memory", async () => {
    await withRoot(async (root) => {
      await mkdir(path.join(root, ".feng", "grow-inbox"), { recursive: true });
      await writeFile(
        path.join(root, CAPABILITY_ADOPTION_PATH),
        JSON.stringify({
          schemaVersion: "1.0.0",
          kind: "capability_feedback_adoption",
          sourcePath: ".feng/grow-inbox/capability-feedback.json",
          decisions: [{
            feedbackKey: "semantic_plot|情节推进不足|gate-semantic-plot|.feng/runtime/chapters/chapter-03/quality-gates.json",
            issueKind: "semantic_plot",
            status: "adopted",
            growUnitId: "grow-old",
            packagePath: ".feng/hatch/xiaoshuo-runtime.json",
            detail: "情节推进不足",
            source: "quality_gate",
            gateId: "gate-semantic-plot",
            artifactPath: ".feng/runtime/chapters/chapter-03/quality-gates.json",
            mappedConstraint: "old constraint",
            reason: "previous grow adopted this feedback",
            decidedAt: "t"
          }],
          updatedAt: "t"
        }),
        "utf8"
      );
      let n = 0;
      const cleanFetch: FetchLike = async () => {
        n += 1;
        const content = n === 1
          ? STRATEGY
          : `林越登场。${"正文".repeat(500)}\n===OUTLINE===\n章`;
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: withJudges(cleanFetch) });
      const result = await growXiaoshuoAgentLoop(host, { goal: "g", maxRounds: 2, sampleChapters: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.seededFeedbackPath).toBe(".feng/grow-samples/seeded-feedback.json");
      expect(result.value.seededConstraints.some((constraint) => constraint.includes("情节"))).toBe(true);
      const seeded = JSON.parse(await readFile(path.join(root, ".feng", "grow-samples", "seeded-feedback.json"), "utf8"));
      expect(seeded.seeds).toEqual([]);
      expect(seeded.adoptionMemory.adoptedIssueKinds).toEqual(["semantic_plot"]);
      const growRef = makeRef("grow_unit", makeGrowUnitId(result.value.growUnitId));
      const evidence = await host.evidence.listEvidence(growRef, { sourceKind: "validation_report" });
      expect(evidence.ok).toBe(true);
      if (!evidence.ok) throw new Error(evidence.error.message);
      const reportArtifactRef = evidence.value.records[0]?.artifactRef;
      expect(reportArtifactRef).toBeDefined();
      if (reportArtifactRef === undefined) throw new Error("missing validation report artifact");
      const materialized = await host.artifacts.materializeArtifact(reportArtifactRef, { reason: "read validation report", maxBytes: 64 * 1024 });
      expect(materialized.ok).toBe(true);
      if (!materialized.ok) throw new Error(materialized.error.message);
      const validationReport = typeof materialized.value.content === "string" ? JSON.parse(materialized.value.content) : {};
      expect(validationReport.seededFeedback.adoptionMemory.adoptedIssueKinds).toEqual(["semantic_plot"]);
      const gates = JSON.parse(await readFile(path.join(root, XIAOSHUO_QUALITY_GATE_PATH), "utf8"));
      expect(gates.gates.some((gate: { gateId: string; status: string }) =>
        gate.gateId === "gate-seeded-capability-semantic-plot" && gate.status === "passed"
      )).toBe(true);
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.locked).toBe(true);
      expect(pkg.writingStrategy.constraints.some((constraint: string) => constraint.includes("情节"))).toBe(true);
      const adoption = JSON.parse(await readFile(path.join(root, CAPABILITY_ADOPTION_PATH), "utf8"));
      const current = adoption.decisions.find((decision: { growUnitId: string }) => decision.growUnitId === result.value.growUnitId);
      expect(current.status).toBe("adopted");
      expect(current.mappedConstraint).toContain("情节");
    });
  });

  it("keeps previously unresolved capability feedback as a hatch blocker without a fresh digest", async () => {
    await withRoot(async (root) => {
      await mkdir(path.join(root, ".feng", "grow-inbox"), { recursive: true });
      await writeFile(
        path.join(root, CAPABILITY_ADOPTION_PATH),
        JSON.stringify({
          schemaVersion: "1.0.0",
          kind: "capability_feedback_adoption",
          sourcePath: ".feng/grow-inbox/capability-feedback.json",
          decisions: [{
            feedbackKey: "runtime_capability|kernel cannot expose dialogue|gate-runtime-contract|.feng/runtime/chapters/chapter-01/quality-gates.json",
            issueKind: "runtime_capability",
            status: "unresolved",
            growUnitId: "grow-old",
            packagePath: ".feng/hatch/xiaoshuo-runtime.json",
            detail: "kernel cannot expose dialogue",
            source: "quality_gate",
            gateId: "gate-runtime-contract",
            artifactPath: ".feng/runtime/chapters/chapter-01/quality-gates.json",
            reason: "previous grow could not map this feedback",
            decidedAt: "t"
          }],
          updatedAt: "t"
        }),
        "utf8"
      );
      let n = 0;
      const cleanFetch: FetchLike = async () => {
        n += 1;
        const content = n === 1
          ? STRATEGY
          : `林越登场。${"正文".repeat(500)}\n===OUTLINE===\n章`;
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: withJudges(cleanFetch) });
      const result = await growXiaoshuoAgentLoop(host, { goal: "g", maxRounds: 2, sampleChapters: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const seeded = JSON.parse(await readFile(path.join(root, ".feng", "grow-samples", "seeded-feedback.json"), "utf8"));
      expect(seeded.seeds).toEqual([]);
      expect(seeded.adoptionMemory.unresolvedIssueKinds).toEqual(["runtime_capability"]);
      const gates = JSON.parse(await readFile(path.join(root, XIAOSHUO_QUALITY_GATE_PATH), "utf8"));
      expect(gates.gates.some((gate: { gateId: string; status: string }) =>
        gate.gateId === "gate-seeded-capability-runtime-capability" && gate.status === "failed"
      )).toBe(true);
      const coverage = gates.coverage.find((item: { requirement: string }) =>
        item.requirement.startsWith("capability_feedback:runtime_capability")
      );
      expect(coverage?.status).toBe("uncovered");
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.locked).toBe(false);
      expect(pkg.validation.readiness).toBe("draft");
      const adoption = JSON.parse(await readFile(path.join(root, CAPABILITY_ADOPTION_PATH), "utf8"));
      const current = adoption.decisions.find((decision: { growUnitId: string }) => decision.growUnitId === result.value.growUnitId);
      expect(current.status).toBe("unresolved");
      expect(current.issueKind).toBe("runtime_capability");
    });
  });

  it("marks stale unresolved capability adoption as cleared when the active digest has cleared it", async () => {
    await withRoot(async (root) => {
      await mkdir(path.join(root, ".feng", "grow-inbox"), { recursive: true });
      await writeFile(
        path.join(root, CAPABILITY_ADOPTION_PATH),
        JSON.stringify({
          schemaVersion: "1.0.0",
          kind: "capability_feedback_adoption",
          sourcePath: ".feng/grow-inbox/capability-feedback.json",
          decisions: [{
            feedbackKey: "runtime_capability|kernel cannot expose dialogue|gate-runtime-contract|.feng/runtime/chapters/chapter-01/quality-gates.json",
            issueKind: "runtime_capability",
            status: "unresolved",
            growUnitId: "grow-old",
            packagePath: ".feng/hatch/xiaoshuo-runtime.json",
            detail: "kernel cannot expose dialogue",
            source: "quality_gate",
            gateId: "gate-runtime-contract",
            artifactPath: ".feng/runtime/chapters/chapter-01/quality-gates.json",
            reason: "previous grow could not map this feedback",
            decidedAt: "t"
          }],
          updatedAt: "t"
        }),
        "utf8"
      );
      await writeFile(
        path.join(root, ".feng", "grow-inbox", "capability-feedback.json"),
        JSON.stringify({
          schemaVersion: "1.0.0",
          kind: "capability_feedback_digest",
          layer: "capability",
          issueKinds: [],
          count: 0,
          updatedAt: "t2",
          details: []
        }),
        "utf8"
      );
      let n = 0;
      const cleanFetch: FetchLike = async () => {
        n += 1;
        const content = n === 1
          ? STRATEGY
          : `林越登场。${"正文".repeat(500)}\n===OUTLINE===\n章`;
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: withJudges(cleanFetch) });
      const result = await growXiaoshuoAgentLoop(host, { goal: "g", maxRounds: 2, sampleChapters: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.readiness).toBe("ready");
      const seeded = JSON.parse(await readFile(path.join(root, ".feng", "grow-samples", "seeded-feedback.json"), "utf8"));
      expect(seeded.seeds[0].count).toBe(0);
      expect(seeded.adoptionMemory.unresolvedIssueKinds).toEqual([]);
      expect(seeded.adoptionMemory.unresolvedCount).toBe(0);
      expect(seeded.adoptionMemory.decisions).toEqual([]);
      const gates = JSON.parse(await readFile(path.join(root, XIAOSHUO_QUALITY_GATE_PATH), "utf8"));
      expect(gates.gates.some((gate: { gateId: string }) => gate.gateId === "gate-seeded-capability-runtime-capability")).toBe(false);
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.locked).toBe(true);
      expect(pkg.validation.readiness).toBe("ready");
      const adoption = JSON.parse(await readFile(path.join(root, CAPABILITY_ADOPTION_PATH), "utf8"));
      expect(adoption.decisions).toHaveLength(1);
      expect(adoption.decisions[0].status).toBe("cleared");
      expect(adoption.decisions[0].issueKind).toBe("runtime_capability");
      expect(adoption.decisions[0].reason).toContain("no longer appears in the active capability digest");
      expect(adoption.decisions[0].clearedAt).toBeDefined();
    });
  });

  it("does not revive cleared capability adoption memory without a fresh digest", async () => {
    await withRoot(async (root) => {
      await mkdir(path.join(root, ".feng", "grow-inbox"), { recursive: true });
      await writeFile(
        path.join(root, CAPABILITY_ADOPTION_PATH),
        JSON.stringify({
          schemaVersion: "1.0.0",
          kind: "capability_feedback_adoption",
          sourcePath: ".feng/grow-inbox/capability-feedback.json",
          decisions: [{
            feedbackKey: "runtime_capability|kernel cannot expose dialogue|gate-runtime-contract|.feng/runtime/chapters/chapter-01/quality-gates.json",
            issueKind: "runtime_capability",
            status: "cleared",
            growUnitId: "grow-old",
            packagePath: ".feng/hatch/xiaoshuo-runtime.json",
            detail: "kernel cannot expose dialogue",
            source: "quality_gate",
            gateId: "gate-runtime-contract",
            artifactPath: ".feng/runtime/chapters/chapter-01/quality-gates.json",
            reason: "feedback no longer appears in the active capability digest and no longer blocks hatch",
            decidedAt: "t",
            clearedAt: "t2"
          }],
          updatedAt: "t2"
        }),
        "utf8"
      );
      let n = 0;
      const cleanFetch: FetchLike = async () => {
        n += 1;
        const content = n === 1
          ? STRATEGY
          : `林越登场。${"正文".repeat(500)}\n===OUTLINE===\n章`;
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: withJudges(cleanFetch) });
      const result = await growXiaoshuoAgentLoop(host, { goal: "g", maxRounds: 2, sampleChapters: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.readiness).toBe("ready");
      expect(result.value.seededFeedbackPath).toBeUndefined();
      const gates = JSON.parse(await readFile(path.join(root, XIAOSHUO_QUALITY_GATE_PATH), "utf8"));
      expect(gates.gates.some((gate: { gateId: string }) => gate.gateId === "gate-seeded-capability-runtime-capability")).toBe(false);
      const adoption = JSON.parse(await readFile(path.join(root, CAPABILITY_ADOPTION_PATH), "utf8"));
      expect(adoption.decisions).toHaveLength(1);
      expect(adoption.decisions[0].status).toBe("cleared");
      expect(adoption.decisions[0].clearedAt).toBe("t2");
    });
  });

  it("keeps the package draft when a capability-feedback seed is not mapped into the grown package", async () => {
    await withRoot(async (root) => {
      await mkdir(path.join(root, ".feng", "grow-inbox"), { recursive: true });
      await writeFile(
        path.join(root, ".feng", "grow-inbox", "capability-feedback.json"),
        JSON.stringify({
          issueKinds: ["runtime_capability"],
          count: 1,
          updatedAt: "t",
          details: [{
            issueKind: "runtime_capability",
            detail: "capability digest contains a feedback kind the revision map cannot absorb",
            source: "quality_gate",
            gateId: "gate-runtime-contract",
            artifactPath: ".feng/runtime/chapters/chapter-01/quality-gates.json"
          }]
        }),
        "utf8"
      );
      let n = 0;
      const cleanFetch: FetchLike = async () => {
        n += 1;
        const content = n === 1
          ? STRATEGY
          : `林越登场。${"正文".repeat(500)}\n===OUTLINE===\n章`;
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: withJudges(cleanFetch) });
      const result = await growXiaoshuoAgentLoop(host, { goal: "g", maxRounds: 2, sampleChapters: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.seededConstraints).toHaveLength(0);
      const gates = JSON.parse(await readFile(path.join(root, XIAOSHUO_QUALITY_GATE_PATH), "utf8"));
      expect(gates.gates.some((gate: { gateId: string; status: string }) =>
        gate.gateId === "gate-seeded-capability-runtime-capability" && gate.status === "failed"
      )).toBe(true);
      const feedbackCoverage = gates.coverage.find((item: { requirement: string }) =>
        item.requirement.startsWith("capability_feedback:runtime_capability")
      );
      expect(feedbackCoverage?.status).toBe("uncovered");
      expect(gates.summary.blockingCount).toBeGreaterThan(0);
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.locked).toBe(false);
      expect(pkg.validation.readiness).toBe("draft");
      expect(result.value.readiness).toBe("draft");
      expect(result.value.lifecycle).not.toBe("ready_to_hatch");
      expect(pkg.validation.qualityGateSummary).toContain("coverage_uncovered=");
      const adoption = JSON.parse(await readFile(path.join(root, CAPABILITY_ADOPTION_PATH), "utf8"));
      expect(adoption.decisions[0].status).toBe("unresolved");
      expect(adoption.decisions[0].issueKind).toBe("runtime_capability");
      expect(adoption.decisions[0].mappedConstraint).toBeUndefined();
    });
  });

  it("keeps unresolved system-feedback digest as a hatch blocker instead of revising writing strategy", async () => {
    await withRoot(async (root) => {
      await mkdir(path.join(root, ".feng", "grow-inbox"), { recursive: true });
      await writeFile(
        path.join(root, SYSTEM_DIGEST_PATH),
        JSON.stringify({
          schemaVersion: "1.0.0",
          kind: "system_feedback_digest",
          layer: "system",
          issueKinds: ["runtime_capability"],
          count: 1,
          updatedAt: "t",
          details: [{
            issueKind: "runtime_capability",
            chapter: 1,
            detail: "dialogueAllowed=true but kernel lacks dialogue mode",
            source: "quality_gate",
            gateId: "gate-runtime-contract",
            qualityGateStatus: "failed",
            artifactPath: ".feng/runtime/chapters/chapter-01/quality-gates.json"
          }]
        }),
        "utf8"
      );
      let n = 0;
      const cleanFetch: FetchLike = async () => {
        n += 1;
        const content = n === 1
          ? STRATEGY
          : `林越登场。${"正文".repeat(500)}\n===OUTLINE===\n章`;
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: withJudges(cleanFetch) });
      const result = await growXiaoshuoAgentLoop(host, { goal: "g", maxRounds: 2, sampleChapters: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.finalCapabilityIssues).toBe(0);
      expect(result.value.seededConstraints).toHaveLength(0);
      expect(result.value.seededFeedbackPath).toBe(".feng/grow-samples/seeded-feedback.json");
      const seeded = JSON.parse(await readFile(path.join(root, ".feng", "grow-samples", "seeded-feedback.json"), "utf8"));
      expect(seeded.seeds[0].layer).toBe("system");
      expect(seeded.unresolvedSystemIssueKinds).toEqual(["runtime_capability"]);
      const gates = JSON.parse(await readFile(path.join(root, XIAOSHUO_QUALITY_GATE_PATH), "utf8"));
      expect(gates.gates.some((gate: { gateId: string; status: string }) => gate.gateId === "gate-system-runtime-capability" && gate.status === "failed")).toBe(true);
      expect(gates.summary.blockingCount).toBeGreaterThan(0);
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.locked).toBe(false);
      expect(pkg.validation.readiness).toBe("draft");
      expect(pkg.validation.evidenceSummary).toContain("systemSeed=1");
    });
  });

  it("does not block hatch when feng has explicitly resolved the system feedback", async () => {
    await withRoot(async (root) => {
      await mkdir(path.join(root, ".feng", "grow-inbox"), { recursive: true });
      await mkdir(path.join(root, ".feng", "system"), { recursive: true });
      await writeFile(
        path.join(root, SYSTEM_DIGEST_PATH),
        JSON.stringify({
          schemaVersion: "1.0.0",
          kind: "system_feedback_digest",
          layer: "system",
          issueKinds: ["runtime_capability"],
          count: 1,
          updatedAt: "t",
          details: [{ issueKind: "runtime_capability", detail: "kernel gap", source: "quality_gate", gateId: "gate-runtime-contract" }]
        }),
        "utf8"
      );
      await writeFile(path.join(root, ".feng", "system", "runtime-capability-evidence.json"), JSON.stringify({ implemented: true }), "utf8");
      const host = await createFengHost({
        config: { workspaceRoot: root, provider },
        fetchImpl: (() => {
          let n = 0;
          const fetch: FetchLike = async () => {
            n += 1;
            const content = n === 1
              ? STRATEGY
              : `林越登场。${"正文".repeat(500)}\n===OUTLINE===\n章`;
            return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
          };
          return withJudges(fetch);
        })()
      });
      const resolved = await resolveSystemFeedback(host, {
        issueKind: "runtime_capability",
        decision: "resolved",
        reason: "runtime kernel support added in this feng workspace",
        evidenceRefs: [".feng/system/runtime-capability-evidence.json"]
      });
      expect(resolved.ok).toBe(true);
      const result = await growXiaoshuoAgentLoop(host, { goal: "g", maxRounds: 2, sampleChapters: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const seeded = JSON.parse(await readFile(path.join(root, ".feng", "grow-samples", "seeded-feedback.json"), "utf8"));
      expect(seeded.systemResolution.decisions[0].issueKind).toBe("runtime_capability");
      expect(seeded.unresolvedSystemIssueKinds).toEqual([]);
      const gates = JSON.parse(await readFile(path.join(root, XIAOSHUO_QUALITY_GATE_PATH), "utf8"));
      expect(gates.gates.some((gate: { gateId: string }) => gate.gateId === "gate-system-runtime-capability")).toBe(false);
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.locked).toBe(true);
      expect(pkg.validation.readiness).toBe("ready");
    });
  });

  it("keeps same-kind system feedback blocking unless its exact feedback key is resolved", async () => {
    await withRoot(async (root) => {
      await mkdir(path.join(root, ".feng", "grow-inbox"), { recursive: true });
      await mkdir(path.join(root, ".feng", "system"), { recursive: true });
      const resolvedDetail = {
        issueKind: "runtime_capability",
        chapter: 1,
        detail: "dialogueAllowed=true but kernel lacks dialogue mode",
        source: "quality_gate",
        gateId: "gate-runtime-dialogue",
        qualityGateStatus: "failed",
        artifactPath: ".feng/runtime/chapters/chapter-01/quality-gates.json"
      };
      const unresolvedDetail = {
        issueKind: "runtime_capability",
        chapter: 2,
        detail: "tool execution requested but runtime package lacks tool bridge",
        source: "quality_gate",
        gateId: "gate-runtime-tool-bridge",
        qualityGateStatus: "failed",
        artifactPath: ".feng/runtime/chapters/chapter-02/quality-gates.json"
      };
      const resolvedKey = feedbackDigestDetailKey(resolvedDetail);
      await writeFile(
        path.join(root, SYSTEM_DIGEST_PATH),
        JSON.stringify({
          schemaVersion: "1.0.0",
          kind: "system_feedback_digest",
          layer: "system",
          issueKinds: ["runtime_capability"],
          count: 2,
          updatedAt: "t",
          details: [resolvedDetail, unresolvedDetail]
        }),
        "utf8"
      );
      await writeFile(path.join(root, ".feng", "system", "dialogue-evidence.json"), JSON.stringify({ implemented: true }), "utf8");
      const host = await createFengHost({
        config: { workspaceRoot: root, provider },
        fetchImpl: (() => {
          let n = 0;
          const fetch: FetchLike = async () => {
            n += 1;
            const content = n === 1
              ? STRATEGY
              : `林越登场。${"正文".repeat(500)}\n===OUTLINE===\n章`;
            return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
          };
          return withJudges(fetch);
        })()
      });
      const resolved = await resolveSystemFeedback(host, {
        issueKind: "runtime_capability",
        decision: "resolved",
        reason: "dialogue mode was added, but tool bridge has not been addressed",
        evidenceRefs: [".feng/system/dialogue-evidence.json"],
        feedbackKeys: [resolvedKey]
      });
      expect(resolved.ok).toBe(true);
      const resolution = JSON.parse(await readFile(path.join(root, ".feng", "grow-inbox", "system-feedback-resolution.json"), "utf8"));
      expect(resolution.decisions[0].feedbackKeys).toEqual([resolvedKey]);

      const result = await growXiaoshuoAgentLoop(host, { goal: "g", maxRounds: 2, sampleChapters: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const seeded = JSON.parse(await readFile(path.join(root, ".feng", "grow-samples", "seeded-feedback.json"), "utf8"));
      expect(seeded.unresolvedSystemIssueKinds).toEqual(["runtime_capability"]);
      expect(seeded.unresolvedSystemFeedbackDetails).toHaveLength(1);
      expect(seeded.unresolvedSystemFeedbackDetails[0].detail).toBe(unresolvedDetail.detail);
      expect(seeded.unresolvedSystemFeedbackRefs).toEqual([unresolvedDetail.artifactPath]);
      const gates = JSON.parse(await readFile(path.join(root, XIAOSHUO_QUALITY_GATE_PATH), "utf8"));
      const systemGate = gates.gates.find((gate: { gateId: string }) => gate.gateId === "gate-system-runtime-capability");
      expect(systemGate.status).toBe("failed");
      expect(systemGate.notes.join("\n")).toContain("chapter-02");
      expect(systemGate.notes.join("\n")).not.toContain("chapter-01");
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.locked).toBe(false);
      expect(pkg.validation.readiness).toBe("draft");
      expect(pkg.validation.evidenceSummary).toContain("systemSeed=1");
    });
  });

  it("keeps a legacy evidence-less resolved system-feedback decision blocking hatch", async () => {
    await withRoot(async (root) => {
      await mkdir(path.join(root, ".feng", "grow-inbox"), { recursive: true });
      await writeFile(
        path.join(root, SYSTEM_DIGEST_PATH),
        JSON.stringify({
          schemaVersion: "1.0.0",
          kind: "system_feedback_digest",
          layer: "system",
          issueKinds: ["runtime_capability"],
          count: 1,
          updatedAt: "t",
          details: [{ issueKind: "runtime_capability", detail: "kernel gap", source: "quality_gate", gateId: "gate-runtime-contract" }]
        }),
        "utf8"
      );
      await writeFile(
        path.join(root, ".feng", "grow-inbox", "system-feedback-resolution.json"),
        JSON.stringify({
          schemaVersion: "1.0.0",
          kind: "system_feedback_resolution",
          sourcePath: SYSTEM_DIGEST_PATH,
          decisions: [{ issueKind: "runtime_capability", decision: "resolved", reason: "legacy handwave", resolvedAt: "t" }],
          updatedAt: "t"
        }),
        "utf8"
      );
      let n = 0;
      const cleanFetch: FetchLike = async () => {
        n += 1;
        const content = n === 1
          ? STRATEGY
          : `林越登场。${"正文".repeat(500)}\n===OUTLINE===\n章`;
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: withJudges(cleanFetch) });
      const result = await growXiaoshuoAgentLoop(host, { goal: "g", maxRounds: 2, sampleChapters: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const seeded = JSON.parse(await readFile(path.join(root, ".feng", "grow-samples", "seeded-feedback.json"), "utf8"));
      expect(seeded.systemResolution.decisions[0].evidenceRefs).toBeUndefined();
      expect(seeded.unresolvedSystemIssueKinds).toEqual(["runtime_capability"]);
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.locked).toBe(false);
      expect(pkg.validation.readiness).toBe("draft");
    });
  });
});

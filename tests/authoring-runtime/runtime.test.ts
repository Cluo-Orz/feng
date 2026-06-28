import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFengHost } from "../../src/host/index.js";
import { recordAuthorFeedback, runChapters, WORK_CHAPTER_AUTHOR_FEEDBACK_FILE, WORK_CHAPTER_QUALITY_GATE_FILE, type AuthoringRuntimeDeps } from "../../src/authoring-runtime/index.js";
import {
  savePackage,
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
import type { FetchLike } from "../../src/providers/index.js";

const provider = { provider: "deepseek", apiKey: "k", baseUrl: "https://api.deepseek.com", model: "m", maxTokens: 256, reasoningModel: true };

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
    writingStrategy: { systemPrompt: "你是连贯写作 agent。", stylePrinciples: ["生动"], constraints: ["保持连贯"] },
    storyModel: defaultStoryModel,
    harness: defaultHarness,
    coveragePolicy: defaultCoveragePolicy,
    qualityRules: defaultQualityRules,
    feedbackRouting: defaultFeedbackRouting,
    validation: { readiness: "ready", grownInProject: "/x", evidenceSummary: "ok", checkedAt: "t" },
    provenance: { model: "m", provider: "deepseek", hatchedAt: "t" }
  };
}

function chapterFetch(text: (n: number) => string): FetchLike {
  let n = 0;
  return async () => {
    n += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: String(n), model: "m", choices: [{ message: { content: text(n) }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }),
      text: async () => ""
    };
  };
}

async function withProject(body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "feng-auth-"));
  try {
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function seedProject(root: string, config: Record<string, unknown>): Promise<void> {
  const dir = path.join(root, ".feng", "runtime");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "project.json"), JSON.stringify(config), "utf8");
}

describe("authoring runtime runChapter", () => {
  it("writes every file-native per-chapter artifact and a passing eval", async () => {
    await withProject(async (root) => {
      await seedProject(root, { premise: "李白重生现代成都", title: "李白重生了", establishedYear: 2024, establishedCharacters: ["李白"] });
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: chapterFetch((n) => `李白在第${n}章继续行动。${"正文".repeat(600)}\n===OUTLINE===\n第${n}章：李白推进剧情`) });
      const deps: AuthoringRuntimeDeps = { store: host.store, workspace: host.workspace, llmGateway: host.llmGateway, policy: host.policy, provider: "deepseek", model: "m" };
      const result = await runChapters(deps, pkg(), 1);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const dir = path.join(root, ".feng", "runtime", "chapters", "chapter-01");
      for (const file of ["input.json", "message-list.json", "model-output.json", "trace.json", "quality-eval.json", "feedback.json", WORK_CHAPTER_QUALITY_GATE_FILE]) {
        const content = await readFile(path.join(dir, file), "utf8");
        expect(content.length).toBeGreaterThan(0);
      }
      const gates = JSON.parse(await readFile(path.join(dir, WORK_CHAPTER_QUALITY_GATE_FILE), "utf8"));
      expect(gates.kind).toBe("work_project_quality_gate_set");
      expect(gates.summary.uncoveredRequirements).toBe(0);
      expect(gates.gates.find((gate: { gateId: string }) => gate.gateId === "gate-length")?.status).toBe("passed");
      expect(gates.coverage.some((item: { requirement: string }) => item.requirement.startsWith("premise:李白重生现代成都"))).toBe(true);
      const chapter = await readFile(path.join(root, "chapters", "chapter-01.md"), "utf8");
      expect(chapter).toContain("第1章");
      const outline = await readFile(path.join(root, "outlines", "chapter-01.md"), "utf8");
      expect(outline).toContain("李白重生了 · 第1章大纲");
      expect(outline).toContain("李白推进剧情");
      const outlineIndex = await readFile(path.join(root, "outline.md"), "utf8");
      expect(outlineIndex).toContain("第1章：李白推进剧情");
      const feedbackCandidates = JSON.parse(await readFile(path.join(root, "feedback-candidates", "chapter-01.json"), "utf8"));
      expect(feedbackCandidates.kind).toBe("business_feedback_candidates");
      expect(feedbackCandidates.sourceRuntimeRef).toBe(".feng/runtime/chapters/chapter-01/feedback.json");
      const settingConflicts = JSON.parse(await readFile(path.join(root, "setting-conflicts", "chapter-01.json"), "utf8"));
      expect(settingConflicts.kind).toBe("business_setting_conflicts");
      expect(settingConflicts.sourceRuntimeRef).toBe(".feng/runtime/chapters/chapter-01/quality-eval.json");
      const state = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "novel-state.json"), "utf8"));
      expect(state.chapters).toHaveLength(1);
      expect(state.chapters[0].chapterPath).toBe("chapters/chapter-01.md");
      expect(state.chapters[0].outlinePath).toBe("outlines/chapter-01.md");
      expect(state.chapters[0].feedbackCandidatesPath).toBe("feedback-candidates/chapter-01.json");
      expect(state.chapters[0].settingConflictsPath).toBe("setting-conflicts/chapter-01.json");
      expect(result.value[0]?.qualityPassed).toBe(true);
      expect(result.value[0]?.outlinePath).toBe("outlines/chapter-01.md");
      expect(result.value[0]?.feedbackCandidatesPath).toBe("feedback-candidates/chapter-01.json");
      expect(result.value[0]?.qualityGatePath).toBe(".feng/runtime/chapters/chapter-01/quality-gates.json");
    });
  });

  it("keeps generic quality failures out of business setting conflicts", async () => {
    await withProject(async (root) => {
      await seedProject(root, { premise: "李白重生现代成都", title: "李白重生了" });
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: chapterFetch((n) => `李白在第${n}章继续行动。\n===OUTLINE===\n第${n}章：李白推进剧情`) });
      const deps: AuthoringRuntimeDeps = { store: host.store, workspace: host.workspace, llmGateway: host.llmGateway, policy: host.policy, provider: "deepseek", model: "m" };
      const result = await runChapters(deps, pkg(), 1);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const quality = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "chapters", "chapter-01", "quality-eval.json"), "utf8"));
      expect(quality.issues.some((issue: { kind: string }) => issue.kind === "length")).toBe(true);
      const settingConflicts = JSON.parse(await readFile(path.join(root, "setting-conflicts", "chapter-01.json"), "utf8"));
      expect(settingConflicts.conflicts).toEqual([]);
    });
  });

  it("records cache usage in chapter result, trace, and model output", async () => {
    await withProject(async (root) => {
      await seedProject(root, { premise: "李白重生现代成都", title: "李白重生了" });
      const fetch: FetchLike = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          id: "cached",
          model: "m",
          choices: [{ message: { content: `李白在现代继续行动。${"正文".repeat(600)}\n===OUTLINE===\n第1章：李白推进剧情` }, finish_reason: "stop" }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 80 } }
        }),
        text: async () => ""
      });
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: fetch });
      const deps: AuthoringRuntimeDeps = { store: host.store, workspace: host.workspace, llmGateway: host.llmGateway, policy: host.policy, provider: "deepseek", model: "m" };
      const result = await runChapters(deps, pkg(), 1);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value[0]?.llmUsage.cacheHitRatePct).toBe(80);
      const trace = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "chapters", "chapter-01", "trace.json"), "utf8"));
      expect(trace.cacheHitRatePct).toBe(80);
      expect(trace.llmUsage.cacheReadTokens).toBe(80);
      const output = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "chapters", "chapter-01", "model-output.json"), "utf8"));
      expect(output.llmUsage.cacheHitRatePct).toBe(80);
    });
  });

  it("routes truncated model output as system feedback instead of treating it as normal success", async () => {
    await withProject(async (root) => {
      await seedProject(root, { premise: "李白重生现代成都", title: "李白重生了" });
      const fetch: FetchLike = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          id: "truncated",
          model: "m",
          choices: [{ message: { content: `李白在现代继续行动。${"正文".repeat(600)}\n===OUTLINE===\n第1章：李白推进剧情` }, finish_reason: "length" }],
          usage: { prompt_tokens: 100, completion_tokens: 256, total_tokens: 356 }
        }),
        text: async () => ""
      });
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: fetch });
      const deps: AuthoringRuntimeDeps = { store: host.store, workspace: host.workspace, llmGateway: host.llmGateway, policy: host.policy, provider: "deepseek", model: "m" };
      const result = await runChapters(deps, pkg(), 1);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value[0]?.feedback.byLayer.system).toBeGreaterThanOrEqual(1);
      expect(result.value[0]?.feedback.candidates.some((candidate) =>
        candidate.issueKind === "runtime_capability" &&
        candidate.layer === "system" &&
        candidate.detail.includes("finishReason=length")
      )).toBe(true);

      const dir = path.join(root, ".feng", "runtime", "chapters", "chapter-01");
      const feedback = JSON.parse(await readFile(path.join(dir, "feedback.json"), "utf8"));
      expect(feedback.candidates.some((candidate: { issueKind: string; layer: string; detail: string }) =>
        candidate.issueKind === "runtime_capability" &&
        candidate.layer === "system" &&
        candidate.detail.includes("finishReason=length")
      )).toBe(true);
      const gates = JSON.parse(await readFile(path.join(dir, WORK_CHAPTER_QUALITY_GATE_FILE), "utf8"));
      const runtimeGate = gates.gates.find((gate: { gateId: string }) => gate.gateId === "gate-routed-runtime-capability");
      expect(runtimeGate?.status).toBe("needs_human_judgment");
      expect(runtimeGate?.layer).toBe("system");
      const output = JSON.parse(await readFile(path.join(dir, "model-output.json"), "utf8"));
      expect(output.runtimeIssues[0].detail).toContain("finishReason=length");
      const trace = JSON.parse(await readFile(path.join(dir, "trace.json"), "utf8"));
      expect(trace.runtimeIssues[0].detail).toContain("finishReason=length");
    });
  });

  it("tracks a chapter goal as explicit no-missing-topic evidence instead of hiding it in the prompt", async () => {
    await withProject(async (root) => {
      await seedProject(root, { premise: "李白重生现代成都", title: "李白重生了", chapterGoals: ["写出李白第一次适应手机支付"] });
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: chapterFetch((n) => `李白在第${n}章继续行动。${"正文".repeat(600)}\n===OUTLINE===\n第${n}章：李白推进剧情`) });
      const deps: AuthoringRuntimeDeps = { store: host.store, workspace: host.workspace, llmGateway: host.llmGateway, policy: host.policy, provider: "deepseek", model: "m" };
      const runtimePackage: AuthoringRuntimePackage = {
        ...pkg(),
        coveragePolicy: {
          noMissingTopic: {
            ...defaultCoveragePolicy.noMissingTopic,
            gateId: "gate-grown-topic-coverage",
            title: "自定义章节目标覆盖"
          }
        }
      };
      const result = await runChapters(deps, runtimePackage, 1);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const gatePath = path.join(root, ".feng", "runtime", "chapters", "chapter-01", WORK_CHAPTER_QUALITY_GATE_FILE);
      const gates = JSON.parse(await readFile(gatePath, "utf8"));
      const goalGate = gates.gates.find((gate: { gateId: string }) => gate.gateId === "gate-grown-topic-coverage");
      expect(goalGate?.title).toBe("自定义章节目标覆盖");
      expect(goalGate?.status).toBe("waiting_evidence");
      expect(goalGate?.notes.join("\n")).toContain("coveragePolicy.noMissingTopic");
      expect(goalGate?.notes.join("\n")).toContain("promptOnlyAllowed=false");
      expect(gates.coverage.find((item: { requirement: string }) => item.requirement.startsWith("chapter_goal:"))?.status).toBe("waiting_evidence");
      expect(gates.coverage.find((item: { requirement: string }) => item.requirement.startsWith("chapter_goal:"))?.mappedGateIds).toContain("gate-grown-topic-coverage");
      expect(result.value[0]?.qualityPassed).toBe(true);
      expect(result.value[0]?.qualityGateSummary).toContain("blocking=1");
    });
  });

  it("keeps no-missing-topic blocking when goal coverage evidence says the chapter missed the goal", async () => {
    await withProject(async (root) => {
      await seedProject(root, { premise: "李白重生现代成都", title: "李白重生了", chapterGoals: ["写出李白第一次适应手机支付"] });
      const fetch: FetchLike = chapterFetch((n) => n === 1
        ? `李白在第${n}章继续行动。${"正文".repeat(600)}\n===OUTLINE===\n第${n}章：李白推进剧情`
        : n === 2
          ? '{"style": 9, "character": 9, "plot": 9, "problems": [], "notes": "达标"}'
          : '{"covered": false, "confidence": 0.88, "evidence": [], "missing": ["没有出现手机支付事件"], "notes": "漏掉本章目标"}');
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: fetch });
      const deps: AuthoringRuntimeDeps = { store: host.store, workspace: host.workspace, llmGateway: host.llmGateway, policy: host.policy, provider: "deepseek", model: "m", semanticEval: true };
      const result = await runChapters(deps, pkg(), 1);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const gates = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "chapters", "chapter-01", WORK_CHAPTER_QUALITY_GATE_FILE), "utf8"));
      const goalGate = gates.gates.find((gate: { gateId: string }) => gate.gateId === "gate-chapter-goal-coverage");
      expect(goalGate?.status).toBe("failed");
      expect(goalGate?.layer).toBe("capability");
      expect(goalGate?.issueKinds).toEqual(["goal_coverage"]);
      expect(goalGate?.notes.join("\n")).toContain("goal-coverage-eval.json");
      expect(gates.summary.blockingCount).toBeGreaterThan(0);
      expect(gates.coverage.find((item: { requirement: string }) => item.requirement.startsWith("chapter_goal:"))?.status).toBe("uncovered");
      const coverage = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "chapters", "chapter-01", "goal-coverage-eval.json"), "utf8"));
      expect(coverage.covered).toBe(false);
      expect(result.value[0]?.qualityGateSummary).toContain("blocking=");
    });
  });

  it("treats malformed goal coverage judge output as a system evidence problem, not a missed goal", async () => {
    await withProject(async (root) => {
      await seedProject(root, { premise: "李白重生现代成都", title: "李白重生了", chapterGoals: ["写出李白第一次适应手机支付"] });
      const fetch: FetchLike = chapterFetch((n) => n === 1
        ? `李白第一次学习手机支付，在扫码失败后向店员求助。${"正文".repeat(560)}\n===OUTLINE===\n第${n}章：李白完成第一次手机支付`
        : n === 2
          ? '{"style": 9, "character": 9, "plot": 9, "problems": [], "notes": "达标"}'
          : "我觉得挺好");
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: fetch });
      const deps: AuthoringRuntimeDeps = { store: host.store, workspace: host.workspace, llmGateway: host.llmGateway, policy: host.policy, provider: "deepseek", model: "m", semanticEval: true };
      const result = await runChapters(deps, pkg(), 1);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const gates = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "chapters", "chapter-01", WORK_CHAPTER_QUALITY_GATE_FILE), "utf8"));
      const goalGate = gates.gates.find((gate: { gateId: string }) => gate.gateId === "gate-chapter-goal-coverage");
      expect(goalGate?.status).toBe("needs_human_judgment");
      expect(goalGate?.layer).toBe("system");
      expect(goalGate?.issueKinds).toEqual(["goal_coverage_eval_invalid"]);
      expect(gates.coverage.find((item: { requirement: string }) => item.requirement.startsWith("chapter_goal:"))?.status).toBe("waiting_evidence");
      const coverage = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "chapters", "chapter-01", "goal-coverage-eval.json"), "utf8"));
      expect(coverage.parseOk).toBe(false);
      expect(coverage.raw).toBe("我觉得挺好");
    });
  });

  it("clears no-missing-topic only when goal coverage eval provides explicit positive evidence", async () => {
    await withProject(async (root) => {
      await seedProject(root, { premise: "李白重生现代成都", title: "李白重生了", chapterGoals: ["写出李白第一次适应手机支付"] });
      const fetch: FetchLike = chapterFetch((n) => n === 1
        ? `李白第一次学习手机支付，在扫码失败后向店员求助。${"正文".repeat(560)}\n===OUTLINE===\n第${n}章：李白完成第一次手机支付`
        : n === 2
          ? '{"style": 9, "character": 9, "plot": 9, "problems": [], "notes": "达标"}'
          : '{"covered": true, "confidence": 0.93, "evidence": ["李白第一次学习手机支付", "扫码失败后向店员求助"], "missing": [], "notes": "目标已覆盖"}');
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: fetch });
      const deps: AuthoringRuntimeDeps = { store: host.store, workspace: host.workspace, llmGateway: host.llmGateway, policy: host.policy, provider: "deepseek", model: "m", semanticEval: true };
      const result = await runChapters(deps, pkg(), 1);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const gates = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "chapters", "chapter-01", WORK_CHAPTER_QUALITY_GATE_FILE), "utf8"));
      const goalGate = gates.gates.find((gate: { gateId: string }) => gate.gateId === "gate-chapter-goal-coverage");
      expect(goalGate?.status).toBe("passed");
      expect(goalGate?.layer).toBe("work");
      expect(goalGate?.issueKinds).toEqual(["goal_coverage"]);
      expect(gates.coverage.find((item: { requirement: string }) => item.requirement.startsWith("chapter_goal:"))?.status).toBe("covered");
      expect(gates.summary.blockingCount).toBe(0);
      const coverage = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "chapters", "chapter-01", "goal-coverage-eval.json"), "utf8"));
      expect(coverage.covered).toBe(true);
      expect(coverage.evidence.join("\n")).toContain("手机支付");
    });
  });

  it("routes unsupported grown input contracts to system feedback during a chapter run", async () => {
    await withProject(async (root) => {
      await seedProject(root, { premise: "李白重生现代成都", title: "李白重生了" });
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: chapterFetch((n) => `李白在第${n}章继续行动。${"正文".repeat(600)}\n===OUTLINE===\n第${n}章：李白推进剧情`) });
      const deps: AuthoringRuntimeDeps = { store: host.store, workspace: host.workspace, llmGateway: host.llmGateway, policy: host.policy, provider: "deepseek", model: "m" };
      const runtimePackage: AuthoringRuntimePackage = {
        ...pkg(),
        targetWorld: {
          ...defaultNovelTargetWorld,
          inputKinds: ["premise", "chapter_goal", "image_reference"]
        }
      };
      const result = await runChapters(deps, runtimePackage, 1);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value[0]?.feedback.byLayer.system).toBeGreaterThanOrEqual(1);
      expect(result.value[0]?.feedback.candidates.some((candidate) =>
        candidate.issueKind === "runtime_capability" &&
        candidate.layer === "system" &&
        candidate.detail.includes("image_reference")
      )).toBe(true);
      const feedback = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "chapters", "chapter-01", "feedback.json"), "utf8"));
      expect(feedback.candidates.some((candidate: { issueKind: string; layer: string; detail: string }) =>
        candidate.issueKind === "runtime_capability" &&
        candidate.layer === "system" &&
        candidate.detail.includes("image_reference")
      )).toBe(true);
      const gates = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "chapters", "chapter-01", WORK_CHAPTER_QUALITY_GATE_FILE), "utf8"));
      const runtimeGate = gates.gates.find((gate: { gateId: string }) => gate.gateId === "gate-routed-runtime-capability");
      expect(runtimeGate?.layer).toBe("system");
      expect(runtimeGate?.status).toBe("needs_human_judgment");
    });
  });

  it("turns work-layer author feedback into a file-native task, gate, feedback candidate, and next-run context", async () => {
    await withProject(async (root) => {
      await seedProject(root, { premise: "李白重生现代成都", title: "李白重生了" });
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: chapterFetch((n) => `李白在第${n}章继续行动。${"正文".repeat(600)}\n===OUTLINE===\n第${n}章：李白推进剧情`) });
      const deps: AuthoringRuntimeDeps = { store: host.store, workspace: host.workspace, llmGateway: host.llmGateway, policy: host.policy, provider: "deepseek", model: "m" };
      const first = await runChapters(deps, pkg(), 1);
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error(first.error.message);

      const recorded = await recordAuthorFeedback(host, {
        chapterNumber: 1,
        content: "下一章必须补上李白第一次使用手机支付的尴尬冲突",
        issueKind: "semantic_plot",
        layer: "work",
        suggestedAction: "把作者反馈转成下一章写作约束"
      });
      expect(recorded.ok).toBe(true);
      if (!recorded.ok) throw new Error(recorded.error.message);
      expect(recorded.value.authorFeedbackPath).toContain(WORK_CHAPTER_AUTHOR_FEEDBACK_FILE);
      const authorFeedback = JSON.parse(await readFile(path.join(root, recorded.value.authorFeedbackPath), "utf8"));
      expect(authorFeedback.feedback[0].content).toContain("手机支付");
      expect(authorFeedback.feedback[0].layer).toBe("work");
      const routed = JSON.parse(await readFile(path.join(root, recorded.value.feedbackPath), "utf8"));
      expect(routed.candidates[0].source).toBe("author_feedback");
      expect(routed.candidates[0].layer).toBe("work");
      expect(routed.candidates[0].gateId).toBe(authorFeedback.feedback[0].gateId);
      const gates = JSON.parse(await readFile(path.join(root, recorded.value.qualityGatePath), "utf8"));
      const feedbackGate = gates.gates.find((gate: { gateId: string }) => gate.gateId === authorFeedback.feedback[0].gateId);
      expect(feedbackGate.status).toBe("waiting_evidence");
      expect(gates.summary.blockingCount).toBeGreaterThan(0);

      const second = await runChapters(deps, pkg(), 1);
      expect(second.ok).toBe(true);
      if (!second.ok) throw new Error(second.error.message);
      const messageList = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "chapters", "chapter-02", "message-list.json"), "utf8"));
      expect(JSON.stringify(messageList)).toContain("手机支付");
      expect(JSON.stringify(messageList)).toContain("把作者反馈转成下一章写作约束");
      const input = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "chapters", "chapter-02", "input.json"), "utf8"));
      expect(input.authorFeedbackInstructionCount).toBe(1);
      expect(input.authorFeedbackRefs[0]).toContain("author-feedback.json#author-feedback-ch01-01");
      const trace = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "chapters", "chapter-02", "trace.json"), "utf8"));
      expect(trace.authorFeedbackInstructionCount).toBe(1);
      expect(trace.authorFeedbackRefs[0]).toBe(input.authorFeedbackRefs[0]);
    });
  });

  it("keeps capability-layer author feedback out of the next-run writing context", async () => {
    await withProject(async (root) => {
      await seedProject(root, { premise: "李白重生现代成都", title: "李白重生了" });
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: chapterFetch((n) => `李白在第${n}章继续行动。${"正文".repeat(600)}\n===OUTLINE===\n第${n}章：李白推进剧情`) });
      const deps: AuthoringRuntimeDeps = { store: host.store, workspace: host.workspace, llmGateway: host.llmGateway, policy: host.policy, provider: "deepseek", model: "m" };
      const first = await runChapters(deps, pkg(), 1);
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error(first.error.message);

      const recorded = await recordAuthorFeedback(host, {
        chapterNumber: 1,
        content: "小说 agent 反复忽略作者目标，需要提升目标服从能力",
        issueKind: "goal_coverage",
        layer: "capability",
        suggestedAction: "回流 xiaoshuo grow，而不是直接污染下一章正文"
      });
      expect(recorded.ok).toBe(true);
      if (!recorded.ok) throw new Error(recorded.error.message);
      const routed = JSON.parse(await readFile(path.join(root, recorded.value.feedbackPath), "utf8"));
      expect(routed.candidates[0].source).toBe("author_feedback");
      expect(routed.candidates[0].layer).toBe("capability");

      const second = await runChapters(deps, pkg(), 1);
      expect(second.ok).toBe(true);
      if (!second.ok) throw new Error(second.error.message);
      const messageList = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "chapters", "chapter-02", "message-list.json"), "utf8"));
      const messageText = JSON.stringify(messageList);
      expect(messageText).not.toContain("提升目标服从能力");
      expect(messageText).not.toContain("回流 xiaoshuo grow");
      const input = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "chapters", "chapter-02", "input.json"), "utf8"));
      expect(input.authorFeedbackInstructionCount).toBe(0);
      expect(input.authorFeedbackRefs).toEqual([]);
      const trace = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "chapters", "chapter-02", "trace.json"), "utf8"));
      expect(trace.authorFeedbackInstructionCount).toBe(0);
      expect(trace.authorFeedbackRefs).toEqual([]);
    });
  });

  it("catches a year drift across chapters and routes it to the work layer", async () => {
    await withProject(async (root) => {
      await seedProject(root, { premise: "p", title: "t", establishedYear: 2024, establishedCharacters: ["李白"] });
      const host = await createFengHost({
        config: { workspaceRoot: root, provider },
        fetchImpl: chapterFetch((n) => n === 1
          ? `李白现身，时值2024年。${"正文".repeat(600)}\n===OUTLINE===\n第1章：开端`
          : `李白前行，转眼已是2025年。${"正文".repeat(600)}\n===OUTLINE===\n第2章：推进`)
      });
      const deps: AuthoringRuntimeDeps = { store: host.store, workspace: host.workspace, llmGateway: host.llmGateway, policy: host.policy, provider: "deepseek", model: "m" };
      const result = await runChapters(deps, pkg(), 2);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const ch2 = result.value[1];
      expect(ch2?.quality.issues.some((i) => i.kind === "year_consistency")).toBe(true);
      expect(ch2?.feedback.byLayer.work).toBeGreaterThanOrEqual(1);
      const gates = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "chapters", "chapter-02", WORK_CHAPTER_QUALITY_GATE_FILE), "utf8"));
      expect(gates.gates.find((gate: { gateId: string }) => gate.gateId === "gate-year-consistency")?.status).toBe("failed");
      expect(gates.coverage.some((item: { requirement: string }) => item.requirement === "feedback:year_consistency->work")).toBe(true);
    });
  });

  it("self-repairs a too-short chapter and records the repair", async () => {
    await withProject(async (root) => {
      await seedProject(root, { premise: "p", title: "t" });
      let n = 0;
      const shortThenLong: FetchLike = async () => {
        n += 1;
        const content = n === 1
          ? "太短了。\n===OUTLINE===\n梗概"
          : `${"扩写后的正文内容。".repeat(120)}\n===OUTLINE===\n扩写后的梗概`;
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: shortThenLong });
      const deps: AuthoringRuntimeDeps = { store: host.store, workspace: host.workspace, llmGateway: host.llmGateway, policy: host.policy, provider: "deepseek", model: "m" };
      const result = await runChapters(deps, pkg(), 1);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value[0]?.repairAttempts).toBe(1);
      expect(result.value[0]?.chars).toBeGreaterThanOrEqual(900);
      const output = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "chapters", "chapter-01", "model-output.json"), "utf8"));
      expect(output.repairAttempts).toBe(1);
      expect(n).toBe(2);
    });
  });

  it("writes a file-native semantic eval artifact when enabled", async () => {
    await withProject(async (root) => {
      await seedProject(root, { premise: "p", title: "t" });
      let n = 0;
      const fetch: FetchLike = async () => {
        n += 1;
        const content = n % 2 === 1
          ? `${"正文内容。".repeat(200)}\n===OUTLINE===\n梗概`
          : '{"style": 8, "character": 7, "plot": 9, "notes": "好"}';
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: fetch });
      const deps: AuthoringRuntimeDeps = { store: host.store, workspace: host.workspace, llmGateway: host.llmGateway, policy: host.policy, provider: "deepseek", model: "m", semanticEval: true };
      const result = await runChapters(deps, pkg(), 1);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value[0]?.semantic?.overall).toBe(8);
      const semantic = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "chapters", "chapter-01", "semantic-eval.json"), "utf8"));
      expect(semantic.scores.style).toBe(8);
      expect(semantic.chapterNumber).toBe(1);
    });
  });

  it("revises a hard-failing chapter (year drift) and keeps the better candidate", async () => {
    await withProject(async (root) => {
      await seedProject(root, { premise: "p", title: "t", establishedYear: 2024, establishedCharacters: ["李白"] });
      let n = 0;
      const driftThenFixed: FetchLike = async () => {
        n += 1;
        // first draft: wrong year (hard fail); revision: correct year
        const content = n === 1
          ? `李白行走，时值2025年。${"正文".repeat(600)}\n===OUTLINE===\n第1章`
          : `李白行走，时值2024年。${"正文".repeat(600)}\n===OUTLINE===\n第1章`;
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: driftThenFixed });
      const deps: AuthoringRuntimeDeps = { store: host.store, workspace: host.workspace, llmGateway: host.llmGateway, policy: host.policy, provider: "deepseek", model: "m" };
      const result = await runChapters(deps, pkg(), 1);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      // the kept chapter is the revised (passing) one, not the drift draft
      expect(result.value[0]?.repairAttempts).toBe(1);
      expect(result.value[0]?.quality.status).toBe("pass");
      expect(result.value[0]?.quality.issues.some((i) => i.kind === "year_consistency")).toBe(false);
      expect(n).toBe(2);
    });
  });

  it("errors when the work project has no project.json", async () => {
    await withProject(async (root) => {
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: chapterFetch(() => "x") });
      const deps: AuthoringRuntimeDeps = { store: host.store, workspace: host.workspace, llmGateway: host.llmGateway, policy: host.policy, provider: "deepseek", model: "m" };
      const result = await runChapters(deps, pkg(), 1);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_state");
    });
  });

  it("loads a saved package and runs through it", async () => {
    await withProject(async (root) => {
      await seedProject(root, { premise: "p", title: "t" });
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: chapterFetch((n) => `${"正文".repeat(600)}\n===OUTLINE===\n第${n}章`) });
      const saved = await savePackage(host.store, host.workspace, pkg());
      expect(saved.ok).toBe(true);
      const deps: AuthoringRuntimeDeps = { store: host.store, workspace: host.workspace, llmGateway: host.llmGateway, policy: host.policy, provider: "deepseek", model: "m" };
      const result = await runChapters(deps, pkg(), 1);
      expect(result.ok).toBe(true);
    });
  });
});

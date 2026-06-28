import { describe, expect, it } from "vitest";
import { synthesizeWorkProjectQualityGates, synthesizeXiaoshuoQualityGates, type QualityGateSet } from "../../src/authoring-runtime/index.js";
import {
  defaultContextPolicy,
  defaultCoveragePolicy,
  defaultFeedbackRouting,
  defaultHarness,
  defaultNovelTargetWorld,
  defaultQualityRules,
  defaultStoryModel,
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
    writingStrategy: {
      systemPrompt: "你是写小说 agent，维护长篇上下文、设定冲突、质量门禁和反馈候选。",
      stylePrinciples: ["连贯"],
      constraints: ["归因作品层、能力层、系统层问题"]
    },
    storyModel: defaultStoryModel,
    harness: defaultHarness,
    coveragePolicy: defaultCoveragePolicy,
    qualityRules: defaultQualityRules,
    feedbackRouting: defaultFeedbackRouting,
    validation: { readiness: "ready", grownInProject: "/x", evidenceSummary: "ok", checkedAt: "t" },
    provenance: { model: "m", provider: "deepseek", hatchedAt: "t" }
  };
}

function gates(goal: string): QualityGateSet {
  return synthesizeXiaoshuoQualityGates({
    goal,
    pkg: pkg(),
    designArtifacts: { coveragePolicyAuthoredByGrow: true },
    finalIssueKinds: [],
    finalFailChapters: 0,
    sampleGateBlockingCount: 0,
    sampleRoundCount: 1,
    readiness: "ready",
    now: () => "t"
  });
}

describe("synthesizeXiaoshuoQualityGates", () => {
  it("maps long-context, output-contract, and feedback-routing goal items to gates", () => {
    const set = gates([
      "输出章节草稿、改稿、续写计划、设定冲突、质量门禁和反馈候选",
      "能保持长篇上下文、人物、时间线、地点、伏笔和情节推进连贯",
      "能把作品层、小说 agent 能力层、feng 系统层问题正确归因并回流"
    ].join("；"));
    const goalItems = set.coverage.filter((item) => item.requirement.startsWith("goal_item:"));
    expect(goalItems.length).toBeGreaterThan(0);
    expect(goalItems.every((item) => item.status !== "uncovered")).toBe(true);
    expect(goalItems.some((item) => item.mappedGateIds.includes("gate-runtime-contract"))).toBe(true);
    expect(goalItems.some((item) => item.mappedGateIds.includes("gate-feedback-routing"))).toBe(true);
    expect(goalItems.some((item) => item.mappedGateIds.includes("gate-outline-continuity"))).toBe(true);
    expect(set.gates.find((gate) => gate.gateId === "gate-user-goal-item-coverage")?.status).toBe("passed");
  });

  it("creates explicit gates for final capability issues not declared by the package", () => {
    const set = synthesizeXiaoshuoQualityGates({
      goal: "成长出高质量写作 agent",
      pkg: pkg(),
      designArtifacts: { coveragePolicyAuthoredByGrow: true },
      finalIssueKinds: ["semantic_plot"],
      finalFailChapters: 0,
      sampleGateBlockingCount: 1,
      sampleRoundCount: 1,
      readiness: "waiting_validation",
      now: () => "t"
    });
    const gate = set.gates.find((item) => item.gateId === "gate-final-capability-semantic-plot");
    expect(gate?.status).toBe("failed");
    expect(gate?.notes.join("\n")).toContain("did not declare a dedicated quality rule");
  });

  it("blocks hatch readiness when seeded capability feedback is downgraded to work routing", () => {
    const downgraded: AuthoringRuntimePackage = {
      ...pkg(),
      writingStrategy: {
        ...pkg().writingStrategy,
        constraints: [
          ...pkg().writingStrategy.constraints,
          "每章正文必须正面回应【本章目标】"
        ]
      },
      feedbackRouting: [
        ...defaultFeedbackRouting.filter((route) => route.issueKind !== "goal_coverage"),
        { issueKind: "goal_coverage", layer: "work", reason: "错误地留在作品本地" }
      ]
    };
    const set = synthesizeXiaoshuoQualityGates({
      goal: "成长出能处理目标覆盖反馈的小说 agent",
      pkg: downgraded,
      designArtifacts: { coveragePolicyAuthoredByGrow: true },
      finalIssueKinds: [],
      capabilityFeedbackCoverage: [{
        issueKind: "goal_coverage",
        mappedConstraint: "每章正文必须正面回应【本章目标】",
        source: "capability_feedback_adoption:adopted"
      }],
      finalFailChapters: 0,
      sampleGateBlockingCount: 0,
      sampleRoundCount: 1,
      readiness: "ready_to_hatch",
      now: () => "t"
    });

    const gate = set.gates.find((item) => item.gateId === "gate-seeded-capability-goal-coverage");
    expect(gate?.status).toBe("failed");
    expect(gate?.notes.join("\n")).toContain("goal_coverage->work");
    expect(gate?.notes.join("\n")).toContain("must not be downgraded");
    expect(set.summary.blockingCount).toBeGreaterThan(0);
  });
});

describe("synthesizeWorkProjectQualityGates", () => {
  it("uses routed semantic/runtime feedback when judging a package quality rule", () => {
    const runtimePackage: AuthoringRuntimePackage = {
      ...pkg(),
      qualityRules: [...defaultQualityRules, { kind: "semantic_plot", note: "情节必须有推进" }]
    };
    const set = synthesizeWorkProjectQualityGates({
      project: { premise: "p", title: "t" },
      pkg: runtimePackage,
      chapterNumber: 1,
      artifactDir: ".feng/runtime/chapters/chapter-01",
      quality: { chapterNumber: 1, chars: 1200, status: "pass", passed: true, issues: [], checkedAt: "t" },
      feedback: {
        byLayer: { work: 0, capability: 1, system: 0 },
        candidates: [{
          issueKind: "semantic_plot",
          layer: "capability",
          severity: "warning",
          detail: "情节推进不足",
          routingReason: "semantic judge",
          chapterNumber: 1
        }]
      },
      semanticEvaluated: true,
      now: () => "t"
    });
    expect(set.gates.find((gate) => gate.gateId === "gate-semantic-plot")?.status).toBe("needs_human_judgment");
  });

  it("does not fail feedback routing when all generated issues have routed candidates", () => {
    const set = synthesizeWorkProjectQualityGates({
      project: { premise: "p", title: "t" },
      pkg: pkg(),
      chapterNumber: 1,
      artifactDir: ".feng/runtime/chapters/chapter-01",
      quality: {
        chapterNumber: 1,
        chars: 1200,
        status: "pass_with_warnings",
        passed: true,
        issues: [
          { kind: "geography_consistency", severity: "warning", detail: "地点待复核" },
          { kind: "geography_consistency", severity: "warning", detail: "地点待复核" }
        ],
        checkedAt: "t"
      },
      feedback: {
        byLayer: { work: 1, capability: 1, system: 0 },
        candidates: [
          { issueKind: "geography_consistency", layer: "work", severity: "warning", detail: "地点待复核", routingReason: "本地修正", chapterNumber: 1 },
          { issueKind: "semantic_plot", layer: "capability", severity: "warning", detail: "情节引入太巧", routingReason: "回流能力", chapterNumber: 1 }
        ]
      },
      semanticEvaluated: true,
      now: () => "t"
    });
    const gate = set.gates.find((item) => item.gateId === "gate-feedback-routing");
    expect(gate?.status).toBe("passed");
    expect(gate?.notes.join("\n")).toContain("generatedIssues=2");
    expect(gate?.notes.join("\n")).toContain("candidates=2");
  });

  it("materializes goal coverage through the explicit chapter gate instead of a duplicate quality gate", () => {
    const runtimePackage: AuthoringRuntimePackage = {
      ...pkg(),
      coveragePolicy: {
        noMissingTopic: {
          ...defaultCoveragePolicy.noMissingTopic,
          gateId: "gate-goal-coverage",
          title: "章节目标全覆盖门禁"
        }
      },
      qualityRules: [
        { kind: "goal_coverage", note: "正文中每个 chapter_goal 要点必须能在文中找到" },
        ...defaultQualityRules
      ]
    };
    const set = synthesizeWorkProjectQualityGates({
      project: { premise: "p", title: "t" },
      pkg: runtimePackage,
      chapterNumber: 1,
      chapterGoal: "写出李白被苏小满带到书店暂避",
      artifactDir: ".feng/runtime/chapters/chapter-01",
      quality: { chapterNumber: 1, chars: 1200, status: "pass", passed: true, issues: [], checkedAt: "t" },
      feedback: { byLayer: { work: 0, capability: 0, system: 0 }, candidates: [] },
      semanticEvaluated: true,
      goalCoverage: {
        chapterNumber: 1,
        goal: "写出李白被苏小满带到书店暂避",
        parseOk: true,
        covered: false,
        confidence: 0.9,
        evidence: [],
        missing: ["没有真正进入书店"],
        notes: "漏题",
        raw: "{}",
        evaluatedAt: "t"
      },
      now: () => "t"
    });
    const goalGates = set.gates.filter((gate) => gate.issueKinds.includes("goal_coverage"));
    expect(goalGates).toHaveLength(1);
    expect(goalGates[0]?.gateId).toBe("gate-goal-coverage");
    expect(goalGates[0]?.status).toBe("failed");
    expect(set.coverage.find((item) => item.requirement.startsWith("chapter_goal:"))?.mappedGateIds).toEqual(["gate-goal-coverage"]);
    expect(set.coverage.some((item) => item.requirement === "quality:goal_coverage")).toBe(false);
  });
});

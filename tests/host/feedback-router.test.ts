import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CAPABILITY_DIGEST_PATH, createFengHost, feedbackDigestDetailKey, routeProjectFeedback, SYSTEM_DIGEST_PATH } from "../../src/host/index.js";

const provider = { provider: "deepseek", apiKey: "k", baseUrl: "https://api.deepseek.com", model: "m", maxTokens: 256, reasoningModel: true };

async function withRoots(body: (work: string, agent: string, feng: string) => Promise<void>): Promise<void> {
  const work = await mkdtemp(path.join(tmpdir(), "feng-rf-work-"));
  const agent = await mkdtemp(path.join(tmpdir(), "feng-rf-agent-"));
  const feng = await mkdtemp(path.join(tmpdir(), "feng-rf-feng-"));
  try {
    await body(work, agent, feng);
  } finally {
    for (const d of [work, agent, feng]) await rm(d, { recursive: true, force: true });
  }
}

async function seedFeedback(root: string, chapter: number, candidates: unknown[]): Promise<void> {
  const dir = path.join(root, ".feng", "runtime", "chapters", `chapter-0${chapter}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "feedback.json"), JSON.stringify({ candidates, byLayer: {} }), "utf8");
}

async function seedQualityGates(root: string, chapter: number, gates: unknown[]): Promise<void> {
  const dir = path.join(root, ".feng", "runtime", "chapters", `chapter-0${chapter}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "quality-gates.json"), JSON.stringify({
    schemaVersion: "1.0.0",
    kind: "work_project_quality_gate_set",
    generatedAt: "t",
    goal: "g",
    packageName: "xiaoshuo",
    packageVersion: "1.0.0",
    sampleRoundCount: chapter,
    readiness: "pass",
    gates,
    coverage: [],
    summary: { totalGates: gates.length, passed: 0, failed: 0, waitingEvidence: 0, needsHumanJudgment: 0, uncoveredRequirements: 0, blockingCount: gates.length }
  }), "utf8");
}

describe("routeProjectFeedback", () => {
  it("keeps work facts local and absorbs capability/system upstream", async () => {
    await withRoots(async (work, agent, feng) => {
      await seedFeedback(work, 1, [
        { issueKind: "length", layer: "work", severity: "warning", detail: "字数", routingReason: "本地", chapterNumber: 1 },
        { issueKind: "character_continuation", layer: "capability", severity: "warning", detail: "人物", routingReason: "回流", chapterNumber: 1 },
        { issueKind: "artifact_presence", layer: "system", severity: "error", detail: "trace缺失", routingReason: "feng", chapterNumber: 1 }
      ]);
      const workHost = await createFengHost({ config: { workspaceRoot: work, provider } });
      const agentHost = await createFengHost({ config: { workspaceRoot: agent, provider } });
      const fengHost = await createFengHost({ config: { workspaceRoot: feng, provider } });
      const result = await routeProjectFeedback({ workHost, agentHost, fengHost });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.totalCandidates).toBe(3);
      expect(result.value.keptLocal).toBe(1);
      expect(result.value.absorbedToAgent).toBe(1);
      expect(result.value.absorbedToFeng).toBe(1);
      expect(result.value.byLayer).toEqual({ work: 1, capability: 1, system: 1 });
      // capability digest is written file-native into the agent workspace
      const digest = JSON.parse(await readFile(path.join(agent, ".feng", "grow-inbox", "capability-feedback.json"), "utf8"));
      expect(digest.issueKinds).toContain("character_continuation");
      expect(digest.count).toBe(1);
      expect(digest.details[0].feedbackKey).toBe(feedbackDigestDetailKey(digest.details[0]));
      expect(digest.details[0].admissionRef).toContain("inbox-item://");
      expect(digest.details[0].admissionRecordPath).toContain(".feng/admission/inbox/records/");
      expect(digest.details[0].admissionDecision).toBe("admit_as_feedback_candidate");
      expect(digest.details[0].admissionGrowUnitId).toBeDefined();
      const admission = JSON.parse(await readFile(path.join(agent, digest.details[0].admissionRecordPath), "utf8"));
      expect(admission.inboxItemRef.uri).toBe(digest.details[0].admissionRef);
      expect(admission.decision.decision).toBe("admit_as_feedback_candidate");
      const systemDigest = JSON.parse(await readFile(path.join(feng, SYSTEM_DIGEST_PATH), "utf8"));
      expect(systemDigest.kind).toBe("system_feedback_digest");
      expect(systemDigest.issueKinds).toContain("artifact_presence");
      expect(systemDigest.count).toBe(1);
      expect(systemDigest.details[0].feedbackKey).toBe(feedbackDigestDetailKey(systemDigest.details[0]));
      expect(systemDigest.details[0].admissionRecordPath).toContain(".feng/admission/inbox/records/");
      const systemAdmission = JSON.parse(await readFile(path.join(feng, systemDigest.details[0].admissionRecordPath), "utf8"));
      expect(systemAdmission.inboxItemRef.uri).toBe(systemDigest.details[0].admissionRef);
      expect(systemAdmission.decision.decision).toBe("admit_as_feedback_candidate");
    });
  });

  it("returns zero when there are no chapter feedback files", async () => {
    await withRoots(async (work) => {
      const workHost = await createFengHost({ config: { workspaceRoot: work, provider } });
      const result = await routeProjectFeedback({ workHost });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.totalCandidates).toBe(0);
    });
  });

  it("does not push work facts upstream when only work issues exist", async () => {
    await withRoots(async (work, agent) => {
      await seedFeedback(work, 1, [{ issueKind: "length", layer: "work", severity: "warning", detail: "字数", routingReason: "本地", chapterNumber: 1 }]);
      const workHost = await createFengHost({ config: { workspaceRoot: work, provider } });
      const agentHost = await createFengHost({ config: { workspaceRoot: agent, provider } });
      const result = await routeProjectFeedback({ workHost, agentHost });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.absorbedToAgent).toBe(0);
    });
  });

  it("keeps no-missing-topic gate evidence local when a chapter goal is still unproven", async () => {
    await withRoots(async (work, agent) => {
      await seedQualityGates(work, 1, [{
        gateId: "gate-chapter-goal-coverage",
        layer: "work",
        title: "本章目标不漏题",
        sourceRequirement: "写出李白第一次适应手机支付",
        evidenceRequired: "author review",
        status: "waiting_evidence",
        issueKinds: ["goal_coverage"],
        notes: ["chapter goal is tracked explicitly"]
      }]);
      const workHost = await createFengHost({ config: { workspaceRoot: work, provider } });
      const agentHost = await createFengHost({ config: { workspaceRoot: agent, provider } });
      const result = await routeProjectFeedback({ workHost, agentHost });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.totalCandidates).toBe(1);
      expect(result.value.keptLocal).toBe(1);
      expect(result.value.absorbedToAgent).toBe(0);
    });
  });

  it("routes failed goal-coverage gates upstream as capability feedback", async () => {
    await withRoots(async (work, agent) => {
      await seedQualityGates(work, 1, [{
        gateId: "gate-chapter-goal-coverage",
        layer: "capability",
        title: "本章目标不漏题",
        sourceRequirement: "写出李白第一次适应手机支付",
        evidenceRequired: "goal coverage evaluator",
        status: "failed",
        issueKinds: ["goal_coverage"],
        notes: ["goalCoverage=false; confidence=0.91; evidence=0; missing=1; artifact=.feng/runtime/chapters/chapter-01/goal-coverage-eval.json"]
      }]);
      const workHost = await createFengHost({ config: { workspaceRoot: work, provider } });
      const agentHost = await createFengHost({ config: { workspaceRoot: agent, provider } });
      const result = await routeProjectFeedback({ workHost, agentHost });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.totalCandidates).toBe(1);
      expect(result.value.keptLocal).toBe(0);
      expect(result.value.absorbedToAgent).toBe(1);
      const digest = JSON.parse(await readFile(path.join(agent, CAPABILITY_DIGEST_PATH), "utf8"));
      expect(digest.issueKinds).toEqual(["goal_coverage"]);
      expect(digest.details[0].source).toBe("quality_gate");
      expect(digest.details[0].gateId).toBe("gate-chapter-goal-coverage");
      expect(digest.details[0].detail).toContain("本章目标不漏题");
      expect(digest.details[0].feedbackKey).toBe(feedbackDigestDetailKey(digest.details[0]));
    });
  });

  it("turns capability quality-gate gaps into upstream grow input even without feedback.json issues", async () => {
    await withRoots(async (work, agent) => {
      await seedQualityGates(work, 1, [{
        gateId: "gate-semantic-plot",
        layer: "capability",
        title: "情节推进",
        sourceRequirement: "semantic plot rule",
        evidenceRequired: "semantic judge",
        status: "waiting_evidence",
        issueKinds: ["semantic_plot"],
        notes: ["no semantic eval artifact"]
      }]);
      const workHost = await createFengHost({ config: { workspaceRoot: work, provider } });
      const agentHost = await createFengHost({ config: { workspaceRoot: agent, provider } });
      const result = await routeProjectFeedback({ workHost, agentHost });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.totalCandidates).toBe(1);
      expect(result.value.absorbedToAgent).toBe(1);
      const digest = JSON.parse(await readFile(path.join(agent, ".feng", "grow-inbox", "capability-feedback.json"), "utf8"));
      expect(digest.issueKinds).toEqual(["semantic_plot"]);
      expect(digest.details[0].source).toBe("quality_gate");
      expect(digest.details[0].gateId).toBe("gate-semantic-plot");
      expect(digest.details[0].artifactPath).toContain("quality-gates.json");
      expect(digest.details[0].feedbackKey).toBe(feedbackDigestDetailKey(digest.details[0]));
    });
  });

  it("does not drop same-kind capability gates from the same chapter", async () => {
    await withRoots(async (work, agent) => {
      await seedQualityGates(work, 1, [
        {
          gateId: "gate-semantic-plot-conflict",
          layer: "capability",
          title: "情节冲突",
          sourceRequirement: "缺少明确冲突",
          evidenceRequired: "semantic judge",
          status: "waiting_evidence",
          issueKinds: ["semantic_plot"],
          notes: ["conflict missing"]
        },
        {
          gateId: "gate-semantic-plot-payoff",
          layer: "capability",
          title: "情节回收",
          sourceRequirement: "伏笔没有回收",
          evidenceRequired: "semantic judge",
          status: "waiting_evidence",
          issueKinds: ["semantic_plot"],
          notes: ["payoff missing"]
        }
      ]);
      const workHost = await createFengHost({ config: { workspaceRoot: work, provider } });
      const agentHost = await createFengHost({ config: { workspaceRoot: agent, provider } });
      const result = await routeProjectFeedback({ workHost, agentHost });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.totalCandidates).toBe(2);
      expect(result.value.absorbedToAgent).toBe(2);
      const digest = JSON.parse(await readFile(path.join(agent, CAPABILITY_DIGEST_PATH), "utf8"));
      expect(digest.count).toBe(2);
      expect(digest.issueKinds).toEqual(["semantic_plot"]);
      expect(digest.details.map((detail: { gateId?: string }) => detail.gateId)).toEqual(expect.arrayContaining([
        "gate-semantic-plot-conflict",
        "gate-semantic-plot-payoff"
      ]));
    });
  });

  it("absorbs unresolved author feedback and prunes the upstream digest after its local gate passes", async () => {
    await withRoots(async (work, agent) => {
      await seedFeedback(work, 1, [{
        issueKind: "semantic_plot",
        layer: "capability",
        severity: "warning",
        detail: "author_feedback:情节太平，需要补冲突",
        routingReason: "作者反馈形成的待处理修订/归因任务",
        chapterNumber: 1,
        source: "author_feedback",
        gateId: "gate-author-feedback-ch01-01",
        feedbackRef: ".feng/runtime/chapters/chapter-01/author-feedback.json#author-feedback-ch01-01"
      }]);
      await seedQualityGates(work, 1, [{
        gateId: "gate-author-feedback-ch01-01",
        layer: "capability",
        title: "作者反馈处理",
        sourceRequirement: "情节太平，需要补冲突",
        evidenceRequired: "后续修订证明已处理",
        status: "waiting_evidence",
        issueKinds: ["semantic_plot"],
        notes: ["generated from explicit author feedback"]
      }]);
      const workHost = await createFengHost({ config: { workspaceRoot: work, provider } });
      const agentHost = await createFengHost({ config: { workspaceRoot: agent, provider } });
      const unresolved = await routeProjectFeedback({ workHost, agentHost });
      expect(unresolved.ok).toBe(true);
      if (!unresolved.ok) throw new Error(unresolved.error.message);
      expect(unresolved.value.absorbedToAgent).toBe(1);
      let digest = JSON.parse(await readFile(path.join(agent, CAPABILITY_DIGEST_PATH), "utf8"));
      expect(digest.details[0].source).toBe("author_feedback");
      expect(digest.details[0].gateId).toBe("gate-author-feedback-ch01-01");

      const gatesPath = path.join(work, ".feng", "runtime", "chapters", "chapter-01", "quality-gates.json");
      const gates = JSON.parse(await readFile(gatesPath, "utf8"));
      gates.gates[0].status = "passed";
      await writeFile(gatesPath, JSON.stringify(gates), "utf8");
      const skipped = await routeProjectFeedback({ workHost, agentHost });
      expect(skipped.ok).toBe(true);
      if (!skipped.ok) throw new Error(skipped.error.message);
      expect(skipped.value.totalCandidates).toBe(0);
      expect(skipped.value.absorbedToAgent).toBe(0);
      expect(skipped.value.capabilityDigestPath).toBe(CAPABILITY_DIGEST_PATH);
      digest = JSON.parse(await readFile(path.join(agent, CAPABILITY_DIGEST_PATH), "utf8"));
      expect(digest.count).toBe(0);
      expect(digest.issueKinds).toEqual([]);
      expect(digest.details).toEqual([]);
    });
  });

  it("can route feedback from a summary-only runtime debug report", async () => {
    await withRoots(async (work, agent) => {
      const reportDir = path.join(work, ".feng", "runtime", "debug-reports");
      await mkdir(reportDir, { recursive: true });
      await writeFile(
        path.join(reportDir, "latest.json"),
        JSON.stringify({
          schemaVersion: "1.0.0",
          kind: "runtime_debug_report",
          generatedAt: "t",
          privacyBoundary: "artifact_refs_and_summaries_only",
          rawContentIncluded: false,
          package: {
            packagePath: ".feng/hatch/xiaoshuo-runtime.json",
            packageId: "pkg-x",
            name: "xiaoshuo",
            version: "1.0.0",
            contentHash: { algorithm: "sha256", value: "abc" },
            locked: true,
            readiness: "ready"
          },
          chapters: [{
            chapterNumber: 1,
            artifactDir: ".feng/runtime/chapters/chapter-01",
            traceRef: ".feng/runtime/chapters/chapter-01/trace.json",
            messageListRef: ".feng/runtime/chapters/chapter-01/message-list.json",
            modelOutputRef: ".feng/runtime/chapters/chapter-01/model-output.json",
            qualityEvalRef: ".feng/runtime/chapters/chapter-01/quality-eval.json",
            feedbackRef: ".feng/runtime/chapters/chapter-01/feedback.json",
            qualityGateRef: ".feng/runtime/chapters/chapter-01/quality-gates.json",
            qualityGateSummary: "quality gates 0/1 passed; blocking=1; coverage_uncovered=0",
            chars: 1000,
            qualityStatus: "pass_with_warnings",
            repairAttempts: 0,
            feedbackCandidateCount: 1,
            byLayer: { work: 0, capability: 1, system: 0 }
          }],
          feedbackCandidates: [{
            issueKind: "semantic_plot",
            layer: "capability",
            severity: "warning",
            detail: "debug summary: plot did not advance",
            routingReason: "runtime debug report candidate",
            chapterNumber: 1,
            source: "debug_report",
            artifactPath: ".feng/runtime/debug-reports/latest.json",
            gateId: "gate-semantic-plot",
            qualityGateStatus: "failed"
          }]
        }),
        "utf8"
      );
      const workHost = await createFengHost({ config: { workspaceRoot: work, provider } });
      const agentHost = await createFengHost({ config: { workspaceRoot: agent, provider } });
      const result = await routeProjectFeedback({ workHost, agentHost });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.totalCandidates).toBe(1);
      expect(result.value.absorbedToAgent).toBe(1);
      const digest = JSON.parse(await readFile(path.join(agent, CAPABILITY_DIGEST_PATH), "utf8"));
      expect(digest.details[0].source).toBe("debug_report");
      expect(digest.details[0].artifactPath).toBe(".feng/runtime/debug-reports/latest.json");
      expect(digest.details[0].gateId).toBe("gate-semantic-plot");
      expect(digest.details[0].qualityGateStatus).toBe("failed");
      expect(digest.details[0].detail).toContain("plot did not advance");
    });
  });

  it("skips stale debug-report candidates when the current quality gate has passed", async () => {
    await withRoots(async (work, agent) => {
      await seedQualityGates(work, 1, [{
        gateId: "gate-semantic-plot",
        layer: "capability",
        title: "情节推进",
        sourceRequirement: "semantic plot rule",
        evidenceRequired: "semantic judge",
        status: "passed",
        issueKinds: ["semantic_plot"],
        notes: ["author review cleared this gate"]
      }]);
      const reportDir = path.join(work, ".feng", "runtime", "debug-reports");
      await mkdir(reportDir, { recursive: true });
      await writeFile(
        path.join(reportDir, "latest.json"),
        JSON.stringify({
          schemaVersion: "1.0.0",
          kind: "runtime_debug_report",
          generatedAt: "old",
          privacyBoundary: "artifact_refs_and_summaries_only",
          rawContentIncluded: false,
          package: {
            packagePath: ".feng/hatch/xiaoshuo-runtime.json",
            packageId: "pkg-x",
            name: "xiaoshuo",
            version: "1.0.0",
            contentHash: { algorithm: "sha256", value: "abc" },
            locked: true,
            readiness: "ready"
          },
          chapters: [],
          feedbackCandidates: [{
            issueKind: "semantic_plot",
            layer: "capability",
            severity: "warning",
            detail: "old debug summary: plot did not advance",
            routingReason: "runtime debug report candidate",
            chapterNumber: 1,
            source: "debug_report",
            artifactPath: ".feng/runtime/debug-reports/latest.json",
            gateId: "gate-semantic-plot",
            qualityGateStatus: "failed"
          }]
        }),
        "utf8"
      );
      const workHost = await createFengHost({ config: { workspaceRoot: work, provider } });
      const agentHost = await createFengHost({ config: { workspaceRoot: agent, provider } });
      const result = await routeProjectFeedback({ workHost, agentHost });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.totalCandidates).toBe(0);
      expect(result.value.absorbedToAgent).toBe(0);
      expect(result.value.capabilityDigestPath).toBeUndefined();
      await expect(readFile(path.join(agent, CAPABILITY_DIGEST_PATH), "utf8")).rejects.toThrow();
    });
  });

  it("does not drop same-kind debug-report candidates with different details", async () => {
    await withRoots(async (work, agent) => {
      const reportDir = path.join(work, ".feng", "runtime", "debug-reports");
      await mkdir(reportDir, { recursive: true });
      await writeFile(
        path.join(reportDir, "latest.json"),
        JSON.stringify({
          schemaVersion: "1.0.0",
          kind: "runtime_debug_report",
          generatedAt: "t",
          privacyBoundary: "artifact_refs_and_summaries_only",
          rawContentIncluded: false,
          package: {
            packagePath: ".feng/hatch/xiaoshuo-runtime.json",
            packageId: "pkg-x",
            name: "xiaoshuo",
            version: "1.0.0",
            contentHash: { algorithm: "sha256", value: "abc" },
            locked: true,
            readiness: "ready"
          },
          chapters: [],
          feedbackCandidates: [
            {
              issueKind: "semantic_plot",
              layer: "capability",
              severity: "warning",
              detail: "debug summary: plot did not advance",
              routingReason: "runtime debug report candidate",
              chapterNumber: 1,
              source: "debug_report",
              artifactPath: ".feng/runtime/debug-reports/latest.json"
            },
            {
              issueKind: "semantic_plot",
              layer: "capability",
              severity: "warning",
              detail: "debug summary: payoff was skipped",
              routingReason: "runtime debug report candidate",
              chapterNumber: 1,
              source: "debug_report",
              artifactPath: ".feng/runtime/debug-reports/latest.json"
            }
          ]
        }),
        "utf8"
      );
      const workHost = await createFengHost({ config: { workspaceRoot: work, provider } });
      const agentHost = await createFengHost({ config: { workspaceRoot: agent, provider } });
      const result = await routeProjectFeedback({ workHost, agentHost });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.totalCandidates).toBe(2);
      expect(result.value.absorbedToAgent).toBe(2);
      const digest = JSON.parse(await readFile(path.join(agent, CAPABILITY_DIGEST_PATH), "utf8"));
      expect(digest.count).toBe(2);
      expect(digest.details.map((detail: { detail: string }) => detail.detail)).toEqual(expect.arrayContaining([
        "debug summary: plot did not advance",
        "debug summary: payoff was skipped"
      ]));
    });
  });

  it("merges new capability feedback into the existing agent digest instead of replacing it", async () => {
    await withRoots(async (work, agent) => {
      await mkdir(path.join(agent, ".feng", "grow-inbox"), { recursive: true });
      await writeFile(
        path.join(agent, CAPABILITY_DIGEST_PATH),
        JSON.stringify({
          schemaVersion: "1.0.0",
          kind: "capability_feedback_digest",
          layer: "capability",
          issueKinds: ["semantic_character"],
          count: 1,
          updatedAt: "old",
          details: [{
            issueKind: "semantic_character",
            chapter: 3,
            detail: "old character issue",
            source: "quality_gate",
            gateId: "gate-semantic-character",
            artifactPath: ".feng/runtime/chapters/chapter-03/quality-gates.json"
          }]
        }),
        "utf8"
      );
      await seedQualityGates(work, 4, [{
        gateId: "gate-semantic-plot",
        layer: "capability",
        title: "情节推进",
        sourceRequirement: "semantic plot rule",
        evidenceRequired: "semantic judge",
        status: "waiting_evidence",
        issueKinds: ["semantic_plot"],
        notes: ["plot issue"]
      }]);
      const workHost = await createFengHost({ config: { workspaceRoot: work, provider } });
      const agentHost = await createFengHost({ config: { workspaceRoot: agent, provider } });
      const result = await routeProjectFeedback({ workHost, agentHost });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const digest = JSON.parse(await readFile(path.join(agent, CAPABILITY_DIGEST_PATH), "utf8"));
      expect(digest.count).toBe(2);
      expect(digest.issueKinds).toEqual(expect.arrayContaining(["semantic_character", "semantic_plot"]));
      expect(digest.details.some((detail: { issueKind: string; detail: string }) =>
        detail.issueKind === "semantic_character" && detail.detail === "old character issue"
      )).toBe(true);
      expect(digest.details.some((detail: { issueKind: string; gateId?: string }) =>
        detail.issueKind === "semantic_plot" && detail.gateId === "gate-semantic-plot"
      )).toBe(true);
    });
  });

  it("does not re-absorb capability feedback already present in the agent digest", async () => {
    await withRoots(async (work, agent) => {
      await seedFeedback(work, 1, [{
        issueKind: "semantic_plot",
        layer: "capability",
        severity: "warning",
        detail: "情节没有推进",
        routingReason: "回流",
        chapterNumber: 1
      }]);
      const workHost = await createFengHost({ config: { workspaceRoot: work, provider } });
      const agentHost = await createFengHost({ config: { workspaceRoot: agent, provider } });
      const first = await routeProjectFeedback({ workHost, agentHost });
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error(first.error.message);
      expect(first.value.absorbedToAgent).toBe(1);

      const second = await routeProjectFeedback({ workHost, agentHost });
      expect(second.ok).toBe(true);
      if (!second.ok) throw new Error(second.error.message);
      expect(second.value.totalCandidates).toBe(1);
      expect(second.value.absorbedToAgent).toBe(0);
      expect(second.value.capabilityDigestPath).toBeUndefined();
      const digest = JSON.parse(await readFile(path.join(agent, CAPABILITY_DIGEST_PATH), "utf8"));
      expect(digest.count).toBe(1);
      expect(digest.details[0].detail).toBe("情节没有推进");
    });
  });

  it("turns runtime quality-gate gaps into a feng-level system feedback digest", async () => {
    await withRoots(async (work, _agent, feng) => {
      await seedQualityGates(work, 1, [{
        gateId: "gate-runtime-contract",
        layer: "runtime",
        title: "目标世界运行契约",
        sourceRequirement: "runtime kernel cannot express dialogue",
        evidenceRequired: "runtime contract support",
        status: "failed",
        issueKinds: ["runtime_capability"],
        notes: ["dialogueAllowed=true but kernel lacks dialogue mode"]
      }]);
      const workHost = await createFengHost({ config: { workspaceRoot: work, provider } });
      const fengHost = await createFengHost({ config: { workspaceRoot: feng, provider } });
      const result = await routeProjectFeedback({ workHost, fengHost });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.totalCandidates).toBe(1);
      expect(result.value.absorbedToFeng).toBe(1);
      expect(result.value.systemDigestPath).toBe(SYSTEM_DIGEST_PATH);
      const digest = JSON.parse(await readFile(path.join(feng, SYSTEM_DIGEST_PATH), "utf8"));
      expect(digest.issueKinds).toEqual(["runtime_capability"]);
      expect(digest.details[0].source).toBe("quality_gate");
      expect(digest.details[0].gateId).toBe("gate-runtime-contract");
      expect(digest.details[0].artifactPath).toContain("quality-gates.json");
    });
  });

  it("does not re-absorb system feedback already present in the feng digest", async () => {
    await withRoots(async (work, _agent, feng) => {
      await seedQualityGates(work, 1, [{
        gateId: "gate-runtime-contract",
        layer: "runtime",
        title: "目标世界运行契约",
        sourceRequirement: "runtime kernel cannot express dialogue",
        evidenceRequired: "runtime contract support",
        status: "failed",
        issueKinds: ["runtime_capability"],
        notes: ["dialogueAllowed=true but kernel lacks dialogue mode"]
      }]);
      const workHost = await createFengHost({ config: { workspaceRoot: work, provider } });
      const fengHost = await createFengHost({ config: { workspaceRoot: feng, provider } });
      const first = await routeProjectFeedback({ workHost, fengHost });
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error(first.error.message);
      expect(first.value.absorbedToFeng).toBe(1);

      const second = await routeProjectFeedback({ workHost, fengHost });
      expect(second.ok).toBe(true);
      if (!second.ok) throw new Error(second.error.message);
      expect(second.value.totalCandidates).toBe(1);
      expect(second.value.absorbedToFeng).toBe(0);
      expect(second.value.systemDigestPath).toBeUndefined();
      const digest = JSON.parse(await readFile(path.join(feng, SYSTEM_DIGEST_PATH), "utf8"));
      expect(digest.count).toBe(1);
      expect(digest.details[0].gateId).toBe("gate-runtime-contract");
    });
  });

  it("prunes stale system feedback from the feng digest after the local runtime gate passes", async () => {
    await withRoots(async (work, _agent, feng) => {
      await seedQualityGates(work, 1, [{
        gateId: "gate-runtime-contract",
        layer: "runtime",
        title: "目标世界运行契约",
        sourceRequirement: "runtime kernel cannot express dialogue",
        evidenceRequired: "runtime contract support",
        status: "failed",
        issueKinds: ["runtime_capability"],
        notes: ["dialogueAllowed=true but kernel lacks dialogue mode"]
      }]);
      const workHost = await createFengHost({ config: { workspaceRoot: work, provider } });
      const fengHost = await createFengHost({ config: { workspaceRoot: feng, provider } });
      const first = await routeProjectFeedback({ workHost, fengHost });
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error(first.error.message);
      expect(first.value.absorbedToFeng).toBe(1);
      let digest = JSON.parse(await readFile(path.join(feng, SYSTEM_DIGEST_PATH), "utf8"));
      expect(digest.count).toBe(1);

      const gatesPath = path.join(work, ".feng", "runtime", "chapters", "chapter-01", "quality-gates.json");
      const gates = JSON.parse(await readFile(gatesPath, "utf8"));
      gates.gates[0].status = "passed";
      await writeFile(gatesPath, JSON.stringify(gates), "utf8");

      const pruned = await routeProjectFeedback({ workHost, fengHost });
      expect(pruned.ok).toBe(true);
      if (!pruned.ok) throw new Error(pruned.error.message);
      expect(pruned.value.totalCandidates).toBe(0);
      expect(pruned.value.absorbedToFeng).toBe(0);
      expect(pruned.value.systemDigestPath).toBe(SYSTEM_DIGEST_PATH);
      digest = JSON.parse(await readFile(path.join(feng, SYSTEM_DIGEST_PATH), "utf8"));
      expect(digest.count).toBe(0);
      expect(digest.issueKinds).toEqual([]);
      expect(digest.details).toEqual([]);
    });
  });

  it("merges new system feedback into the existing digest instead of dropping older unresolved issues", async () => {
    await withRoots(async (work, _agent, feng) => {
      await mkdir(path.join(feng, ".feng", "grow-inbox"), { recursive: true });
      await writeFile(
        path.join(feng, SYSTEM_DIGEST_PATH),
        JSON.stringify({
          schemaVersion: "1.0.0",
          kind: "system_feedback_digest",
          layer: "system",
          issueKinds: ["artifact_presence"],
          count: 1,
          updatedAt: "old",
          details: [{
            issueKind: "artifact_presence",
            chapter: 1,
            detail: "old missing trace",
            source: "feedback",
            artifactPath: ".feng/runtime/chapters/chapter-01/feedback.json"
          }]
        }),
        "utf8"
      );
      await seedQualityGates(work, 2, [{
        gateId: "gate-runtime-contract",
        layer: "runtime",
        title: "目标世界运行契约",
        sourceRequirement: "runtime kernel cannot express dialogue",
        evidenceRequired: "runtime contract support",
        status: "failed",
        issueKinds: ["runtime_capability"],
        notes: ["dialogueAllowed=true but kernel lacks dialogue mode"]
      }]);
      const workHost = await createFengHost({ config: { workspaceRoot: work, provider } });
      const fengHost = await createFengHost({ config: { workspaceRoot: feng, provider } });
      const result = await routeProjectFeedback({ workHost, fengHost });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const digest = JSON.parse(await readFile(path.join(feng, SYSTEM_DIGEST_PATH), "utf8"));
      expect(digest.count).toBe(2);
      expect(digest.issueKinds).toEqual(expect.arrayContaining(["artifact_presence", "runtime_capability"]));
      expect(digest.details.some((detail: { issueKind: string; detail: string }) =>
        detail.issueKind === "artifact_presence" && detail.detail === "old missing trace"
      )).toBe(true);
      expect(digest.details.some((detail: { issueKind: string; gateId?: string }) =>
        detail.issueKind === "runtime_capability" && detail.gateId === "gate-runtime-contract"
      )).toBe(true);
    });
  });
});

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { ok, type Result } from "../domain/result.js";
import { domainErr } from "../domain/index.js";
import { runChapters, type AuthoringRuntimeDeps, type RunChapterResult } from "../authoring-runtime/index.js";
import { savePackage, type AuthoringRuntimePackage, type QualityCheckKind } from "../runtime-package/index.js";
import { buildAuthoringPackage, designStrategy } from "./grow-agent.js";
import { reviseStrategyForIssues } from "./grow-revise.js";
import type { FengHost } from "./runtime-host.js";

export interface GrowLoopInput {
  readonly goal: string;
  readonly name?: string;
  readonly maxRounds?: number;
  readonly sampleChapters?: number;
}

export interface GrowRoundReport {
  readonly round: number;
  readonly version: string;
  readonly chapters: number;
  readonly failChapters: number;
  readonly capabilityIssueKinds: readonly QualityCheckKind[];
  readonly addedConstraints: readonly string[];
}

export interface GrowLoopResult {
  readonly packagePath: string;
  readonly growUnitId: string;
  readonly rounds: readonly GrowRoundReport[];
  readonly improved: boolean;
  readonly finalCapabilityIssues: number;
  readonly readiness: string;
  readonly lifecycle: string;
}

// A small but real sample work project the agent writes against during grow, so
// readiness is judged from actual sample runs + evals, not a model self-claim.
const SAMPLE_PROJECT = {
  premise: "少年林越在城郊旧厂房捡到一枚会发光的徽章，从此卷入异能者的隐秘世界。",
  title: "grow-sample",
  establishedYear: 2025,
  establishedCharacters: ["林越"],
  worldBible: "现代都市，2025年，存在隐秘的异能者组织。",
  characterBible: "林越：高中生，谨慎好奇，捡到发光徽章。"
};

function descriptors(reason: string) {
  const at = new Date().toISOString();
  return {
    source: { kind: "system" as const, origin: "feng-grow-loop", userProvided: false, receivedAt: at, privacyLevel: "workspace_private" as const },
    version: { schemaVersion: "1.0.0", producerVersion: "feng-grow-loop" },
    audit: { createdAt: at, createdBy: "feng-grow-loop", reason }
  };
}

async function runSample(
  host: FengHost,
  pkg: AuthoringRuntimePackage,
  round: number,
  sampleChapters: number
): Promise<Result<readonly RunChapterResult[]>> {
  const relDir = `.feng/grow-samples/round-${round}`;
  const absDir = path.join(host.config.workspaceRoot, relDir);
  await mkdir(path.join(absDir, ".feng", "runtime"), { recursive: true });
  const opened = await host.store.openWorkspace({ root: absDir });
  if (!opened.ok) return opened;
  const seeded = await host.store.writeTextAtomic(opened.value, ".feng/runtime/project.json", JSON.stringify(SAMPLE_PROJECT, null, 2), { reason: "seed grow sample project", createParents: true });
  if (!seeded.ok) return seeded;
  const deps: AuthoringRuntimeDeps = {
    store: host.store,
    workspace: opened.value,
    llmGateway: host.llmGateway,
    policy: host.policy,
    provider: host.config.provider.provider,
    model: host.config.provider.model
  };
  return runChapters(deps, pkg, sampleChapters);
}

function capabilityKinds(results: readonly RunChapterResult[]): readonly QualityCheckKind[] {
  const kinds = new Set<QualityCheckKind>();
  for (const chapter of results) {
    for (const candidate of chapter.feedback.candidates) {
      if (candidate.layer === "capability") kinds.add(candidate.issueKind as QualityCheckKind);
    }
  }
  return [...kinds];
}

function failCount(results: readonly RunChapterResult[]): number {
  return results.filter((c) => c.quality.status === "fail").length;
}

export async function growXiaoshuoAgentLoop(host: FengHost, input: GrowLoopInput): Promise<Result<GrowLoopResult>> {
  const meta = descriptors("grow xiaoshuo agent (multi-round)");
  const name = input.name ?? "xiaoshuo";
  const maxRounds = Math.max(1, input.maxRounds ?? 2);
  const sampleChapters = Math.max(1, input.sampleChapters ?? 2);

  const grow = await host.grow.createGrowUnit({
    title: name,
    goalBoundarySummary: input.goal,
    targetBehaviorSummary: "接收作品设定/前情/反馈，输出连贯章节与大纲，并形成反馈候选。",
    source: meta.source, version: meta.version, audit: meta.audit
  });
  if (!grow.ok) return grow;
  const agenda = await host.agenda.createAgenda(grow.value, { goalBoundarySummary: input.goal, currentFocus: "通过样例运行与反馈迭代写作策略", source: meta.source, version: meta.version, audit: meta.audit });
  if (!agenda.ok) return agenda;
  const dod = await host.agenda.defineDoD(grow.value, {
    statement: "写作 agent 在样例运行中无 capability 级质量问题，并能连贯逐章产出。",
    scope: "xiaoshuo runtime hatch gate",
    evidenceRequirement: "样例运行 + 结构化质量评估 + capability 反馈解决",
    validationIntent: "sample run + structural quality checks across rounds",
    source: meta.source, version: meta.version, audit: meta.audit
  });
  if (!dod.ok) return dod;

  const designed = await designStrategy(host);
  if (!designed.ok) return designed;
  for (const to of ["planning", "growing"] as const) {
    const moved = await host.grow.transitionGrowUnit(grow.value, { to, reason: `advance to ${to}`, source: meta.source, audit: meta.audit });
    if (!moved.ok) return moved;
  }

  let strategy = designed.value.designed.strategy;
  const rounds: GrowRoundReport[] = [];
  let lastResults: readonly RunChapterResult[] = [];
  for (let round = 1; round <= maxRounds; round += 1) {
    const version = `0.${round}.0`;
    const pkg = buildAuthoringPackage({
      name, version, locked: false, strategy,
      ...(designed.value.designed.minChars === undefined ? {} : { minChars: designed.value.designed.minChars }),
      ...(designed.value.designed.maxChars === undefined ? {} : { maxChars: designed.value.designed.maxChars }),
      grownInProject: host.config.workspaceRoot, grownByGrowUnitId: grow.value.id,
      readiness: "draft", evidenceSummary: `grow round ${round} sample package`,
      model: host.config.provider.model, provider: host.config.provider.provider
    });
    const sample = await runSample(host, pkg, round, sampleChapters);
    if (!sample.ok) return sample;
    lastResults = sample.value;
    const capKinds = capabilityKinds(sample.value);
    const revision = reviseStrategyForIssues(strategy, capKinds);
    rounds.push({ round, version, chapters: sample.value.length, failChapters: failCount(sample.value), capabilityIssueKinds: capKinds, addedConstraints: revision.added });
    await host.store.writeTextAtomic(host.workspace, `.feng/grow-samples/round-${round}/round-report.json`, JSON.stringify(rounds[rounds.length - 1], null, 2), { reason: "write grow round report", createParents: true });
    if (capKinds.length === 0) break;
    strategy = revision.strategy;
  }

  const firstCap = rounds[0]?.capabilityIssueKinds.length ?? 0;
  const finalCap = rounds[rounds.length - 1]?.capabilityIssueKinds.length ?? 0;
  const improved = firstCap === 0 ? true : finalCap < firstCap;

  const evidence = await host.evidence.recordEvidenceCandidate({
    growUnitRef: grow.value,
    sourceKind: "validation_report",
    summary: `grow sample-run evidence over ${rounds.length} round(s): capability issues ${firstCap} -> ${finalCap}`,
    content: JSON.stringify({ rounds, improved }, null, 2),
    artifactKind: "validation_report",
    relationHints: [{ relation: "supports", relatedDoDRef: dod.value, criticality: "critical", reason: "sample run evals demonstrate readiness" }],
    quality: { trustLevel: improved && finalCap === 0 ? "strong" : "weak" },
    source: meta.source, version: meta.version, audit: meta.audit
  });
  if (!evidence.ok) return evidence;
  const accepted = await host.evidence.acceptEvidenceForEvaluation(evidence.value, { reason: "accept sample-run evidence", source: meta.source, audit: meta.audit });
  if (!accepted.ok) return accepted;
  const moved = await host.grow.transitionGrowUnit(grow.value, { to: "verifying", reason: "sample runs complete", source: meta.source, audit: meta.audit });
  if (!moved.ok) return moved;
  const assessment = await host.evidence.assessReadiness(grow.value, { evidenceRefs: [evidence.value], source: meta.source, audit: meta.audit });
  if (!assessment.ok) return assessment;
  const verdict = await host.evidence.produceReadinessVerdict(assessment.value.readinessAssessmentRef);
  if (!verdict.ok) return verdict;
  const ready = verdict.value.verdict === "ready_to_hatch" && finalCap === 0;
  if (ready) {
    await host.grow.applyReadinessVerdict(grow.value, {
      readinessVerdictRef: verdict.value.artifactRef,
      verdict: { verdict: verdict.value.verdict, reason: verdict.value.reason, evidenceRefs: verdict.value.evidenceArtifactRefs },
      reason: "apply readiness from sample runs", source: meta.source, audit: meta.audit
    });
  }
  const finalRecord = await host.grow.getGrowUnit(grow.value);
  const lifecycle = finalRecord.ok ? finalRecord.value.lifecycle : "unknown";

  const finalPkg = buildAuthoringPackage({
    name, version: "1.0.0", locked: ready, strategy,
    ...(designed.value.designed.minChars === undefined ? {} : { minChars: designed.value.designed.minChars }),
    ...(designed.value.designed.maxChars === undefined ? {} : { maxChars: designed.value.designed.maxChars }),
    grownInProject: host.config.workspaceRoot, grownByGrowUnitId: grow.value.id,
    readiness: ready ? "ready" : "draft",
    evidenceSummary: `rounds=${rounds.length}; capability ${firstCap}->${finalCap}; verdict=${verdict.value.verdict}`,
    model: host.config.provider.model, provider: host.config.provider.provider
  });
  if (finalPkg.writingStrategy.systemPrompt.length === 0) {
    return domainErr({ module: "feng-grow-loop", code: "invalid_state", message: "grown strategy is empty", severity: "error" });
  }
  const saved = await savePackage(host.store, host.workspace, finalPkg);
  if (!saved.ok) return saved;

  return ok({ packagePath: saved.value, growUnitId: grow.value.id, rounds, improved, finalCapabilityIssues: finalCap, readiness: verdict.value.verdict, lifecycle });
}

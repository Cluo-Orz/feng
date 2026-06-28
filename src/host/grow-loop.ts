import { mkdir } from "node:fs/promises";
import path from "node:path";
import { ok, type Result } from "../domain/result.js";
import { domainErr } from "../domain/index.js";
import type { MessageListRef } from "../domain/index.js";
import {
  runChapters,
  formatQualityGateSummary,
  synthesizeXiaoshuoQualityGates,
  WORK_CHAPTER_GOAL_COVERAGE_EVAL_FILE,
  WORK_CHAPTER_QUALITY_GATE_FILE,
  XIAOSHUO_QUALITY_GATE_PATH,
  type AuthoringRuntimeDeps,
  type CapabilityFeedbackCoverageInput,
  type RunChapterResult
} from "../authoring-runtime/index.js";
import { qualityCheckKinds, savePackage, type AuthoringRuntimePackage, type QualityCheckKind, type WritingStrategy } from "../runtime-package/index.js";
import { combineLLMUsageSummaries, type LLMUsageSummary } from "../llm-gateway/index.js";
import { buildAuthoringPackage, designStrategy, type DesignedStrategy } from "./grow-agent.js";
import { constraintFor, reviseStrategyForFeedbackDetails, reviseStrategyForIssues, reviseStrategyForSampleGoalCoverage } from "./grow-revise.js";
import { CAPABILITY_DIGEST_PATH, feedbackDigestDetailKey, readSystemFeedbackResolution, systemFeedbackDecisionClearsHatch, SYSTEM_DIGEST_PATH } from "./feedback-router.js";
import type { SystemFeedbackResolution } from "./feedback-router.js";
import type { FengHost } from "./runtime-host.js";

export interface GrowLoopInput {
  readonly goal: string;
  readonly name?: string;
  readonly maxRounds?: number;
  readonly sampleChapters?: number;
}

export interface GrowRoundReport {
  readonly round: number;
  readonly sampleDir: string;
  readonly version: string;
  readonly chapters: number;
  readonly failChapters: number;
  readonly qualityGateBlockingCount: number;
  readonly goalCoverageIssueCount: number;
  readonly capabilityIssueKinds: readonly QualityCheckKind[];
  readonly addedConstraints: readonly string[];
  readonly llmUsage: LLMUsageSummary;
}

export interface GrowLoopResult {
  readonly packagePath: string;
  readonly growUnitId: string;
  readonly contextMessageListRef?: MessageListRef;
  readonly designMessageListPath: string;
  readonly designTracePath: string;
  readonly qualityGatePath: string;
  readonly qualityGateSummary: string;
  readonly seededFeedbackPath?: string;
  readonly capabilityAdoptionPath?: string;
  readonly rounds: readonly GrowRoundReport[];
  readonly improved: boolean;
  readonly finalCapabilityIssues: number;
  readonly llmUsage: LLMUsageSummary;
  readonly readiness: string;
  readonly lifecycle: string;
  readonly seededConstraints: readonly string[];
}

interface CapabilityFeedbackSeedDetail {
  readonly issueKind: string;
  readonly chapter?: number;
  readonly detail?: string;
  readonly source?: string;
  readonly gateId?: string;
  readonly qualityGateStatus?: string;
  readonly artifactPath?: string;
  readonly feedbackKey?: string;
}

type SystemFeedbackSeedDetail = CapabilityFeedbackSeedDetail & { readonly issueKind: QualityCheckKind; readonly detail: string };

type FeedbackSeedLayer = "capability" | "system";

interface FeedbackSeedDigest {
  readonly layer: FeedbackSeedLayer;
  readonly sourcePath: string;
  readonly issueKinds: readonly QualityCheckKind[];
  readonly count: number;
  readonly updatedAt?: string;
  readonly details: readonly CapabilityFeedbackSeedDetail[];
}

const SEEDED_FEEDBACK_PATH = ".feng/grow-samples/seeded-feedback.json";
const CAPABILITY_ADOPTION_PATH = ".feng/grow-inbox/capability-feedback-adoption.json";
const LATEST_CHECKPOINT_PATH = ".feng/grow-samples/latest-checkpoint.json";

type CapabilityFeedbackAdoptionStatus = "adopted" | "unresolved" | "cleared";

interface CapabilityFeedbackAdoptionDecision {
  readonly feedbackKey: string;
  readonly issueKind: QualityCheckKind;
  readonly status: CapabilityFeedbackAdoptionStatus;
  readonly growUnitId: string;
  readonly packagePath?: string;
  readonly chapter?: number;
  readonly detail?: string;
  readonly source?: string;
  readonly gateId?: string;
  readonly artifactPath?: string;
  readonly mappedConstraint?: string;
  readonly reason: string;
  readonly decidedAt: string;
  readonly clearedAt?: string;
}

interface CapabilityFeedbackAdoption {
  readonly schemaVersion: "1.0.0";
  readonly kind: "capability_feedback_adoption";
  readonly sourcePath: string;
  readonly decisions: readonly CapabilityFeedbackAdoptionDecision[];
  readonly updatedAt: string;
}

function isQualityCheckKind(value: string): value is QualityCheckKind {
  return (qualityCheckKinds as readonly string[]).includes(value);
}

// Reads file-native feedback digests that route-feedback writes into this
// workspace from downstream work projects. Capability seeds may revise the
// grown package. System seeds remain blocking hatch evidence until feng resolves
// them at the system layer.
async function readSeedDigest(host: FengHost, sourcePath: string, layer: FeedbackSeedLayer): Promise<FeedbackSeedDigest | undefined> {
  const read = await host.store.readText(host.workspace, sourcePath, { reason: `grow: read ${layer} digest`, maxBytes: 256 * 1024 });
  if (!read.ok) return undefined;
  try {
    const parsed = JSON.parse(read.value.content) as {
      readonly issueKinds?: readonly string[];
      readonly count?: number;
      readonly updatedAt?: string;
      readonly details?: readonly CapabilityFeedbackSeedDetail[];
    };
    const issueKinds = [...new Set((parsed.issueKinds ?? []).filter(isQualityCheckKind))];
    return {
      layer,
      sourcePath,
      issueKinds,
      count: parsed.count ?? issueKinds.length,
      ...(parsed.updatedAt === undefined ? {} : { updatedAt: parsed.updatedAt }),
      details: parsed.details ?? []
    };
  } catch {
    return undefined;
  }
}

async function readSeedDigests(host: FengHost): Promise<readonly FeedbackSeedDigest[]> {
  const capability = await readSeedDigest(host, CAPABILITY_DIGEST_PATH, "capability");
  const system = await readSeedDigest(host, SYSTEM_DIGEST_PATH, "system");
  return [capability, system].filter((item): item is FeedbackSeedDigest => item !== undefined);
}

async function readCapabilityAdoption(host: FengHost): Promise<Result<CapabilityFeedbackAdoption | undefined>> {
  const read = await host.store.readText(host.workspace, CAPABILITY_ADOPTION_PATH, { reason: "grow: read capability feedback adoption", maxBytes: 256 * 1024 });
  if (!read.ok) return read.error.code === "not_found" ? ok(undefined) : read;
  try {
    return ok(JSON.parse(read.value.content) as CapabilityFeedbackAdoption);
  } catch (cause) {
    return domainErr({ module: "feng-grow-loop", code: "schema_incompatible", message: "capability feedback adoption is invalid JSON", severity: "error", cause });
  }
}

function feedbackKey(detail: Pick<CapabilityFeedbackSeedDetail, "issueKind" | "chapter" | "detail" | "gateId" | "artifactPath" | "feedbackKey">): string {
  if (detail.feedbackKey !== undefined && detail.feedbackKey.trim().length > 0) return detail.feedbackKey;
  return feedbackDigestDetailKey({
    issueKind: detail.issueKind,
    detail: detail.detail ?? "",
    ...(detail.chapter === undefined ? {} : { chapter: detail.chapter }),
    ...(detail.gateId === undefined ? {} : { gateId: detail.gateId }),
    ...(detail.artifactPath === undefined ? {} : { artifactPath: detail.artifactPath })
  });
}

function capabilitySeedDetails(seed: FeedbackSeedDigest | undefined): readonly (CapabilityFeedbackSeedDetail & { readonly issueKind: QualityCheckKind })[] {
  if (seed === undefined) return [];
  const details = seed.details.filter((detail): detail is CapabilityFeedbackSeedDetail & { readonly issueKind: QualityCheckKind } => isQualityCheckKind(detail.issueKind));
  const detailKinds = new Set(details.map((detail) => detail.issueKind));
  const syntheticDetails = seed.issueKinds
    .filter((kind) => !detailKinds.has(kind))
    .map((kind): CapabilityFeedbackSeedDetail & { readonly issueKind: QualityCheckKind } => ({ issueKind: kind, source: "capability_digest" }));
  return [...details, ...syntheticDetails];
}

function systemSeedDetails(seed: FeedbackSeedDigest | undefined): readonly SystemFeedbackSeedDetail[] {
  if (seed === undefined) return [];
  const details = seed.details
    .filter((detail): detail is CapabilityFeedbackSeedDetail & { readonly issueKind: QualityCheckKind } => isQualityCheckKind(detail.issueKind))
    .map((detail): SystemFeedbackSeedDetail => ({
      ...detail,
      issueKind: detail.issueKind,
      detail: detail.detail ?? `system feedback:${detail.issueKind}`
    }));
  const detailKinds = new Set(details.map((detail) => detail.issueKind));
  const syntheticDetails = seed.issueKinds
    .filter((kind) => !detailKinds.has(kind))
    .map((kind): SystemFeedbackSeedDetail => ({
      issueKind: kind,
      detail: `system feedback kind from digest:${kind}`,
      source: "system_digest"
    }));
  return [...details, ...syntheticDetails];
}

function adoptionMemoryDetails(adoption: CapabilityFeedbackAdoption | undefined): readonly (CapabilityFeedbackSeedDetail & { readonly issueKind: QualityCheckKind })[] {
  if (adoption === undefined) return [];
  return adoption.decisions
    .map((decision): CapabilityFeedbackSeedDetail & { readonly issueKind: QualityCheckKind } => ({
      issueKind: decision.issueKind,
      feedbackKey: decision.feedbackKey,
      ...(decision.chapter === undefined ? {} : { chapter: decision.chapter }),
      ...(decision.detail === undefined ? {} : { detail: decision.detail }),
      source: `capability_feedback_adoption:${decision.status}`,
      ...(decision.gateId === undefined ? {} : { gateId: decision.gateId }),
      ...(decision.artifactPath === undefined ? {} : { artifactPath: decision.artifactPath })
    }));
}

function activeCapabilityAdoption(
  adoption: CapabilityFeedbackAdoption | undefined,
  activeSeed: FeedbackSeedDigest | undefined
): CapabilityFeedbackAdoption | undefined {
  if (adoption === undefined) return adoption;
  const index = capabilitySeedIndex(activeSeed);
  const decisions = adoption.decisions.filter((decision) => adoptionDecisionIsActive(decision, index));
  return { ...adoption, decisions };
}

interface CapabilitySeedIndex {
  readonly provided: boolean;
  readonly activeKeys: ReadonlySet<string>;
  readonly activeKinds: ReadonlySet<QualityCheckKind>;
  readonly hasPreciseDetails: boolean;
}

function capabilitySeedIndex(seed: FeedbackSeedDigest | undefined): CapabilitySeedIndex {
  if (seed === undefined) {
    return { provided: false, activeKeys: new Set(), activeKinds: new Set(), hasPreciseDetails: false };
  }
  return {
    provided: true,
    activeKeys: new Set(capabilitySeedDetails(seed).map((detail) => feedbackKey(detail))),
    activeKinds: new Set(seed.issueKinds),
    hasPreciseDetails: seed.details.length > 0
  };
}

function adoptionDecisionIsActive(decision: CapabilityFeedbackAdoptionDecision, index: CapabilitySeedIndex): boolean {
  if (decision.status === "cleared") return false;
  if (decision.status === "adopted") return true;
  if (!index.provided) return true;
  return index.activeKeys.has(decision.feedbackKey) ||
    (!index.hasPreciseDetails && index.activeKinds.has(decision.issueKind));
}

function clearStaleDecision(decision: CapabilityFeedbackAdoptionDecision, now: string): CapabilityFeedbackAdoptionDecision {
  if (decision.status !== "unresolved") return decision;
  return {
    ...decision,
    status: "cleared",
    reason: "feedback no longer appears in the active capability digest and no longer blocks hatch",
    clearedAt: now
  };
}

function uniqueKinds(values: readonly QualityCheckKind[]): readonly QualityCheckKind[] {
  return [...new Set(values)];
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function systemFeedbackRef(detail: SystemFeedbackSeedDetail): string {
  return detail.artifactPath ?? detail.gateId ?? feedbackDigestDetailKey(detail);
}

function detailSummary(detail: CapabilityFeedbackSeedDetail): string {
  return [
    detail.issueKind,
    detail.feedbackKey === undefined ? "" : `key=${detail.feedbackKey}`,
    detail.chapter === undefined ? "" : `ch${detail.chapter}`,
    detail.detail === undefined ? "" : detail.detail,
    detail.source === undefined ? "" : `source=${detail.source}`,
    detail.gateId === undefined ? "" : `gate=${detail.gateId}`,
    detail.artifactPath === undefined ? "" : `artifact=${detail.artifactPath}`
  ].filter((part) => part.length > 0).join(" | ");
}

function buildDesignFeedbackContext(input: {
  readonly seedDigests: readonly FeedbackSeedDigest[];
  readonly adoption: CapabilityFeedbackAdoption | undefined;
  readonly systemResolution: SystemFeedbackResolution | undefined;
}): string | undefined {
  const lines: string[] = [];
  for (const seed of input.seedDigests) {
    lines.push(`## ${seed.layer} feedback digest (${seed.sourcePath})`);
    lines.push(`issueKinds=${seed.issueKinds.join(",") || "none"} count=${seed.count}`);
    const details = seed.details.length === 0
      ? seed.issueKinds.map((kind): CapabilityFeedbackSeedDetail => ({ issueKind: kind, source: `${seed.layer}_digest` }))
      : seed.details;
    for (const detail of details.slice(0, 30)) lines.push(`- ${detailSummary(detail)}`);
    if (details.length > 30) lines.push(`- ... ${details.length - 30} more detail(s) omitted from design prompt`);
  }
  const adoptionDecisions = input.adoption?.decisions ?? [];
  if (adoptionDecisions.length > 0) {
    lines.push("## capability feedback adoption memory");
    for (const decision of adoptionDecisions.slice(0, 30)) {
      lines.push(`- ${decision.status} | ${decision.issueKind} | ${decision.detail ?? decision.feedbackKey}${decision.mappedConstraint === undefined ? "" : ` | mapped=${decision.mappedConstraint}`}`);
    }
    if (adoptionDecisions.length > 30) lines.push(`- ... ${adoptionDecisions.length - 30} more adoption decision(s) omitted from design prompt`);
  }
  const systemDecisions = input.systemResolution?.decisions ?? [];
  if (systemDecisions.length > 0) {
    lines.push("## system feedback resolution memory");
    for (const decision of systemDecisions.slice(0, 30)) {
      lines.push(`- ${decision.decision} | ${decision.issueKind} | keys=${decision.feedbackKeys?.length ?? 0} | evidence=${decision.evidenceRefs?.length ?? 0} | ${decision.reason}`);
    }
    if (systemDecisions.length > 30) lines.push(`- ... ${systemDecisions.length - 30} more system resolution decision(s) omitted from design prompt`);
  }
  if (lines.length === 0) return undefined;
  return [
    "这些是本轮 grow 之前已经进入文件系统的下游回流、历史采纳和系统反馈状态。",
    "它们必须作为 agent 设计输入进入本轮 LLM loop；不能只在设计后机械补丁。",
    ...lines
  ].join("\n");
}

function buildCapabilityFeedbackCoverage(
  seed: FeedbackSeedDigest | undefined,
  adoption: CapabilityFeedbackAdoption | undefined,
  strategy: AuthoringRuntimePackage["writingStrategy"]
): readonly CapabilityFeedbackCoverageInput[] {
  const byKey = new Map<string, CapabilityFeedbackSeedDetail & { readonly issueKind: QualityCheckKind }>();
  for (const detail of [...capabilitySeedDetails(seed), ...adoptionMemoryDetails(adoption)]) byKey.set(feedbackKey(detail), detail);
  return [...byKey.values()].map((detail) => {
    const expectedConstraint = constraintFor(detail.issueKind);
    const mappedConstraint = expectedConstraint !== undefined && strategy.constraints.includes(expectedConstraint)
      ? expectedConstraint
      : undefined;
    return {
      issueKind: detail.issueKind,
      feedbackKey: feedbackKey(detail),
      ...(detail.chapter === undefined ? {} : { chapter: detail.chapter }),
      ...(detail.detail === undefined ? {} : { detail: detail.detail }),
      ...(detail.source === undefined ? {} : { source: detail.source }),
      ...(detail.gateId === undefined ? {} : { gateId: detail.gateId }),
      ...(detail.artifactPath === undefined ? {} : { artifactPath: detail.artifactPath }),
      ...(mappedConstraint === undefined ? {} : { mappedConstraint })
    };
  });
}

function buildCapabilityAdoption(
  input: {
    readonly prior: CapabilityFeedbackAdoption | undefined;
    readonly activeSeed: FeedbackSeedDigest | undefined;
    readonly coverage: readonly CapabilityFeedbackCoverageInput[];
    readonly growUnitId: string;
    readonly packagePath?: string;
  }
): CapabilityFeedbackAdoption | undefined {
  if (input.coverage.length === 0 && input.prior === undefined) return undefined;
  const now = new Date().toISOString();
  const currentKeys = new Set(input.coverage.map((item) => feedbackKey(item)));
  const activeIndex = capabilitySeedIndex(input.activeSeed);
  const retained = (input.prior?.decisions ?? [])
    .filter((decision) => !currentKeys.has(decision.feedbackKey))
    .map((decision) => adoptionDecisionIsActive(decision, activeIndex) ? decision : clearStaleDecision(decision, now));
  const decisions = input.coverage.map((item): CapabilityFeedbackAdoptionDecision => {
    const status: CapabilityFeedbackAdoptionStatus = item.mappedConstraint === undefined ? "unresolved" : "adopted";
    return {
      feedbackKey: feedbackKey(item),
      issueKind: item.issueKind,
      status,
      growUnitId: input.growUnitId,
      ...(input.packagePath === undefined ? {} : { packagePath: input.packagePath }),
      ...(item.chapter === undefined ? {} : { chapter: item.chapter }),
      ...(item.detail === undefined ? {} : { detail: item.detail }),
      ...(item.source === undefined ? {} : { source: item.source }),
      ...(item.gateId === undefined ? {} : { gateId: item.gateId }),
      ...(item.artifactPath === undefined ? {} : { artifactPath: item.artifactPath }),
      ...(item.mappedConstraint === undefined ? {} : { mappedConstraint: item.mappedConstraint }),
      reason: status === "adopted"
        ? "feedback is mapped into the final grown strategy constraint"
        : "feedback is not mapped into the final grown strategy and remains a hatch blocker",
      decidedAt: now
    };
  });
  return {
    schemaVersion: "1.0.0",
    kind: "capability_feedback_adoption",
    sourcePath: CAPABILITY_DIGEST_PATH,
    decisions: [...retained, ...decisions],
    updatedAt: now
  };
}

async function writeCapabilityAdoption(
  host: FengHost,
  adoption: CapabilityFeedbackAdoption | undefined
): Promise<Result<string | undefined>> {
  if (adoption === undefined) return ok(undefined);
  const wrote = await host.store.writeTextAtomic(host.workspace, CAPABILITY_ADOPTION_PATH, JSON.stringify(adoption, null, 2), {
    reason: "write capability feedback adoption",
    createParents: true
  });
  return wrote.ok ? ok(CAPABILITY_ADOPTION_PATH) : wrote;
}

// A small but real sample work project the agent writes against during grow, so
// readiness is judged from actual sample runs + evals, not a model self-claim.
const SAMPLE_PROJECT = {
  premise: "少年林越在城郊旧厂房捡到一枚会发光的徽章，从此卷入异能者的隐秘世界。旧厂房原属成光电子，三年前一场事故让林越的父亲离开家庭，只留下一本写有 S.S.C. 缩写的旧工作证。",
  title: "grow-sample",
  establishedYear: 2025,
  establishedCharacters: ["林越"],
  worldBible: "现代都市，2025年，存在隐秘的异能者组织。S.S.C. 是一家以公益科技基金会为表层身份的组织，曾在成光电子旧厂做过材料实验。徽章会在靠近相关实验痕迹时发冷发光，但不会直接告诉持有人答案。",
  characterBible: "林越：高中生，谨慎好奇，父亲三年前因成光电子事故离家后再无音讯。林越平时回避旧厂房，但对父亲留下的旧工作证和 S.S.C. 缩写一直有疑问；遇到异常时会先害怕，再强迫自己寻找证据。",
  chapterGoals: [
    "写出林越因父亲旧工作证线索走进旧厂房，捡到发光徽章，并决定追查徽章与 S.S.C. 的关系。",
    "承接上一章徽章线索，写出林越通过旧厂残留资料和网络碎片逐步发现 S.S.C. 的蛛丝马迹，不要让关键答案过于直接出现。",
    "写出林越第一次主动测试徽章能力，并留下下一章的行动钩子。"
  ]
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
  growUnitId: string,
  round: number,
  sampleChapters: number
): Promise<Result<readonly RunChapterResult[]>> {
  const relDir = `.feng/grow-samples/${growUnitId}/round-${round}`;
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
    model: host.config.provider.model,
    semanticEval: true
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

function gateBlockingCount(results: readonly RunChapterResult[]): number {
  return results.reduce((sum, chapter) => sum + chapter.qualityGateBlockingCount, 0);
}

function goalCoverageIssueCount(results: readonly RunChapterResult[]): number {
  return results.filter((chapter) =>
    chapter.goalCoverage !== undefined &&
    (chapter.goalCoverage.covered !== true || chapter.goalCoverage.confidence < 0.7 || chapter.goalCoverage.evidence.length === 0)
  ).length;
}

function outputBudgetLimited(results: readonly RunChapterResult[]): boolean {
  return results.some((chapter) =>
    chapter.feedback.candidates.some((candidate) =>
      candidate.layer === "system" &&
      candidate.issueKind === "runtime_capability" &&
      candidate.detail.includes("finishReason=length")
    )
  );
}

function sampleChapterDir(sampleDir: string, chapterNumber: number): string {
  return `${sampleDir}/.feng/runtime/chapters/chapter-${String(chapterNumber).padStart(2, "0")}`;
}

function sampleEvidenceRefs(rounds: readonly GrowRoundReport[]): readonly string[] {
  return rounds.flatMap((round) => [
    `${round.sampleDir}/round-report.json`,
    ...Array.from({ length: round.chapters }, (_, index) => {
      const chapterNumber = index + 1;
      const dir = sampleChapterDir(round.sampleDir, chapterNumber);
      return [
        `${dir}/${WORK_CHAPTER_QUALITY_GATE_FILE}`,
        ...(chapterNumber <= SAMPLE_PROJECT.chapterGoals.length ? [`${dir}/${WORK_CHAPTER_GOAL_COVERAGE_EVAL_FILE}`] : [])
      ];
    }).flat()
  ]);
}

function withStrategy(design: DesignedStrategy, strategy: WritingStrategy): DesignedStrategy {
  return { ...design, strategy };
}

function mergeRedesignedStrategy(
  design: DesignedStrategy,
  revisedStrategy: WritingStrategy
): DesignedStrategy {
  return {
    ...design,
    strategy: {
      ...design.strategy,
      constraints: uniqueStrings([...design.strategy.constraints, ...revisedStrategy.constraints])
    }
  };
}

function needsSampleRedesign(round: number, maxRounds: number, capKinds: readonly QualityCheckKind[]): boolean {
  if (round >= maxRounds) return false;
  return capKinds.some((kind) => kind === "semantic_style" || kind === "semantic_character" || kind === "semantic_plot");
}

function buildSampleRedesignContext(input: {
  readonly round: number;
  readonly report: GrowRoundReport;
  readonly results: readonly RunChapterResult[];
  readonly addedConstraints: readonly string[];
}): string {
  const lines: string[] = [
    `## grow sample round ${input.round} evidence`,
    `capabilityIssues=${input.report.capabilityIssueKinds.join(",") || "none"}`,
    `qualityGateBlockingCount=${input.report.qualityGateBlockingCount}`,
    `goalCoverageIssueCount=${input.report.goalCoverageIssueCount}`,
    `addedConstraints=${input.addedConstraints.length}`,
    "这些样例反馈用于重新设计目标 agent 的通用写作策略、上下文策略、质量门禁或反馈归因；不要把样例作品事实写成通用 agent 记忆。"
  ];
  for (const chapter of input.results) {
    lines.push(`### sample chapter ${chapter.chapterNumber}`);
    if (chapter.semantic !== undefined) {
      lines.push(`semantic overall=${chapter.semantic.overall} style=${chapter.semantic.scores.style} character=${chapter.semantic.scores.character} plot=${chapter.semantic.scores.plot}`);
      for (const problem of chapter.semantic.problems.slice(0, 8)) {
        lines.push(`- semantic_${problem.dimension}: ${problem.evidence} -> ${problem.suggestion}`);
      }
    }
    for (const candidate of chapter.feedback.candidates.filter((item) => item.layer === "capability").slice(0, 12)) {
      lines.push(`- routed:${candidate.issueKind} ${candidate.detail}`);
    }
  }
  if (input.addedConstraints.length > 0) {
    lines.push("## deterministic constraints already derived from this sample");
    for (const constraint of input.addedConstraints) lines.push(`- ${constraint}`);
  }
  return lines.join("\n");
}

async function writeRoundCheckpoint(
  host: FengHost,
  input: {
    readonly goal: string;
    readonly name: string;
    readonly growUnitId: string;
    readonly currentDesign: DesignedStrategy;
    readonly effectiveMax?: number;
    readonly latestDesignTracePath: string;
    readonly rounds: readonly GrowRoundReport[];
    readonly capabilityFeedbackCoverage: readonly CapabilityFeedbackCoverageInput[];
    readonly unresolvedSystemIssueKinds: readonly QualityCheckKind[];
    readonly unresolvedSystemFeedbackRefs: readonly string[];
    readonly model: string;
    readonly provider: string;
    readonly llmUsage: LLMUsageSummary;
  }
): Promise<Result<void>> {
  const latest = input.rounds[input.rounds.length - 1];
  if (latest === undefined) return ok(undefined);
  const pkg = buildAuthoringPackage({
    name: input.name,
    version: "1.0.0",
    locked: false,
    strategy: input.currentDesign.strategy,
    targetWorld: input.currentDesign.targetWorld,
    contextPolicy: input.currentDesign.contextPolicy,
    storyModel: input.currentDesign.storyModel,
    harness: input.currentDesign.harness,
    coveragePolicy: input.currentDesign.coveragePolicy,
    qualityRules: input.currentDesign.qualityRules,
    feedbackRouting: input.currentDesign.feedbackRouting,
    ...(input.currentDesign.minChars === undefined ? {} : { minChars: input.currentDesign.minChars }),
    ...(input.effectiveMax === undefined ? {} : { maxChars: input.effectiveMax }),
    grownInProject: host.config.workspaceRoot,
    grownByGrowUnitId: input.growUnitId,
    readiness: "draft",
    evidenceSummary: `checkpoint after round ${latest.round}; capability=${latest.capabilityIssueKinds.length}; fail=${latest.failChapters}; sampleGateBlocking=${latest.qualityGateBlockingCount}`,
    sampleEvidenceRefs: sampleEvidenceRefs(input.rounds),
    model: input.model,
    provider: input.provider
  });
  const gateSet = synthesizeXiaoshuoQualityGates({
    goal: input.goal,
    pkg,
    designArtifacts: {
      designTracePath: input.latestDesignTracePath,
      coveragePolicyAuthoredByGrow: input.currentDesign.generatedFields.coveragePolicy
    },
    finalIssueKinds: latest.capabilityIssueKinds,
    capabilityFeedbackCoverage: input.capabilityFeedbackCoverage,
    unresolvedSystemIssueKinds: input.unresolvedSystemIssueKinds,
    systemFeedbackRefs: input.unresolvedSystemFeedbackRefs,
    finalFailChapters: latest.failChapters,
    sampleGateBlockingCount: latest.qualityGateBlockingCount,
    sampleRoundCount: input.rounds.length,
    readiness: "checkpoint_draft"
  });
  const gateSummary = formatQualityGateSummary(gateSet.summary);
  const checkpointPkg: AuthoringRuntimePackage = {
    ...pkg,
    validation: {
      ...pkg.validation,
      readiness: "draft",
      qualityGateRef: XIAOSHUO_QUALITY_GATE_PATH,
      targetCoverageRef: `${XIAOSHUO_QUALITY_GATE_PATH}#coverage`,
      qualityGateSummary: gateSummary,
      evidenceSummary: `${pkg.validation.evidenceSummary}; ${gateSummary}; checkpoint_draft`
    }
  };
  const gateWritten = await host.store.writeTextAtomic(host.workspace, XIAOSHUO_QUALITY_GATE_PATH, JSON.stringify(gateSet, null, 2), {
    reason: "write xiaoshuo checkpoint quality gates",
    createParents: true
  });
  if (!gateWritten.ok) return gateWritten;
  const saved = await savePackage(host.store, host.workspace, checkpointPkg);
  if (!saved.ok) return saved;
  const checkpoint = {
    schemaVersion: "1.0.0",
    kind: "grow_loop_checkpoint",
    status: "checkpoint_draft",
    growUnitId: input.growUnitId,
    packagePath: saved.value,
    qualityGatePath: XIAOSHUO_QUALITY_GATE_PATH,
    qualityGateSummary: gateSummary,
    latestRound: latest.round,
    rounds: input.rounds,
    llmUsage: input.llmUsage,
    note: "This checkpoint preserves the latest completed grow round. It is not a ready hatch result.",
    writtenAt: new Date().toISOString()
  };
  const wroteCheckpoint = await host.store.writeTextAtomic(host.workspace, LATEST_CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2), {
    reason: "write grow loop latest checkpoint",
    createParents: true
  });
  return wroteCheckpoint.ok ? ok(undefined) : wroteCheckpoint;
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

  const seedDigests = await readSeedDigests(host);
  const capabilitySeed = seedDigests.find((seed) => seed.layer === "capability");
  const systemSeed = seedDigests.find((seed) => seed.layer === "system");
  const systemResolution = await readSystemFeedbackResolution(host);
  if (!systemResolution.ok) return systemResolution;
  const capabilityAdoption = await readCapabilityAdoption(host);
  if (!capabilityAdoption.ok) return capabilityAdoption;
  const activeAdoption = activeCapabilityAdoption(capabilityAdoption.value, capabilitySeed);
  const designFeedbackContext = buildDesignFeedbackContext({
    seedDigests,
    adoption: activeAdoption,
    systemResolution: systemResolution.value
  });

  const intent = await host.agenda.buildAttemptIntent(grow.value, {
    purpose: "Design the initial xiaoshuo runtime package before sample-run grow rounds.",
    toolNeedSummary: "LLM design call followed by sample chapter runs.",
    policyBoundarySummary: "May call the configured LLM provider and write file-native grow design artifacts.",
    stopCondition: "A parseable runtime strategy with coveragePolicy is produced before sample rounds start.",
    source: meta.source,
    audit: meta.audit
  });
  if (!intent.ok) return intent;
  const designed = await designStrategy(host, {
    growUnitRef: grow.value,
    attemptIntentRef: intent.value,
    goal: input.goal,
    attemptLabel: "loop-design",
    ...(designFeedbackContext === undefined ? {} : { feedbackContext: designFeedbackContext })
  });
  if (!designed.ok) return designed;
  for (const to of ["planning", "growing"] as const) {
    const moved = await host.grow.transitionGrowUnit(grow.value, { to, reason: `advance to ${to}`, source: meta.source, audit: meta.audit });
    if (!moved.ok) return moved;
  }

  let currentDesign = designed.value.designed;
  let latestDesignMessageListPath = designed.value.messageListPath;
  let latestDesignTracePath = designed.value.tracePath;
  let latestContextMessageListRef = designed.value.contextMessageListRef;
  let strategy = currentDesign.strategy;
  let effectiveMax = currentDesign.maxChars;
  const systemDetails = systemSeedDetails(systemSeed);
  const systemResolutionDecisions = systemResolution.value?.decisions ?? [];
  const unresolvedSystemDetails = systemDetails.filter((detail) =>
    !systemResolutionDecisions.some((decision) => decision.issueKind === detail.issueKind && systemFeedbackDecisionClearsHatch(decision, detail))
  );
  const adoptedDecisions = (activeAdoption?.decisions ?? []).filter((decision) => decision.status === "adopted");
  const unresolvedCapabilityDecisions = (activeAdoption?.decisions ?? []).filter((decision) => decision.status === "unresolved");
  const adoptedKinds = uniqueKinds(adoptedDecisions.map((decision) => decision.issueKind));
  const unresolvedCapabilityKinds = uniqueKinds(unresolvedCapabilityDecisions.map((decision) => decision.issueKind));
  const memoryKinds = uniqueKinds([...adoptedKinds, ...unresolvedCapabilityKinds]);
  const seedKinds = uniqueKinds([...(capabilitySeed?.issueKinds ?? []), ...memoryKinds]);
  const unresolvedSystemIssueKinds = uniqueKinds(unresolvedSystemDetails.map((detail) => detail.issueKind));
  const unresolvedSystemFeedbackRefs = uniqueStrings(unresolvedSystemDetails.map(systemFeedbackRef));
  const seeding = reviseStrategyForIssues(strategy, seedKinds);
  strategy = seeding.strategy;
  currentDesign = withStrategy(currentDesign, strategy);
  const seededConstraints = seeding.added;
  let seededFeedbackPath: string | undefined;
  if (seedDigests.length > 0 || memoryKinds.length > 0) {
    const seededReport = {
      schemaVersion: "1.0.0",
      kind: "feedback_seed_set",
      seeds: seedDigests.map((seed) => ({
        layer: seed.layer,
        sourcePath: seed.sourcePath,
        issueKinds: seed.issueKinds,
        count: seed.count,
        ...(seed.updatedAt === undefined ? {} : { upstreamUpdatedAt: seed.updatedAt }),
        details: seed.details
      })),
      adoptionMemory: {
        sourcePath: CAPABILITY_ADOPTION_PATH,
        adoptedIssueKinds: adoptedKinds,
        unresolvedIssueKinds: unresolvedCapabilityKinds,
        adoptedCount: adoptedKinds.length,
        unresolvedCount: unresolvedCapabilityKinds.length,
        decisions: [...adoptedDecisions, ...unresolvedCapabilityDecisions]
      },
      seededConstraints,
      systemResolution: systemResolution.value ?? null,
      unresolvedSystemIssueKinds,
      unresolvedSystemFeedbackDetails: unresolvedSystemDetails,
      unresolvedSystemFeedbackRefs,
      seededAt: new Date().toISOString()
    };
    const wroteSeed = await host.store.writeTextAtomic(host.workspace, SEEDED_FEEDBACK_PATH, JSON.stringify(seededReport, null, 2), {
      reason: "write grow seeded feedback report",
      createParents: true
    });
    if (!wroteSeed.ok) return wroteSeed;
    seededFeedbackPath = SEEDED_FEEDBACK_PATH;
  }
  const rounds: GrowRoundReport[] = [];
  let lastResults: readonly RunChapterResult[] = [];
  const llmUsageSummaries: LLMUsageSummary[] = [designed.value.llmUsage];
  for (let round = 1; round <= maxRounds; round += 1) {
    const version = `0.${round}.0`;
    const pkg = buildAuthoringPackage({
      name, version, locked: false, strategy,
      targetWorld: currentDesign.targetWorld,
      contextPolicy: currentDesign.contextPolicy,
      storyModel: currentDesign.storyModel,
      harness: currentDesign.harness,
      coveragePolicy: currentDesign.coveragePolicy,
      qualityRules: currentDesign.qualityRules,
      feedbackRouting: currentDesign.feedbackRouting,
      ...(currentDesign.minChars === undefined ? {} : { minChars: currentDesign.minChars }),
      ...(effectiveMax === undefined ? {} : { maxChars: effectiveMax }),
      grownInProject: host.config.workspaceRoot, grownByGrowUnitId: grow.value.id,
      readiness: "draft", evidenceSummary: `grow round ${round} sample package`,
      model: host.config.provider.model, provider: host.config.provider.provider
    });
    const sample = await runSample(host, pkg, grow.value.id, round, sampleChapters);
    if (!sample.ok) return sample;
    lastResults = sample.value;
    const capKinds = capabilityKinds(sample.value);
    const blockingCount = gateBlockingCount(sample.value);
    const goalCoverageIssues = goalCoverageIssueCount(sample.value);
    const issueRevision = reviseStrategyForIssues(strategy, capKinds);
    const gateRevision = reviseStrategyForSampleGoalCoverage(issueRevision.strategy, goalCoverageIssues);
    const detailRevision = reviseStrategyForFeedbackDetails(
      gateRevision.strategy,
      sample.value.flatMap((chapter) => chapter.feedback.candidates.filter((candidate) => candidate.layer === "capability"))
    );
    const revisedStrategy = detailRevision.strategy;
    const addedConstraints = [...issueRevision.added, ...gateRevision.added, ...detailRevision.added];
    const roundUsage = combineLLMUsageSummaries(sample.value.map((chapter) => chapter.llmUsage));
    llmUsageSummaries.push(roundUsage);
    const sampleDir = `.feng/grow-samples/${grow.value.id}/round-${round}`;
    rounds.push({ round, sampleDir, version, chapters: sample.value.length, failChapters: failCount(sample.value), qualityGateBlockingCount: blockingCount, goalCoverageIssueCount: goalCoverageIssues, capabilityIssueKinds: capKinds, addedConstraints, llmUsage: roundUsage });
    await host.store.writeTextAtomic(host.workspace, `${sampleDir}/round-report.json`, JSON.stringify(rounds[rounds.length - 1], null, 2), { reason: "write grow round report", createParents: true });
    // Calibrate the length contract from sample evidence: if chapters overflow
    // the declared ceiling, the agent widens its own viable maxChars (capped),
    // learning the contract it can actually meet with this model. A provider
    // length stop is also an output-budget signal even when the truncated
    // candidate happens to stay under the declared character ceiling.
    const maxObserved = Math.max(...sample.value.map((c) => c.chars), 0);
    const lengthFail = sample.value.some((c) => c.quality.issues.some((i) => i.kind === "length" && i.severity === "error" && c.chars > (effectiveMax ?? Number.MAX_SAFE_INTEGER)));
    const budgetLimited = outputBudgetLimited(sample.value);
    const nextMax = effectiveMax === undefined
      ? undefined
      : Math.min(8000, Math.ceil((Math.max(maxObserved, effectiveMax) + (budgetLimited ? 1200 : 400)) / 100) * 100);
    const widened = effectiveMax !== undefined && nextMax !== undefined && (lengthFail || budgetLimited) && nextMax > effectiveMax;
    if (widened) effectiveMax = nextMax;
    const provisionalDesign = withStrategy(currentDesign, revisedStrategy);
    const wroteProvisionalCheckpoint = await writeRoundCheckpoint(host, {
      goal: input.goal,
      name,
      growUnitId: grow.value.id,
      currentDesign: provisionalDesign,
      ...(effectiveMax === undefined ? {} : { effectiveMax }),
      latestDesignTracePath,
      rounds,
      capabilityFeedbackCoverage: buildCapabilityFeedbackCoverage(capabilitySeed, activeAdoption, revisedStrategy),
      unresolvedSystemIssueKinds,
      unresolvedSystemFeedbackRefs,
      model: host.config.provider.model,
      provider: host.config.provider.provider,
      llmUsage: combineLLMUsageSummaries(llmUsageSummaries)
    });
    if (!wroteProvisionalCheckpoint.ok) return wroteProvisionalCheckpoint;
    if (capKinds.length === 0 && blockingCount === 0 && !widened) break;
    if (needsSampleRedesign(round, maxRounds, capKinds)) {
      const redesignIntent = await host.agenda.buildAttemptIntent(grow.value, {
        purpose: `Redesign the runtime package strategy from sample round ${round} evidence.`,
        toolNeedSummary: "LLM design call using file-native sample quality feedback.",
        policyBoundarySummary: "May call the configured LLM provider and write redesign message-list, model-output, and trace artifacts.",
        stopCondition: "A revised parseable runtime strategy addresses sample capability feedback without copying sample story facts.",
        source: meta.source,
        audit: meta.audit
      });
      if (!redesignIntent.ok) return redesignIntent;
      const redesigned = await designStrategy(host, {
        growUnitRef: grow.value,
        attemptIntentRef: redesignIntent.value,
        goal: input.goal,
        attemptLabel: `round-${round}-redesign`,
        feedbackContext: buildSampleRedesignContext({
          round,
          report: rounds[rounds.length - 1] as GrowRoundReport,
          results: sample.value,
          addedConstraints
        })
      });
      if (!redesigned.ok) return redesigned;
      llmUsageSummaries.push(redesigned.value.llmUsage);
      currentDesign = mergeRedesignedStrategy(redesigned.value.designed, revisedStrategy);
      strategy = currentDesign.strategy;
      effectiveMax = effectiveMax === undefined
        ? currentDesign.maxChars
        : Math.max(effectiveMax, currentDesign.maxChars ?? effectiveMax);
      latestDesignMessageListPath = redesigned.value.messageListPath;
      latestDesignTracePath = redesigned.value.tracePath;
      latestContextMessageListRef = redesigned.value.contextMessageListRef;
    } else {
      strategy = revisedStrategy;
      currentDesign = withStrategy(currentDesign, strategy);
    }
    const wroteCheckpoint = await writeRoundCheckpoint(host, {
      goal: input.goal,
      name,
      growUnitId: grow.value.id,
      currentDesign,
      ...(effectiveMax === undefined ? {} : { effectiveMax }),
      latestDesignTracePath,
      rounds,
      capabilityFeedbackCoverage: buildCapabilityFeedbackCoverage(capabilitySeed, activeAdoption, strategy),
      unresolvedSystemIssueKinds,
      unresolvedSystemFeedbackRefs,
      model: host.config.provider.model,
      provider: host.config.provider.provider,
      llmUsage: combineLLMUsageSummaries(llmUsageSummaries)
    });
    if (!wroteCheckpoint.ok) return wroteCheckpoint;
  }

  const firstCap = rounds[0]?.capabilityIssueKinds.length ?? 0;
  const finalCap = rounds[rounds.length - 1]?.capabilityIssueKinds.length ?? 0;
  const finalFail = rounds[rounds.length - 1]?.failChapters ?? 0;
  const finalSampleGateBlocking = rounds[rounds.length - 1]?.qualityGateBlockingCount ?? 0;
  const improved = firstCap === 0 ? true : finalCap < firstCap;
  const llmUsage = combineLLMUsageSummaries(llmUsageSummaries);

  const evidence = await host.evidence.recordEvidenceCandidate({
    growUnitRef: grow.value,
    sourceKind: "validation_report",
    summary: `grow sample-run evidence over ${rounds.length} round(s): capability issues ${firstCap} -> ${finalCap}, final hard-fail chapters ${finalFail}, final sample gate blocking ${finalSampleGateBlocking}`,
    content: JSON.stringify({
      rounds,
      improved,
      finalFail,
      finalSampleGateBlocking,
      llmUsage,
      seededFeedback: seedDigests.length === 0 && memoryKinds.length === 0 ? null : {
        reportPath: seededFeedbackPath,
        seeds: seedDigests,
        adoptionMemory: {
          sourcePath: CAPABILITY_ADOPTION_PATH,
          adoptedIssueKinds: adoptedKinds,
          unresolvedIssueKinds: unresolvedCapabilityKinds,
          adoptedCount: adoptedKinds.length,
          unresolvedCount: unresolvedCapabilityKinds.length,
          decisions: [...adoptedDecisions, ...unresolvedCapabilityDecisions]
        },
        systemResolution: systemResolution.value ?? null,
        unresolvedSystemIssueKinds,
        unresolvedSystemFeedbackDetails: unresolvedSystemDetails,
        unresolvedSystemFeedbackRefs
      }
    }, null, 2),
    artifactKind: "validation_report",
    relationHints: [{ relation: "supports", relatedDoDRef: dod.value, criticality: "critical", reason: "sample run evals demonstrate readiness" }],
    quality: { trustLevel: improved && finalCap === 0 && finalFail === 0 && finalSampleGateBlocking === 0 ? "strong" : "weak" },
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
  // Ready only when the final sample round has neither capability issues, hard
  // quality failures, nor unresolved per-chapter quality gates such as
  // no-missing-topic goal coverage.
  const evidenceReady = verdict.value.verdict === "ready_to_hatch" && finalCap === 0 && finalFail === 0 && finalSampleGateBlocking === 0;
  const seedReady = unresolvedSystemDetails.length === 0;
  const readinessReady = evidenceReady && seedReady;

  const finalPkgDraft = buildAuthoringPackage({
    name, version: "1.0.0", locked: readinessReady, strategy,
    targetWorld: currentDesign.targetWorld,
    contextPolicy: currentDesign.contextPolicy,
    storyModel: currentDesign.storyModel,
    harness: currentDesign.harness,
    coveragePolicy: currentDesign.coveragePolicy,
    qualityRules: currentDesign.qualityRules,
    feedbackRouting: currentDesign.feedbackRouting,
    ...(currentDesign.minChars === undefined ? {} : { minChars: currentDesign.minChars }),
    ...(effectiveMax === undefined ? {} : { maxChars: effectiveMax }),
    grownInProject: host.config.workspaceRoot, grownByGrowUnitId: grow.value.id,
    readiness: readinessReady ? "ready" : "draft",
    evidenceSummary: `rounds=${rounds.length}; capability ${firstCap}->${finalCap}; finalFail=${finalFail}; sampleGateBlocking=${finalSampleGateBlocking}; systemSeed=${unresolvedSystemDetails.length}; verdict=${verdict.value.verdict}`,
    sampleEvidenceRefs: sampleEvidenceRefs(rounds),
    model: host.config.provider.model, provider: host.config.provider.provider
  });
  const capabilityFeedbackCoverage = buildCapabilityFeedbackCoverage(capabilitySeed, activeAdoption, strategy);
  const gateSet = synthesizeXiaoshuoQualityGates({
    goal: input.goal,
    pkg: finalPkgDraft,
    designArtifacts: {
      designTracePath: latestDesignTracePath,
      coveragePolicyAuthoredByGrow: currentDesign.generatedFields.coveragePolicy
    },
    finalIssueKinds: rounds[rounds.length - 1]?.capabilityIssueKinds ?? [],
    capabilityFeedbackCoverage,
    unresolvedSystemIssueKinds,
    systemFeedbackRefs: unresolvedSystemFeedbackRefs,
    finalFailChapters: finalFail,
    sampleGateBlockingCount: finalSampleGateBlocking,
    sampleRoundCount: rounds.length,
    readiness: verdict.value.verdict
  });
  const gateWritten = await host.store.writeTextAtomic(host.workspace, XIAOSHUO_QUALITY_GATE_PATH, JSON.stringify(gateSet, null, 2), {
    reason: "write xiaoshuo quality gates and target coverage",
    createParents: true
  });
  if (!gateWritten.ok) return gateWritten;
  const gateReady = readinessReady && gateSet.summary.blockingCount === 0;
  const gateSummary = formatQualityGateSummary(gateSet.summary);
  const finalPkg: AuthoringRuntimePackage = {
    ...finalPkgDraft,
    locked: gateReady,
    validation: {
      ...finalPkgDraft.validation,
      readiness: gateReady ? "ready" : "draft",
      qualityGateRef: XIAOSHUO_QUALITY_GATE_PATH,
      targetCoverageRef: `${XIAOSHUO_QUALITY_GATE_PATH}#coverage`,
      qualityGateSummary: gateSummary,
      evidenceSummary: `${finalPkgDraft.validation.evidenceSummary}; ${gateSummary}`
    }
  };
  if (finalPkg.writingStrategy.systemPrompt.length === 0) {
    return domainErr({ module: "feng-grow-loop", code: "invalid_state", message: "grown strategy is empty", severity: "error" });
  }
  if (gateReady) {
    const applied = await host.grow.applyReadinessVerdict(grow.value, {
      readinessVerdictRef: verdict.value.artifactRef,
      verdict: { verdict: verdict.value.verdict, reason: verdict.value.reason, evidenceRefs: verdict.value.evidenceArtifactRefs },
      reason: "apply readiness after final quality gates passed", source: meta.source, audit: meta.audit
    });
    if (!applied.ok) return applied;
  }
  const finalRecord = await host.grow.getGrowUnit(grow.value);
  const lifecycle = finalRecord.ok ? finalRecord.value.lifecycle : "unknown";
  const saved = await savePackage(host.store, host.workspace, finalPkg);
  if (!saved.ok) return saved;
  const adoption = buildCapabilityAdoption({
    prior: capabilityAdoption.value,
    activeSeed: capabilitySeed,
    coverage: capabilityFeedbackCoverage,
    growUnitId: grow.value.id,
    packagePath: saved.value
  });
  const wroteAdoption = await writeCapabilityAdoption(host, adoption);
  if (!wroteAdoption.ok) return wroteAdoption;

  return ok({
    packagePath: saved.value,
    growUnitId: grow.value.id,
    ...(latestContextMessageListRef === undefined ? {} : { contextMessageListRef: latestContextMessageListRef }),
    designMessageListPath: latestDesignMessageListPath,
    designTracePath: latestDesignTracePath,
    qualityGatePath: XIAOSHUO_QUALITY_GATE_PATH,
    qualityGateSummary: gateSummary,
    ...(seededFeedbackPath === undefined ? {} : { seededFeedbackPath }),
    ...(wroteAdoption.value === undefined ? {} : { capabilityAdoptionPath: wroteAdoption.value }),
    rounds,
    improved,
    finalCapabilityIssues: finalCap,
    llmUsage,
    readiness: gateReady ? "ready" : "draft",
    lifecycle,
    seededConstraints
  });
}

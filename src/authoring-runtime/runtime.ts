import { ok, type Result } from "../domain/result.js";
import { domainErr } from "../domain/index.js";
import type { FileNativeStore, WorkspaceHandle } from "../file-store/index.js";
import type { LLMGateway, LLMUsageSample, LLMUsageSummary } from "../llm-gateway/index.js";
import { makeLLMRequestId } from "../llm-gateway/index.js";
import { summarizeLLMUsage } from "../llm-gateway/index.js";
import type { PolicyBoundary } from "../policy-boundary/index.js";
import { makePolicyRequestId } from "../policy-boundary/index.js";
import type { AuthoringRuntimePackage } from "../runtime-package/index.js";
import { compileMessageList, type AuthoringRunState } from "./message-list.js";
import { evaluateChapter, type QualityEval, type QualityIssue } from "./quality.js";
import { checkKernelContract, routeFeedback, type RoutedFeedback } from "./feedback.js";
import { readAuthorFeedbackInstructions } from "./author-feedback.js";
import { formatQualityGateSummary, synthesizeWorkProjectQualityGates, WORK_CHAPTER_QUALITY_GATE_FILE } from "./quality-gates.js";
import { defaultFeedbackRouting } from "../runtime-package/index.js";
import { buildSemanticJudgeMessages, parseSemanticEval, semanticCapabilityIssues, type SemanticEval } from "./semantic-eval.js";
import {
  buildGoalCoverageJudgeMessages,
  parseGoalCoverageEval,
  WORK_CHAPTER_GOAL_COVERAGE_EVAL_FILE,
  type GoalCoverageEval
} from "./goal-coverage.js";
import {
  chapterDir,
  chapterFilePath,
  feedbackCandidatesFilePath,
  OUTLINE_INDEX_PATH,
  outlineFilePath,
  parseChapterOutput,
  readNovelState,
  readProjectConfig,
  settingConflictsFilePath,
  writeJsonFile,
  writeTextFile,
  type ProjectConfig,
  type RuntimeNovelState
} from "./state.js";

export interface AuthoringRuntimeDeps {
  readonly store: FileNativeStore;
  readonly workspace: WorkspaceHandle;
  readonly llmGateway: LLMGateway;
  readonly policy: PolicyBoundary;
  readonly provider: string;
  readonly model: string;
  readonly semanticEval?: boolean;
  readonly now?: () => string;
}

export interface RunChapterResult {
  readonly chapterNumber: number;
  readonly chapterPath: string;
  readonly outlinePath: string;
  readonly feedbackCandidatesPath: string;
  readonly settingConflictsPath: string;
  readonly chars: number;
  readonly outline: string;
  readonly qualityPassed: boolean;
  readonly quality: QualityEval;
  readonly feedback: RoutedFeedback;
  readonly artifactDir: string;
  readonly qualityGatePath: string;
  readonly qualityGateSummary: string;
  readonly qualityGateBlockingCount: number;
  readonly repairAttempts: number;
  readonly llmUsage: LLMUsageSummary;
  readonly semantic?: SemanticEval;
  readonly goalCoverage?: GoalCoverageEval;
}

interface SemanticEvalRun {
  readonly semantic?: SemanticEval;
  readonly usageSamples: readonly LLMUsageSample[];
}

interface GoalCoverageEvalRun {
  readonly goalCoverage?: GoalCoverageEval;
  readonly usageSamples: readonly LLMUsageSample[];
}

async function runSemanticEval(
  deps: AuthoringRuntimeDeps,
  chapterNumber: number,
  chapterText: string,
  policyDecisionId: import("../domain/index.js").PolicyDecisionId,
  meta: ReturnType<typeof descriptors>,
  now: () => string
): Promise<SemanticEvalRun> {
  let last: SemanticEval | undefined;
  const usageSamples: LLMUsageSample[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const retryHint = attempt === 0
      ? ""
      : "\n\n上一轮评审输出不是合法 JSON。本轮只能输出一个 JSON 对象，不能输出 Markdown、解释或额外文字。";
    const response = await deps.llmGateway.sendLLMRequest({
      requestId: makeLLMRequestId(`authoring-judge-ch${chapterNumber}-${attempt}-${Date.now()}`),
      providerNeutralMessages: buildSemanticJudgeMessages(chapterText, retryHint),
      modelSelection: { provider: deps.provider, model: deps.model },
      requiredCapabilities: {},
      streaming: false,
      timeoutMs: 120_000,
      policyDecisionId,
      source: meta.source,
      version: meta.version,
      audit: meta.audit
    });
    if (!response.ok) return { ...(last === undefined ? {} : { semantic: last }), usageSamples };
    usageSamples.push({ phase: "semantic_judge", usage: response.value.usage });
    const raw = response.value.contentBlocks.filter((b) => b.type === "text").map((b) => (b as { text?: string }).text ?? "").join("\n");
    last = parseSemanticEval(raw, chapterNumber, now());
    if (last.parseOk) return { semantic: last, usageSamples };
  }
  return { ...(last === undefined ? {} : { semantic: last }), usageSamples };
}

async function runGoalCoverageEval(
  deps: AuthoringRuntimeDeps,
  chapterNumber: number,
  chapterGoal: string,
  chapterText: string,
  policyDecisionId: import("../domain/index.js").PolicyDecisionId,
  meta: ReturnType<typeof descriptors>,
  now: () => string
): Promise<GoalCoverageEvalRun> {
  const response = await deps.llmGateway.sendLLMRequest({
    requestId: makeLLMRequestId(`authoring-goal-coverage-ch${chapterNumber}-${Date.now()}`),
    providerNeutralMessages: buildGoalCoverageJudgeMessages(chapterGoal, chapterText),
    modelSelection: { provider: deps.provider, model: deps.model },
    requiredCapabilities: {},
    streaming: false,
    timeoutMs: 120_000,
    policyDecisionId,
    source: meta.source,
    version: meta.version,
    audit: meta.audit
  });
  if (!response.ok) return { usageSamples: [] };
  const raw = response.value.contentBlocks.filter((b) => b.type === "text").map((b) => (b as { text?: string }).text ?? "").join("\n");
  return {
    goalCoverage: parseGoalCoverageEval(raw, chapterNumber, chapterGoal, now()),
    usageSamples: [{ phase: "goal_coverage_judge", usage: response.value.usage }]
  };
}

function descriptors(provider: string, now: () => string) {
  const at = now();
  return {
    source: { kind: "runtime" as const, origin: `xiaoshuo-runtime:${provider}`, userProvided: false, receivedAt: at, privacyLevel: "workspace_private" as const },
    version: { schemaVersion: "1.0.0", producerVersion: "xiaoshuo-runtime" },
    audit: { createdAt: at, createdBy: "xiaoshuo-runtime", reason: "run authoring chapter" }
  };
}

async function lastChapterTail(deps: AuthoringRuntimeDeps, n: number): Promise<string | undefined> {
  if (n < 1) return undefined;
  const read = await deps.store.readText(deps.workspace, chapterFilePath(n), { reason: "read prior chapter tail", maxBytes: 256 * 1024 });
  if (!read.ok) return undefined;
  const text = read.value.content;
  return text.slice(Math.max(0, text.length - 200));
}

function blocksText(blocks: readonly { readonly type: string; readonly text?: string }[]): string {
  return blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
}

const MAX_REPAIRS = 1;
const MAX_SEMANTIC_REPAIRS = 2;
const SETTING_CONFLICT_ISSUE_KINDS = new Set<QualityIssue["kind"]>([
  "chapter_continuity",
  "year_consistency",
  "character_continuation",
  "geography_consistency",
  "outline_continuity"
]);

function buildCorrection(issues: readonly { readonly kind: string; readonly severity: string; readonly detail: string }[]): string | undefined {
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length === 0) return undefined;
  return `上一稿存在以下必须修复的硬性问题，请在不改变既定情节的前提下重写本章修复它们：\n${errors.map((e) => `- ${e.detail}`).join("\n")}`;
}

function buildSemanticCorrection(issues: readonly QualityIssue[], chapter: string): string {
  const issueText = issues.map((issue) => `- ${issue.detail}`).join("\n");
  const prior = chapter.length > 6000 ? chapter.slice(0, 6000) : chapter;
  return [
    "上一稿通过了结构检查，但语义质量评审仍未达标。请重写本章，优先修复以下问题，同时保持本章目标、既定事实、章节连续性和输出格式。",
    issueText,
    "不要输出质量报告、反馈候选或解释，只输出正文，然后输出 ===OUTLINE=== 和一句话大纲。",
    "【上一稿正文】",
    prior
  ].join("\n");
}

function finishReasonIssue(chapterNumber: number, phase: string, finishReason: string): QualityIssue | undefined {
  if (finishReason !== "length") return undefined;
  return {
    kind: "runtime_capability",
    severity: "warning",
    detail: `第${chapterNumber}章 ${phase} 被模型输出长度截断(finishReason=length)；当前 runtime 仍继续使用该候选，需要 feng 调整输出预算、分阶段写作或截断检测策略`
  };
}

function withCorrection(
  messages: readonly import("../context-message-compiler/index.js").ProviderNeutralMessage[],
  correction: string
): readonly import("../context-message-compiler/index.js").ProviderNeutralMessage[] {
  let lastUserIndex = -1;
  messages.forEach((message, index) => {
    if (message.role === "user") lastUserIndex = index;
  });
  return messages.map((m, index) =>
    index === lastUserIndex
      ? { ...m, content: [...m.content, { type: "text" as const, text: `\n\n【修订要求】\n${correction}` }] }
      : m
  );
}

function outlineDocument(title: string, chapterNumber: number, outline: string): string {
  return [`# ${title} · 第${chapterNumber}章大纲`, "", outline.trim(), ""].join("\n");
}

function outlineIndexDocument(title: string, chapters: RuntimeNovelState["chapters"]): string {
  const lines = chapters.map((chapter) => {
    const outline = chapter.outline.replace(/^第\d+章[:：]\s*/, "").trim();
    return `- 第${chapter.number}章：${outline}`;
  });
  return [`# ${title} · 大纲`, "", ...lines, ""].join("\n");
}

export async function runChapter(deps: AuthoringRuntimeDeps, pkg: AuthoringRuntimePackage): Promise<Result<RunChapterResult>> {
  const now = deps.now ?? (() => new Date().toISOString());
  const projectRes = await readProjectConfig(deps.store, deps.workspace);
  if (!projectRes.ok) return projectRes;
  const project: ProjectConfig | undefined = projectRes.value;
  if (project === undefined) {
    return domainErr({ module: "authoring-runtime", code: "invalid_state", message: "missing .feng/runtime/project.json; the work project must define premise/title", severity: "error" });
  }
  const stateRes = await readNovelState(deps.store, deps.workspace);
  if (!stateRes.ok) return stateRes;
  const state: RuntimeNovelState = stateRes.value ?? { premise: project.premise, title: project.title, chapters: [] };
  const chapterNumber = state.chapters.length + 1;
  const priorOutlines = state.chapters.map((c) => c.outline);
  const tail = await lastChapterTail(deps, chapterNumber - 1);
  const authorFeedback = await readAuthorFeedbackInstructions(deps.store, deps.workspace);
  if (!authorFeedback.ok) return authorFeedback;
  const authorFeedbackInstructions = authorFeedback.value.map((item) => item.instruction);
  const authorFeedbackRefs = authorFeedback.value.map((item) => item.feedbackRef);

  const runState: AuthoringRunState = {
    premise: project.premise,
    title: project.title,
    chapterNumber,
    ...(project.chapterGoals?.[chapterNumber - 1] === undefined ? {} : { chapterGoal: project.chapterGoals[chapterNumber - 1] }),
    priorOutlines,
    ...(tail === undefined ? {} : { lastChapterTail: tail }),
    ...(project.characterBible === undefined ? {} : { characterBible: project.characterBible }),
    ...(project.worldBible === undefined ? {} : { worldBible: project.worldBible }),
    ...(authorFeedbackInstructions.length === 0 ? {} : { acceptedFeedback: authorFeedbackInstructions })
  };

  const compiled = compileMessageList(pkg, runState);
  const dir = chapterDir(chapterNumber);
  const meta = descriptors(deps.provider, now);
  await writeJsonFile(deps.store, deps.workspace, `${dir}/input.json`, {
    chapterNumber,
    premise: project.premise,
    title: project.title,
    chapterGoal: runState.chapterGoal ?? null,
    priorOutlines,
    authorFeedbackRefs,
    authorFeedbackInstructionCount: authorFeedbackInstructions.length
  }, "write run input");
  await writeJsonFile(deps.store, deps.workspace, `${dir}/message-list.json`, compiled.record, "write compiled message list");

  const decision = await deps.policy.evaluateAction({
    requestId: makePolicyRequestId(`authoring-net-${chapterNumber}-${Date.now()}`),
    capability: "network.request",
    requestedByModule: "authoring-runtime",
    workspace: deps.workspace.id,
    resourceSummary: `provider:${deps.provider}`,
    operation: "send",
    reason: "authoring runtime chapter generation",
    source: meta.source
  }, {
    caller: "authoring-runtime",
    environment: { hostSandboxAvailable: false, networkAvailable: true, externalEnforcementAvailable: false, secretStoreAvailable: false },
    rules: [{ capability: "network.request", resource: "*", verdict: "allow" }]
  });
  if (!decision.ok) return decision;

  const evalOf = (text: string, outline: string): QualityEval => evaluateChapter({
    rules: pkg.qualityRules,
    chapterNumber,
    chapterText: text,
    outline,
    priorChapterNumbers: state.chapters.map((c) => c.number),
    priorOutlines,
    ...(project.establishedYear === undefined ? {} : { establishedYear: project.establishedYear }),
    ...(project.establishedCharacters === undefined ? {} : { establishedCharacters: project.establishedCharacters }),
    ...(project.conflictTerms === undefined ? {} : { conflictTerms: project.conflictTerms }),
    messageListWritten: true,
    traceWritten: true
  });
  const errorCount = (e: QualityEval): number => e.issues.filter((i) => i.severity === "error").length;

  let best: { chapter: string; outline: string; quality: QualityEval; finishReason: string; usage: unknown } | undefined;
  let repairAttempts = 0;
  const issuesLog: string[] = [];
  const llmUsageSamples: LLMUsageSample[] = [];
  const runtimeIssues: QualityIssue[] = [];
  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt += 1) {
    const messages = attempt === 0 || issuesLog.length === 0
      ? compiled.messages
      : withCorrection(compiled.messages, issuesLog[issuesLog.length - 1] as string);
    const response = await deps.llmGateway.sendLLMRequest({
      requestId: makeLLMRequestId(`authoring-ch${chapterNumber}-${attempt}-${Date.now()}`),
      providerNeutralMessages: messages,
      modelSelection: { provider: deps.provider, model: deps.model },
      requiredCapabilities: {},
      streaming: false,
      timeoutMs: 180_000,
      policyDecisionId: decision.value.policyDecisionId,
      source: meta.source,
      version: meta.version,
      audit: meta.audit
    });
    if (!response.ok) return response;
    llmUsageSamples.push({ phase: attempt === 0 ? "chapter_generation" : "chapter_repair", usage: response.value.usage });
    const responseFinishIssue = finishReasonIssue(chapterNumber, attempt === 0 ? "初稿生成" : "结构修复", response.value.finishReason);
    if (responseFinishIssue !== undefined) runtimeIssues.push(responseFinishIssue);
    const raw = blocksText(response.value.contentBlocks);
    if (raw.length === 0) {
      return domainErr({ module: "authoring-runtime", code: "response_invalid", message: "model returned no chapter text", severity: "error", retryable: true });
    }
    const candidate = parseChapterOutput(raw, chapterNumber);
    const candidateEval = evalOf(candidate.chapter, candidate.outline);
    if (best === undefined || errorCount(candidateEval) < errorCount(best.quality)) {
      best = { chapter: candidate.chapter, outline: candidate.outline, quality: candidateEval, finishReason: response.value.finishReason, usage: response.value.usage };
    }
    if (candidateEval.status !== "fail" || attempt === MAX_REPAIRS) break;
    const correction = buildCorrection(candidateEval.issues);
    if (correction === undefined) break;
    issuesLog.push(correction);
    repairAttempts += 1;
  }
  if (best === undefined) {
    return domainErr({ module: "authoring-runtime", code: "response_invalid", message: "no chapter produced", severity: "error" });
  }
  let parsed = { chapter: best.chapter, outline: best.outline };
  let finishReason = best.finishReason;
  let usage = best.usage;
  let quality = best.quality;
  let semantic: SemanticEval | undefined;
  let semanticRepairAttempts = 0;
  const semanticRepairs: string[] = [];
  if (deps.semanticEval === true) {
    const semanticRun = await runSemanticEval(deps, chapterNumber, parsed.chapter, decision.value.policyDecisionId, meta, now);
    llmUsageSamples.push(...semanticRun.usageSamples);
    semantic = semanticRun.semantic;
    for (let attempt = 0; attempt < MAX_SEMANTIC_REPAIRS; attempt += 1) {
      if (semantic === undefined) break;
      const semanticIssues = semanticCapabilityIssues(semantic);
      if (semanticIssues.length === 0) break;
      const correction = buildSemanticCorrection(semanticIssues, parsed.chapter);
      semanticRepairs.push(correction);
      semanticRepairAttempts += 1;
      const response = await deps.llmGateway.sendLLMRequest({
        requestId: makeLLMRequestId(`authoring-ch${chapterNumber}-semantic-repair-${attempt}-${Date.now()}`),
        providerNeutralMessages: withCorrection(compiled.messages, correction),
        modelSelection: { provider: deps.provider, model: deps.model },
        requiredCapabilities: {},
        streaming: false,
        timeoutMs: 180_000,
        policyDecisionId: decision.value.policyDecisionId,
        source: meta.source,
        version: meta.version,
        audit: meta.audit
      });
      if (!response.ok) return response;
      llmUsageSamples.push({ phase: "semantic_repair_generation", usage: response.value.usage });
      const responseFinishIssue = finishReasonIssue(chapterNumber, `语义修复${attempt + 1}`, response.value.finishReason);
      if (responseFinishIssue !== undefined) runtimeIssues.push(responseFinishIssue);
      const raw = blocksText(response.value.contentBlocks);
      if (raw.length === 0) break;
      const candidate = parseChapterOutput(raw, chapterNumber);
      const candidateEval = evalOf(candidate.chapter, candidate.outline);
      if (errorCount(candidateEval) > errorCount(quality)) continue;
      const candidateSemanticRun = await runSemanticEval(deps, chapterNumber, candidate.chapter, decision.value.policyDecisionId, meta, now);
      llmUsageSamples.push(...candidateSemanticRun.usageSamples);
      const candidateSemantic = candidateSemanticRun.semantic;
      if (candidateSemantic === undefined) break;
      const beforeIssues = semanticCapabilityIssues(semantic).length;
      const afterIssues = semanticCapabilityIssues(candidateSemantic).length;
      const semanticImproved = afterIssues < beforeIssues || (afterIssues === beforeIssues && candidateSemantic.overall >= semantic.overall);
      if (!semanticImproved) continue;
      parsed = { chapter: candidate.chapter, outline: candidate.outline };
      quality = candidateEval;
      finishReason = response.value.finishReason;
      usage = response.value.usage;
      semantic = candidateSemantic;
    }
    if (semantic !== undefined) {
      await writeJsonFile(deps.store, deps.workspace, `${dir}/semantic-eval.json`, semantic, "write semantic eval");
    }
  }
  const chapterPath = chapterFilePath(chapterNumber);
  const outlinePath = outlineFilePath(chapterNumber);
  await writeTextFile(deps.store, deps.workspace, chapterPath, `# ${project.title} · 第${chapterNumber}章\n\n${parsed.chapter}\n`, "write chapter file");
  await writeTextFile(deps.store, deps.workspace, outlinePath, outlineDocument(project.title, chapterNumber, parsed.outline), "write business outline file");
  let goalCoverage: GoalCoverageEval | undefined;
  if (deps.semanticEval === true && runState.chapterGoal !== undefined && runState.chapterGoal.trim().length > 0) {
    const goalCoverageRun = await runGoalCoverageEval(deps, chapterNumber, runState.chapterGoal, parsed.chapter, decision.value.policyDecisionId, meta, now);
    llmUsageSamples.push(...goalCoverageRun.usageSamples);
    goalCoverage = goalCoverageRun.goalCoverage;
    if (goalCoverage !== undefined) {
      await writeJsonFile(deps.store, deps.workspace, `${dir}/${WORK_CHAPTER_GOAL_COVERAGE_EVAL_FILE}`, goalCoverage, "write goal coverage eval");
    }
  }

  // Package routing takes precedence; the kernel's default routing fills any
  // gaps (e.g. an older package that predates a newly added issue kind), so a
  // system-layer kernel gap is never mis-routed to the work project. Semantic
  // judge problems join as capability-layer signals so they are routed (not just
  // scored) to the agent grow project.
  const routing = [...pkg.feedbackRouting, ...defaultFeedbackRouting];
  const semanticIssues = semantic === undefined ? [] : semanticCapabilityIssues(semantic);
  const feedback = routeFeedback(routing, chapterNumber, [...quality.issues, ...checkKernelContract(pkg), ...runtimeIssues, ...semanticIssues]);
  const gateSet = synthesizeWorkProjectQualityGates({
    project,
    pkg,
    chapterNumber,
    ...(runState.chapterGoal === undefined ? {} : { chapterGoal: runState.chapterGoal }),
    artifactDir: dir,
    quality,
    feedback,
    semanticEvaluated: semantic !== undefined,
    ...(goalCoverage === undefined ? {} : { goalCoverage }),
    now
  });
  const qualityGatePath = `${dir}/${WORK_CHAPTER_QUALITY_GATE_FILE}`;
  const qualityGateSummary = formatQualityGateSummary(gateSet.summary);
  const feedbackCandidatesPath = feedbackCandidatesFilePath(chapterNumber);
  const settingConflictsPath = settingConflictsFilePath(chapterNumber);
  const settingConflicts = quality.issues.filter((issue) => SETTING_CONFLICT_ISSUE_KINDS.has(issue.kind));
  const llmUsage = summarizeLLMUsage(llmUsageSamples);

  await writeJsonFile(deps.store, deps.workspace, `${dir}/model-output.json`, {
    finishReason,
    usage,
    llmUsage,
    text: parsed.chapter,
    outline: parsed.outline,
    repairAttempts,
    repairs: issuesLog,
    runtimeIssues,
    semanticRepairAttempts,
    semanticRepairs
  }, "write model output");

  await writeJsonFile(deps.store, deps.workspace, feedbackCandidatesPath, {
    schemaVersion: "1.0.0",
    kind: "business_feedback_candidates",
    chapterNumber,
    sourceRuntimeRef: `${dir}/feedback.json`,
    candidates: feedback.candidates
  }, "write business feedback candidates");
  await writeJsonFile(deps.store, deps.workspace, settingConflictsPath, {
    schemaVersion: "1.0.0",
    kind: "business_setting_conflicts",
    chapterNumber,
    sourceRuntimeRef: `${dir}/quality-eval.json`,
    conflicts: settingConflicts.map((issue) => ({
      issueKind: issue.kind,
      severity: issue.severity,
      detail: issue.detail
    }))
  }, "write business setting conflicts");

  await writeJsonFile(deps.store, deps.workspace, `${dir}/trace.json`, {
    chapterNumber,
    inputSummary: `premise+${priorOutlines.length} prior outlines`,
    factsUsed: compiled.record.sections.map((s) => `${s.kind}:${s.charsUsed}chars`),
    strategyUsed: `${pkg.name}@${pkg.version}`,
    authorFeedbackRefs,
    authorFeedbackInstructionCount: authorFeedbackInstructions.length,
    generatedChars: parsed.chapter.length,
    chapterPath,
    outlinePath,
    feedbackCandidatesPath,
    settingConflictsPath,
    repairAttempts,
    semanticRepairAttempts,
    llmUsage,
    cacheHitRatePct: llmUsage.cacheHitRatePct,
    runtimeIssues: runtimeIssues.map((issue) => ({
      issueKind: issue.kind,
      severity: issue.severity,
      detail: issue.detail
    })),
    conflictsFound: quality.issues.map((i) => `${i.kind}:${i.detail}`),
    feedbackCandidateCount: feedback.candidates.length,
    qualityGateRef: qualityGatePath,
    qualityGateSummary,
    ...(goalCoverage === undefined ? {} : {
      goalCoverageRef: `${dir}/${WORK_CHAPTER_GOAL_COVERAGE_EVAL_FILE}`,
      goalCoverageCovered: goalCoverage.covered,
      goalCoverageConfidence: goalCoverage.confidence
    }),
    tracedAt: now()
  }, "write runtime trace");
  await writeJsonFile(deps.store, deps.workspace, `${dir}/quality-eval.json`, quality, "write quality eval");
  await writeJsonFile(deps.store, deps.workspace, `${dir}/feedback.json`, feedback, "write feedback candidates");
  await writeJsonFile(deps.store, deps.workspace, qualityGatePath, gateSet, "write work-project quality gates");

  const nextState: RuntimeNovelState = {
    premise: project.premise,
    title: project.title,
    chapters: [...state.chapters, {
      number: chapterNumber,
      outline: parsed.outline,
      chapterPath,
      outlinePath,
      feedbackCandidatesPath,
      settingConflictsPath,
      chars: parsed.chapter.length,
      qualityStatus: quality.status,
      qualityPassed: quality.passed,
      issueCount: quality.issues.length
    }]
  };
  await writeTextFile(deps.store, deps.workspace, OUTLINE_INDEX_PATH, outlineIndexDocument(project.title, nextState.chapters), "write business outline index");
  const persisted = await writeJsonFile(deps.store, deps.workspace, ".feng/runtime/novel-state.json", nextState, "update runtime novel state");
  if (!persisted.ok) return persisted;

  return ok({
    chapterNumber,
    chapterPath,
    outlinePath,
    feedbackCandidatesPath,
    settingConflictsPath,
    chars: parsed.chapter.length,
    outline: parsed.outline,
    qualityPassed: quality.passed,
    quality,
    feedback,
    artifactDir: dir,
    qualityGatePath,
    qualityGateSummary,
    qualityGateBlockingCount: gateSet.summary.blockingCount,
    repairAttempts,
    llmUsage,
    ...(semantic === undefined ? {} : { semantic }),
    ...(goalCoverage === undefined ? {} : { goalCoverage })
  });
}

export async function runChapters(deps: AuthoringRuntimeDeps, pkg: AuthoringRuntimePackage, count: number): Promise<Result<readonly RunChapterResult[]>> {
  const results: RunChapterResult[] = [];
  for (let i = 0; i < Math.max(1, count); i += 1) {
    const result = await runChapter(deps, pkg);
    if (!result.ok) return results.length === 0 ? result : ok(results);
    results.push(result.value);
  }
  return ok(results);
}

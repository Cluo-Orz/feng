import { ok, type Result } from "../domain/result.js";
import { domainErr } from "../domain/index.js";
import type { FileNativeStore, WorkspaceHandle } from "../file-store/index.js";
import type { LLMGateway } from "../llm-gateway/index.js";
import { makeLLMRequestId } from "../llm-gateway/index.js";
import type { PolicyBoundary } from "../policy-boundary/index.js";
import { makePolicyRequestId } from "../policy-boundary/index.js";
import type { AuthoringRuntimePackage } from "../runtime-package/index.js";
import { compileMessageList, type AuthoringRunState } from "./message-list.js";
import { evaluateChapter, type QualityEval } from "./quality.js";
import { routeFeedback, type RoutedFeedback } from "./feedback.js";
import { buildSemanticJudgePrompt, parseSemanticEval, SEMANTIC_JUDGE_SYSTEM, type SemanticEval } from "./semantic-eval.js";
import {
  chapterDir,
  chapterFilePath,
  parseChapterOutput,
  readNovelState,
  readProjectConfig,
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
  readonly chars: number;
  readonly outline: string;
  readonly qualityPassed: boolean;
  readonly quality: QualityEval;
  readonly feedback: RoutedFeedback;
  readonly artifactDir: string;
  readonly repairAttempts: number;
  readonly semantic?: SemanticEval;
}

async function runSemanticEval(
  deps: AuthoringRuntimeDeps,
  chapterNumber: number,
  chapterText: string,
  policyDecisionId: import("../domain/index.js").PolicyDecisionId,
  meta: ReturnType<typeof descriptors>,
  now: () => string
): Promise<SemanticEval | undefined> {
  const response = await deps.llmGateway.sendLLMRequest({
    requestId: makeLLMRequestId(`authoring-judge-ch${chapterNumber}-${Date.now()}`),
    providerNeutralMessages: [
      { role: "system", content: [{ type: "text", text: SEMANTIC_JUDGE_SYSTEM }] },
      { role: "user", content: [{ type: "text", text: buildSemanticJudgePrompt(chapterText) }] }
    ],
    modelSelection: { provider: deps.provider, model: deps.model },
    requiredCapabilities: {},
    streaming: false,
    timeoutMs: 120_000,
    policyDecisionId,
    source: meta.source,
    version: meta.version,
    audit: meta.audit
  });
  if (!response.ok) return undefined;
  const raw = response.value.contentBlocks.filter((b) => b.type === "text").map((b) => (b as { text?: string }).text ?? "").join("\n");
  return parseSemanticEval(raw, chapterNumber, now());
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

function lengthCorrection(len: number, pkg: AuthoringRuntimePackage): string | undefined {
  const rule = pkg.qualityRules.find((r) => r.kind === "length");
  if (rule === undefined) return undefined;
  const min = rule.minChars ?? 0;
  const max = rule.maxChars ?? Number.MAX_SAFE_INTEGER;
  if (len < min) return `上一稿仅${len}字，过短。请在不改变情节的前提下扩写到至少${min}字，补充场景、对话与细节。`;
  if (len > max) return `上一稿${len}字，过长。请在不改变情节的前提下压缩到${max}字以内，删去冗余铺陈。`;
  return undefined;
}

function withCorrection(
  messages: readonly import("../context-message-compiler/index.js").ProviderNeutralMessage[],
  correction: string
): readonly import("../context-message-compiler/index.js").ProviderNeutralMessage[] {
  return messages.map((m) =>
    m.role === "user"
      ? { ...m, content: [...m.content, { type: "text" as const, text: `\n\n【修订要求】\n${correction}` }] }
      : m
  );
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

  const runState: AuthoringRunState = {
    premise: project.premise,
    title: project.title,
    chapterNumber,
    ...(project.chapterGoals?.[chapterNumber - 1] === undefined ? {} : { chapterGoal: project.chapterGoals[chapterNumber - 1] }),
    priorOutlines,
    ...(tail === undefined ? {} : { lastChapterTail: tail }),
    ...(project.characterBible === undefined ? {} : { characterBible: project.characterBible }),
    ...(project.worldBible === undefined ? {} : { worldBible: project.worldBible })
  };

  const compiled = compileMessageList(pkg, runState);
  const dir = chapterDir(chapterNumber);
  const meta = descriptors(deps.provider, now);
  await writeJsonFile(deps.store, deps.workspace, `${dir}/input.json`, { chapterNumber, premise: project.premise, title: project.title, chapterGoal: runState.chapterGoal ?? null, priorOutlines }, "write run input");
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

  let parsed = { chapter: "", outline: "" };
  let finishReason = "unknown";
  let usage: unknown = {};
  let repairAttempts = 0;
  const issuesLog: string[] = [];
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
    const raw = blocksText(response.value.contentBlocks);
    if (raw.length === 0) {
      return domainErr({ module: "authoring-runtime", code: "response_invalid", message: "model returned no chapter text", severity: "error", retryable: true });
    }
    parsed = parseChapterOutput(raw, chapterNumber);
    finishReason = response.value.finishReason;
    usage = response.value.usage;
    const correction = lengthCorrection(parsed.chapter.length, pkg);
    if (correction === undefined || attempt === MAX_REPAIRS) break;
    issuesLog.push(correction);
    repairAttempts += 1;
  }
  const chapterPath = chapterFilePath(chapterNumber);
  await writeTextFile(deps.store, deps.workspace, chapterPath, `# ${project.title} · 第${chapterNumber}章\n\n${parsed.chapter}\n`, "write chapter file");
  await writeJsonFile(deps.store, deps.workspace, `${dir}/model-output.json`, { finishReason, usage, text: parsed.chapter, outline: parsed.outline, repairAttempts, repairs: issuesLog }, "write model output");

  const quality = evaluateChapter({
    rules: pkg.qualityRules,
    chapterNumber,
    chapterText: parsed.chapter,
    outline: parsed.outline,
    priorChapterNumbers: state.chapters.map((c) => c.number),
    priorOutlines,
    ...(project.establishedYear === undefined ? {} : { establishedYear: project.establishedYear }),
    ...(project.establishedCharacters === undefined ? {} : { establishedCharacters: project.establishedCharacters }),
    ...(project.conflictTerms === undefined ? {} : { conflictTerms: project.conflictTerms }),
    messageListWritten: true,
    traceWritten: true
  });
  const feedback = routeFeedback(pkg.feedbackRouting, chapterNumber, quality.issues);

  await writeJsonFile(deps.store, deps.workspace, `${dir}/trace.json`, {
    chapterNumber,
    inputSummary: `premise+${priorOutlines.length} prior outlines`,
    factsUsed: compiled.record.sections.map((s) => `${s.kind}:${s.charsUsed}chars`),
    strategyUsed: `${pkg.name}@${pkg.version}`,
    generatedChars: parsed.chapter.length,
    repairAttempts,
    conflictsFound: quality.issues.map((i) => `${i.kind}:${i.detail}`),
    feedbackCandidateCount: feedback.candidates.length,
    tracedAt: now()
  }, "write runtime trace");
  await writeJsonFile(deps.store, deps.workspace, `${dir}/quality-eval.json`, quality, "write quality eval");
  await writeJsonFile(deps.store, deps.workspace, `${dir}/feedback.json`, feedback, "write feedback candidates");

  let semantic: SemanticEval | undefined;
  if (deps.semanticEval === true) {
    semantic = await runSemanticEval(deps, chapterNumber, parsed.chapter, decision.value.policyDecisionId, meta, now);
    if (semantic !== undefined) {
      await writeJsonFile(deps.store, deps.workspace, `${dir}/semantic-eval.json`, semantic, "write semantic eval");
    }
  }

  const nextState: RuntimeNovelState = {
    premise: project.premise,
    title: project.title,
    chapters: [...state.chapters, { number: chapterNumber, outline: parsed.outline, chapterPath, chars: parsed.chapter.length, qualityPassed: quality.passed, issueCount: quality.issues.length }]
  };
  const persisted = await writeJsonFile(deps.store, deps.workspace, ".feng/runtime/novel-state.json", nextState, "update runtime novel state");
  if (!persisted.ok) return persisted;

  return ok({ chapterNumber, chapterPath, chars: parsed.chapter.length, outline: parsed.outline, qualityPassed: quality.passed, quality, feedback, artifactDir: dir, repairAttempts, ...(semantic === undefined ? {} : { semantic }) });
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

import { ok, type Result } from "../domain/result.js";
import { domainErr } from "../domain/index.js";
import { makeLLMRequestId } from "../llm-gateway/index.js";
import { makePolicyRequestId } from "../policy-boundary/index.js";
import type { PolicyDecisionId } from "../domain/index.js";
import { buildXiaoshuoUserPrompt, parseChapterOutput, XIAOSHUO_SYSTEM_PROMPT } from "./prompts.js";
import type { FengHost } from "./runtime-host.js";

const STATE_PATH = ".feng/xiaoshuo/novel-state.json";

export interface NovelChapterRecord {
  readonly number: number;
  readonly outline: string;
  readonly path: string;
  readonly chars: number;
  readonly artifactId?: string;
  readonly issues?: readonly string[];
}

export interface NovelState {
  readonly premise: string;
  readonly title: string;
  readonly chapters: readonly NovelChapterRecord[];
}

export interface WriteChapterResult {
  readonly chapterNumber: number;
  readonly path: string;
  readonly chars: number;
  readonly outline: string;
  readonly finishReason: string;
  readonly repaired: boolean;
  readonly issues: readonly string[];
}

const MIN_CHAPTER_CHARS = 500;
const MAX_REPAIRS = 1;

function descriptors(reason: string) {
  const at = new Date().toISOString();
  return {
    source: { kind: "system" as const, origin: "xiaoshuo-writer", userProvided: false, receivedAt: at, privacyLevel: "workspace_private" as const },
    version: { schemaVersion: "1.0.0", producerVersion: "xiaoshuo-writer" },
    audit: { createdAt: at, createdBy: "xiaoshuo-writer", reason }
  };
}

export async function readNovelState(host: FengHost): Promise<NovelState | undefined> {
  const read = await host.store.readText(host.workspace, STATE_PATH, { reason: "read novel state", maxBytes: 512 * 1024 });
  if (!read.ok) return undefined;
  try {
    return JSON.parse(read.value.content) as NovelState;
  } catch {
    return undefined;
  }
}

async function writeNovelState(host: FengHost, state: NovelState): Promise<Result<unknown>> {
  return host.store.writeTextAtomic(host.workspace, STATE_PATH, JSON.stringify(state, null, 2), {
    reason: "persist novel state",
    createParents: true
  });
}

async function allowNetwork(host: FengHost, reason: string): Promise<Result<PolicyDecisionId>> {
  const meta = descriptors(reason);
  const decision = await host.policy.evaluateAction({
    requestId: makePolicyRequestId(`xiaoshuo-net-${host.config.provider.provider}-${Date.now()}`),
    capability: "network.request",
    requestedByModule: "xiaoshuo-writer",
    workspace: host.workspace.id,
    resourceSummary: `provider:${host.config.provider.provider}`,
    operation: "send",
    reason,
    source: meta.source
  }, {
    caller: "xiaoshuo-writer",
    environment: { hostSandboxAvailable: false, networkAvailable: true, externalEnforcementAvailable: false, secretStoreAvailable: false },
    rules: [{ capability: "network.request", resource: "*", verdict: "allow" }]
  });
  return decision.ok ? ok(decision.value.policyDecisionId) : decision;
}

function chapterText(blocks: readonly { readonly type: string; readonly text?: string }[]): string {
  return blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
}

interface ModelAttempt {
  readonly chapter: string;
  readonly outline: string;
  readonly finishReason: string;
}

async function callModel(
  host: FengHost,
  args: { readonly premise: string; readonly priorOutline: string; readonly chapterNumber: number; readonly skillBody?: string; readonly correction?: string }
): Promise<Result<ModelAttempt>> {
  const decision = await allowNetwork(host, "write novel chapter");
  if (!decision.ok) return decision;
  const meta = descriptors("write novel chapter");
  const userPrompt = buildXiaoshuoUserPrompt({
    premise: args.premise,
    priorOutline: args.priorOutline,
    chapterNumber: args.chapterNumber,
    ...(args.skillBody === undefined ? {} : { skillBody: args.skillBody })
  });
  const finalPrompt = args.correction === undefined ? userPrompt : `${userPrompt}\n\n【修订要求】\n${args.correction}`;
  const response = await host.llmGateway.sendLLMRequest({
    requestId: makeLLMRequestId(`xiaoshuo-ch${args.chapterNumber}-${Date.now()}`),
    providerNeutralMessages: [
      { role: "system", content: [{ type: "text", text: XIAOSHUO_SYSTEM_PROMPT }] },
      { role: "user", content: [{ type: "text", text: finalPrompt }] }
    ],
    modelSelection: { provider: host.config.provider.provider, model: host.config.provider.model },
    requiredCapabilities: {},
    streaming: false,
    timeoutMs: 180_000,
    policyDecisionId: decision.value,
    source: meta.source,
    version: meta.version,
    audit: meta.audit
  });
  if (!response.ok) return response;
  const raw = chapterText(response.value.contentBlocks);
  if (raw.length === 0) {
    return domainErr({ module: "xiaoshuo-writer", code: "response_invalid", message: "model returned no chapter text", severity: "error", retryable: true });
  }
  const parsed = parseChapterOutput(raw, args.chapterNumber);
  return ok({ chapter: parsed.chapter, outline: parsed.outline, finishReason: response.value.finishReason });
}

export async function writeNextChapter(
  host: FengHost,
  input: { readonly premise?: string; readonly title?: string; readonly skillBody?: string }
): Promise<Result<WriteChapterResult>> {
  const state = await readNovelState(host);
  const premise = input.premise ?? state?.premise;
  if (premise === undefined || premise.trim().length === 0) {
    return domainErr({ module: "xiaoshuo-writer", code: "invalid_input", message: "premise is required for the first chapter", severity: "warning" });
  }
  const title = state?.title ?? input.title ?? "untitled-novel";
  const prior = state?.chapters ?? [];
  const chapterNumber = prior.length + 1;
  const priorOutline = prior.map((c) => `第${c.number}章：${c.outline}`).join("\n");

  const issues: string[] = [];
  let attempt: ModelAttempt | undefined;
  for (let repair = 0; repair <= MAX_REPAIRS; repair += 1) {
    const correction = repair === 0
      ? undefined
      : `上一稿仅 ${attempt?.chapter.length ?? 0} 字，过短。请在不改变既定情节的前提下扩写到至少 ${MIN_CHAPTER_CHARS} 字，补充场景、对话与细节。`;
    const result = await callModel(host, {
      premise, priorOutline, chapterNumber,
      ...(input.skillBody === undefined ? {} : { skillBody: input.skillBody }),
      ...(correction === undefined ? {} : { correction })
    });
    if (!result.ok) return result;
    attempt = result.value;
    if (attempt.chapter.length >= MIN_CHAPTER_CHARS) break;
    issues.push(`第${chapterNumber}章第${repair + 1}稿仅${attempt.chapter.length}字，低于${MIN_CHAPTER_CHARS}字下限`);
  }
  if (attempt === undefined) {
    return domainErr({ module: "xiaoshuo-writer", code: "response_invalid", message: "no chapter produced", severity: "error" });
  }

  const meta = descriptors("persist novel chapter");
  const path = `chapters/chapter-${String(chapterNumber).padStart(2, "0")}.md`;
  const fileBody = `# ${title} · 第${chapterNumber}章\n\n${attempt.chapter}\n`;
  const written = await host.store.writeTextAtomic(host.workspace, path, fileBody, { reason: "write chapter file", createParents: true });
  if (!written.ok) return written;

  const artifact = await host.artifacts.registerArtifact({
    kind: "candidate_output",
    content: attempt.chapter,
    mediaType: "text/markdown",
    encoding: "utf8",
    source: meta.source,
    version: { schemaVersion: "1.0.0", producerVersion: "xiaoshuo-writer" },
    audit: meta.audit,
    privacyClass: "workspace_private",
    retentionClass: "archive",
    producerModule: "unknown"
  });

  const record: NovelChapterRecord = {
    number: chapterNumber,
    outline: attempt.outline,
    path,
    chars: attempt.chapter.length,
    ...(artifact.ok ? { artifactId: artifact.value.id } : {}),
    ...(issues.length > 0 ? { issues } : {})
  };
  const nextState: NovelState = { premise, title, chapters: [...prior, record] };
  const persisted = await writeNovelState(host, nextState);
  if (!persisted.ok) return persisted;

  return ok({
    chapterNumber,
    path,
    chars: attempt.chapter.length,
    outline: attempt.outline,
    finishReason: attempt.finishReason,
    repaired: issues.length > 0,
    issues
  });
}

export async function writeNovel(
  host: FengHost,
  input: { readonly premise?: string; readonly title?: string; readonly skillBody?: string; readonly chapters: number }
): Promise<Result<readonly WriteChapterResult[]>> {
  const results: WriteChapterResult[] = [];
  for (let i = 0; i < Math.max(1, input.chapters); i += 1) {
    const result = await writeNextChapter(host, {
      ...(input.premise === undefined ? {} : { premise: input.premise }),
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.skillBody === undefined ? {} : { skillBody: input.skillBody })
    });
    if (!result.ok) return results.length === 0 ? result : ok(results);
    results.push(result.value);
  }
  return ok(results);
}

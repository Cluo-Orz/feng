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
}

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

  const decision = await allowNetwork(host, "write novel chapter");
  if (!decision.ok) return decision;
  const meta = descriptors("write novel chapter");
  const response = await host.llmGateway.sendLLMRequest({
    requestId: makeLLMRequestId(`xiaoshuo-ch${chapterNumber}-${Date.now()}`),
    providerNeutralMessages: [
      { role: "system", content: [{ type: "text", text: XIAOSHUO_SYSTEM_PROMPT }] },
      { role: "user", content: [{ type: "text", text: buildXiaoshuoUserPrompt({ premise, priorOutline, chapterNumber, ...(input.skillBody === undefined ? {} : { skillBody: input.skillBody }) }) }] }
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
  const parsed = parseChapterOutput(raw, chapterNumber);
  const path = `chapters/chapter-${String(chapterNumber).padStart(2, "0")}.md`;
  const fileBody = `# ${title} · 第${chapterNumber}章\n\n${parsed.chapter}\n`;
  const written = await host.store.writeTextAtomic(host.workspace, path, fileBody, { reason: "write chapter file", createParents: true });
  if (!written.ok) return written;

  const artifact = await host.artifacts.registerArtifact({
    kind: "candidate_output",
    content: parsed.chapter,
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
    outline: parsed.outline,
    path,
    chars: parsed.chapter.length,
    ...(artifact.ok ? { artifactId: artifact.value.id } : {})
  };
  const nextState: NovelState = { premise, title, chapters: [...prior, record] };
  const persisted = await writeNovelState(host, nextState);
  if (!persisted.ok) return persisted;

  return ok({
    chapterNumber,
    path,
    chars: parsed.chapter.length,
    outline: parsed.outline,
    finishReason: response.value.finishReason
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

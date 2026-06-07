import { ok, type Result } from "../domain/result.js";
import { domainErr } from "../domain/index.js";
import { makeLLMRequestId } from "../llm-gateway/index.js";
import { makePolicyRequestId } from "../policy-boundary/index.js";
import {
  defaultContextPolicy,
  defaultFeedbackRouting,
  defaultNovelTargetWorld,
  defaultQualityRules,
  savePackage,
  PACKAGE_SCHEMA_VERSION,
  type AuthoringRuntimePackage,
  type WritingStrategy
} from "../runtime-package/index.js";
import type { FengHost } from "./runtime-host.js";

export interface GrowAgentInput {
  readonly goal: string;
  readonly name?: string;
  readonly version?: string;
}

export interface GrowAgentResult {
  readonly packagePath: string;
  readonly growUnitId: string;
  readonly readiness: string;
  readonly lifecycle: string;
  readonly strategyChars: number;
}

const DESIGN_PROMPT = [
  "你是 feng 的 agent 设计内核。现在要为一个『连载中文小说写作 agent』设计它的写作策略。",
  "注意：你不是在写小说，而是在设计这个 agent 运行时使用的系统提示与写作原则。",
  "请只输出一个 JSON 对象，字段如下：",
  '{ "systemPrompt": string(该写作 agent 的系统提示，强调连贯、设定一致、年份/人物/地点不漂移、每章输出正文+===OUTLINE===+一句话大纲), ',
  '"stylePrinciples": string[](5条以内中文写作原则), "constraints": string[](5条以内硬性约束，含连续性要求), ',
  '"minChars": number(每章中文正文字数下限), "maxChars": number(每章中文正文字数上限，需符合现代网文连载习惯且与你给的模型能力匹配) }',
  "不要输出 JSON 以外的任何文字。"
].join("\n");

interface DesignedStrategy {
  readonly strategy: WritingStrategy;
  readonly minChars?: number;
  readonly maxChars?: number;
}

function descriptors(host: FengHost, reason: string) {
  const at = new Date().toISOString();
  return {
    source: { kind: "system" as const, origin: "feng-grow-agent", userProvided: false, receivedAt: at, privacyLevel: "workspace_private" as const },
    version: { schemaVersion: "1.0.0", producerVersion: "feng-grow-agent" },
    audit: { createdAt: at, createdBy: "feng-grow-agent", reason }
  };
}

function extractJson(text: string): Record<string, unknown> | undefined {
  const fenced = text.replace(/```json/gi, "```").split("```");
  const candidates = [text, ...fenced];
  for (const candidate of candidates) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return undefined;
}

function parsePositiveInt(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

function toStrategy(parsed: Record<string, unknown> | undefined, fallbackGoal: string): DesignedStrategy {
  const systemPrompt = typeof parsed?.systemPrompt === "string" && parsed.systemPrompt.length > 0
    ? parsed.systemPrompt
    : `你是一个连载中文小说写作 agent。目标：${fallbackGoal}。逐章写作，保持设定、人物、年份、地点与情节连贯；每章输出正文，然后另起一行 ===OUTLINE===，再用一句话概括本章。`;
  const stylePrinciples = Array.isArray(parsed?.stylePrinciples) ? parsed.stylePrinciples.filter((p): p is string => typeof p === "string") : [];
  const constraints = Array.isArray(parsed?.constraints) ? parsed.constraints.filter((c): c is string => typeof c === "string") : [];
  const min = parsePositiveInt(parsed?.minChars);
  const max = parsePositiveInt(parsed?.maxChars);
  return {
    strategy: { systemPrompt, stylePrinciples, constraints },
    ...(min === undefined ? {} : { minChars: min }),
    ...(max === undefined ? {} : { maxChars: max })
  };
}

// The grown agent owns its own length contract. Clamp to sane bounds and ensure
// min < max so a malformed design cannot produce an impossible DoD.
export function grownLengthRule(min: number | undefined, max: number | undefined): { readonly minChars: number; readonly maxChars: number } {
  const lo = Math.max(300, Math.min(min ?? 900, 4000));
  const hi = Math.max(lo + 300, Math.min(max ?? 1500, 8000));
  return { minChars: lo, maxChars: hi };
}

async function designStrategy(host: FengHost): Promise<Result<{ readonly designed: DesignedStrategy; readonly raw: string }>> {
  const meta = descriptors(host, "design writing strategy");
  const decision = await host.policy.evaluateAction({
    requestId: makePolicyRequestId(`grow-agent-net-${Date.now()}`),
    capability: "network.request",
    requestedByModule: "feng-grow-agent",
    workspace: host.workspace.id,
    resourceSummary: `provider:${host.config.provider.provider}`,
    operation: "send",
    reason: "design writing strategy",
    source: meta.source
  }, {
    caller: "feng-grow-agent",
    environment: { hostSandboxAvailable: false, networkAvailable: true, externalEnforcementAvailable: false, secretStoreAvailable: false },
    rules: [{ capability: "network.request", resource: "*", verdict: "allow" }]
  });
  if (!decision.ok) return decision;
  const response = await host.llmGateway.sendLLMRequest({
    requestId: makeLLMRequestId(`grow-agent-design-${Date.now()}`),
    providerNeutralMessages: [
      { role: "system", content: [{ type: "text", text: DESIGN_PROMPT }] },
      { role: "user", content: [{ type: "text", text: "请输出该写作 agent 的策略 JSON。" }] }
    ],
    modelSelection: { provider: host.config.provider.provider, model: host.config.provider.model },
    requiredCapabilities: {},
    streaming: false,
    timeoutMs: 180_000,
    policyDecisionId: decision.value.policyDecisionId,
    source: meta.source,
    version: meta.version,
    audit: meta.audit
  });
  if (!response.ok) return response;
  const raw = response.value.contentBlocks.filter((b) => b.type === "text").map((b) => (b as { text?: string }).text ?? "").join("\n").trim();
  return ok({ designed: toStrategy(extractJson(raw), "成长出一个连贯的连载小说写作 agent"), raw });
}

export async function growXiaoshuoAgent(host: FengHost, input: GrowAgentInput): Promise<Result<GrowAgentResult>> {
  const meta = descriptors(host, "grow xiaoshuo agent");
  const name = input.name ?? "xiaoshuo";
  const grow = await host.grow.createGrowUnit({
    title: name,
    goalBoundarySummary: input.goal,
    targetBehaviorSummary: "接收作品设定/前情/反馈，输出连贯章节与大纲，并形成反馈候选。",
    source: meta.source, version: meta.version, audit: meta.audit
  });
  if (!grow.ok) return grow;
  const agenda = await host.agenda.createAgenda(grow.value, {
    goalBoundarySummary: input.goal, currentFocus: "设计并验证小说写作 agent 的运行策略",
    source: meta.source, version: meta.version, audit: meta.audit
  });
  if (!agenda.ok) return agenda;
  const dod = await host.agenda.defineDoD(grow.value, {
    statement: "写作 agent 能在作品项目中产出连贯、设定一致、字数达标的章节，并形成可归因反馈。",
    scope: "xiaoshuo runtime hatch gate",
    evidenceRequirement: "存在已验证的写作策略与质量/反馈契约",
    validationIntent: "sample run + structural quality checks",
    source: meta.source, version: meta.version, audit: meta.audit
  });
  if (!dod.ok) return dod;

  const designed = await designStrategy(host);
  if (!designed.ok) return designed;

  // Advance the grow unit through its real lifecycle so it does not sit at
  // intake: created -> planning -> growing -> verifying, then ready_to_hatch
  // via the readiness verdict.
  for (const to of ["planning", "growing", "verifying"] as const) {
    const moved = await host.grow.transitionGrowUnit(grow.value, { to, reason: `advance to ${to} while growing the agent`, source: meta.source, audit: meta.audit });
    if (!moved.ok) return moved;
  }

  const evidence = await host.evidence.recordEvidenceCandidate({
    growUnitRef: grow.value,
    sourceKind: "candidate_output",
    summary: "grown writing strategy for the xiaoshuo runtime",
    content: JSON.stringify(designed.value.designed.strategy, null, 2),
    artifactKind: "candidate_output",
    relationHints: [{ relation: "supports", relatedDoDRef: dod.value, criticality: "critical", reason: "writing strategy satisfies the hatch DoD" }],
    quality: { trustLevel: "strong" },
    source: meta.source, version: meta.version, audit: meta.audit
  });
  if (!evidence.ok) return evidence;
  const accepted = await host.evidence.acceptEvidenceForEvaluation(evidence.value, { reason: "accept grown strategy", source: meta.source, audit: meta.audit });
  if (!accepted.ok) return accepted;
  const assessment = await host.evidence.assessReadiness(grow.value, { evidenceRefs: [evidence.value], source: meta.source, audit: meta.audit });
  if (!assessment.ok) return assessment;
  const verdict = await host.evidence.produceReadinessVerdict(assessment.value.readinessAssessmentRef);
  if (!verdict.ok) return verdict;

  const applied = await host.grow.applyReadinessVerdict(grow.value, {
    readinessVerdictRef: verdict.value.artifactRef,
    verdict: { verdict: verdict.value.verdict, reason: verdict.value.reason, evidenceRefs: verdict.value.evidenceArtifactRefs },
    reason: "apply readiness verdict from grown strategy",
    source: meta.source, audit: meta.audit
  });
  if (!applied.ok) return applied;
  const finalRecord = await host.grow.getGrowUnit(grow.value);
  const lifecycle = finalRecord.ok ? finalRecord.value.lifecycle : "unknown";

  const length = grownLengthRule(designed.value.designed.minChars, designed.value.designed.maxChars);
  const qualityRules = defaultQualityRules.map((r) => (r.kind === "length" ? { ...r, minChars: length.minChars, maxChars: length.maxChars, note: `每章中文字数区间(由 agent grow 得出)` } : r));

  const pkg: AuthoringRuntimePackage = {
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    packageId: `pkg-${grow.value.id}`,
    name,
    kind: "serialized_authoring_agent",
    version: input.version ?? "1.0.0",
    locked: true,
    runEntry: "feng run",
    targetWorld: defaultNovelTargetWorld,
    contextPolicy: defaultContextPolicy,
    writingStrategy: designed.value.designed.strategy,
    qualityRules,
    feedbackRouting: defaultFeedbackRouting,
    validation: {
      readiness: verdict.value.verdict === "ready_to_hatch" ? "ready" : "draft",
      grownInProject: host.config.workspaceRoot,
      grownByGrowUnitId: grow.value.id,
      evidenceSummary: `verdict=${verdict.value.verdict}; ${verdict.value.reason}`,
      checkedAt: new Date().toISOString()
    },
    provenance: { model: host.config.provider.model, provider: host.config.provider.provider, hatchedAt: new Date().toISOString() }
  };
  const saved = await savePackage(host.store, host.workspace, pkg);
  if (!saved.ok) return saved;
  if (designed.value.designed.strategy.systemPrompt.length === 0) {
    return domainErr({ module: "feng-grow-agent", code: "invalid_state", message: "grown strategy is empty", severity: "error" });
  }
  return ok({ packagePath: saved.value, growUnitId: grow.value.id, readiness: verdict.value.verdict, lifecycle, strategyChars: designed.value.designed.strategy.systemPrompt.length });
}

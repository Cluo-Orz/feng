import type { FengHost } from "./runtime-host.js";
import { createFengHost } from "./runtime-host.js";
import { loadFengConfig } from "./config.js";
import { writeNovel } from "./xiaoshuo-writer.js";
import { superviseNovel } from "./supervisor.js";
import { growXiaoshuoAgent } from "./grow-agent.js";
import { routeProjectFeedback } from "./feedback-router.js";
import { loadPackage } from "../runtime-package/index.js";
import { runChapters, type AuthoringRuntimeDeps } from "../authoring-runtime/index.js";

export type Out = (text: string) => void;

export function flagValue(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
}

function intFlag(argv: readonly string[], name: string, fallback: number): number {
  const raw = flagValue(argv, name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function runWrite(host: FengHost, argv: readonly string[], stdout: Out, stderr: Out): Promise<number> {
  const premise = flagValue(argv, "--premise");
  const title = flagValue(argv, "--title");
  const result = await writeNovel(host, {
    chapters: intFlag(argv, "--chapters", 1),
    ...(premise === undefined ? {} : { premise }),
    ...(title === undefined ? {} : { title })
  });
  if (!result.ok) {
    stderr(`feng write error [${result.error.code}]: ${result.error.message}`);
    return 1;
  }
  for (const chapter of result.value) {
    stdout(`[chapter ${chapter.chapterNumber}] ${chapter.chars} chars -> ${chapter.path} (${chapter.finishReason})`);
  }
  return 0;
}

export async function runSupervise(host: FengHost, argv: readonly string[], stdout: Out, stderr: Out): Promise<number> {
  const target = flagValue(argv, "--target");
  if (target === undefined) {
    stderr("feng supervise error: --target <dir> is required");
    return 2;
  }
  const minRaw = flagValue(argv, "--min-chars");
  const result = await superviseNovel(host, {
    targetRoot: target,
    ...(minRaw === undefined ? {} : { minChars: Math.max(1, Number.parseInt(minRaw, 10) || 800) })
  });
  if (!result.ok) {
    stderr(`feng supervise error [${result.error.code}]: ${result.error.message}`);
    return 1;
  }
  const report = result.value;
  stdout(`[supervise] target=${report.targetRoot} chapters=${report.chaptersFound} issues=${report.issues.length} feedbackCandidates=${report.feedbackCandidateCount}`);
  for (const issue of report.issues) {
    stdout(`  - (${issue.kind}${issue.chapter === undefined ? "" : ` ch${issue.chapter}`}) ${issue.detail}`);
  }
  return 0;
}

export async function runGrowAgent(host: FengHost, argv: readonly string[], stdout: Out, stderr: Out): Promise<number> {
  const goal = flagValue(argv, "--goal");
  if (goal === undefined) {
    stderr("feng grow-agent error: --goal <text> is required");
    return 2;
  }
  const name = flagValue(argv, "--name");
  const version = flagValue(argv, "--version");
  const result = await growXiaoshuoAgent(host, {
    goal,
    ...(name === undefined ? {} : { name }),
    ...(version === undefined ? {} : { version })
  });
  if (!result.ok) {
    stderr(`feng grow-agent error [${result.error.code}]: ${result.error.message}`);
    return 1;
  }
  stdout(`[grow-agent] hatched ${result.value.packagePath}`);
  stdout(`  growUnit=${result.value.growUnitId} lifecycle=${result.value.lifecycle} readiness=${result.value.readiness} strategyChars=${result.value.strategyChars}`);
  return 0;
}

export async function runRouteFeedback(host: FengHost, argv: readonly string[], stdout: Out, stderr: Out, fetchImpl?: import("../providers/index.js").FetchLike): Promise<number> {
  const target = flagValue(argv, "--target");
  if (target === undefined) {
    stderr("feng route-feedback error: --target <work-dir> is required");
    return 2;
  }
  const buildHost = async (root: string): Promise<FengHost> => {
    const config = await loadFengConfig({ workspaceRoot: root, processEnv: { DEEPSEEK_API_KEY: host.config.provider.apiKey, MODEL: host.config.provider.model, OPEN_AI_BASE_URL: host.config.provider.baseUrl } });
    return createFengHost({ config, ...(fetchImpl === undefined ? {} : { fetchImpl }) });
  };
  const workHost = await buildHost(target);
  const agentDir = flagValue(argv, "--agent-dir");
  const fengDir = flagValue(argv, "--feng-dir");
  const result = await routeProjectFeedback({
    workHost,
    ...(agentDir === undefined ? {} : { agentHost: await buildHost(agentDir) }),
    ...(fengDir === undefined ? {} : { fengHost: await buildHost(fengDir) })
  });
  if (!result.ok) {
    stderr(`feng route-feedback error [${result.error.code}]: ${result.error.message}`);
    return 1;
  }
  const r = result.value;
  stdout(`[route-feedback] total=${r.totalCandidates} work(kept-local)=${r.keptLocal} capability->agent=${r.absorbedToAgent} system->feng=${r.absorbedToFeng}`);
  return 0;
}

export async function runRun(host: FengHost, argv: readonly string[], stdout: Out, stderr: Out): Promise<number> {
  const pkgPath = flagValue(argv, "--package");
  const pkg = await loadPackage(host.store, host.workspace, pkgPath);
  if (!pkg.ok) {
    stderr(`feng run error [${pkg.error.code}]: ${pkg.error.message}`);
    return 1;
  }
  const deps: AuthoringRuntimeDeps = {
    store: host.store,
    workspace: host.workspace,
    llmGateway: host.llmGateway,
    policy: host.policy,
    provider: host.config.provider.provider,
    model: host.config.provider.model,
    ...(argv.includes("--semantic-eval") ? { semanticEval: true } : {})
  };
  const result = await runChapters(deps, pkg.value, intFlag(argv, "--chapters", 1));
  if (!result.ok) {
    stderr(`feng run error [${result.error.code}]: ${result.error.message}`);
    return 1;
  }
  stdout(`[run] package=${pkg.value.name}@${pkg.value.version} chapters=${result.value.length}`);
  for (const chapter of result.value) {
    const layers = chapter.feedback.byLayer;
    const semantic = chapter.semantic === undefined ? "" : ` semantic=${chapter.semantic.overall}/10`;
    stdout(`  ch${chapter.chapterNumber}: ${chapter.chars} chars, quality=${chapter.qualityPassed ? "pass" : "FAIL"}, issues=${chapter.quality.issues.length} (work=${layers.work} capability=${layers.capability} system=${layers.system})${semantic} -> ${chapter.artifactDir}`);
    for (const issue of chapter.quality.issues) {
      stdout(`     · ${issue.kind}[${issue.severity}]: ${issue.detail}`);
    }
  }
  return 0;
}

import { stat } from "node:fs/promises";
import type { FengHost } from "./runtime-host.js";
import { createFengHost } from "./runtime-host.js";
import { loadFengConfig } from "./config.js";
import { writeNovel } from "./xiaoshuo-writer.js";
import { superviseNovel } from "./supervisor.js";
import { growXiaoshuoAgent } from "./grow-agent.js";
import { growXiaoshuoAgentLoop } from "./grow-loop.js";
import { resolveSystemFeedback, routeProjectFeedback, type SystemFeedbackDecision } from "./feedback-router.js";
import { ensureRuntimePackageLock, installRuntimePackage, loadPackageWithMetadata, readRuntimePackageInstall } from "../runtime-package/index.js";
import {
  applyAuthorFeedbackGateReview,
  applyWorkGateReview,
  formatQualityGateSummary,
  recordAuthorFeedback,
  runChapters,
  writeRuntimeDebugReport,
  WORK_CHAPTER_GATE_REVIEW_FILE,
  WORK_CHAPTER_QUALITY_GATE_FILE,
  type AuthoringRuntimeDeps,
  type QualityGateSet,
  type WorkGateReview,
  type WorkGateReviewDecision
} from "../authoring-runtime/index.js";

export type Out = (text: string) => void;

function formatCacheSummary(summary: { readonly calls: number; readonly inputTokens: number; readonly cacheReadTokens: number; readonly cacheHitRatePct: number; readonly zeroCacheReadCalls: number }): string {
  return `cache=${summary.cacheHitRatePct}% (${summary.cacheReadTokens}/${summary.inputTokens} input tokens, calls=${summary.calls}, zero=${summary.zeroCacheReadCalls})`;
}

export function flagValue(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
}

function flagValues(argv: readonly string[], name: string): readonly string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === name && argv[i + 1] !== undefined) values.push(argv[i + 1] as string);
  }
  return values;
}

function intFlag(argv: readonly string[], name: string, fallback: number): number {
  const raw = flagValue(argv, name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function existingDirectory(root: string | undefined): Promise<string | undefined> {
  if (root === undefined || root.trim().length === 0) return undefined;
  try {
    const info = await stat(root);
    return info.isDirectory() ? root : undefined;
  } catch {
    return undefined;
  }
}

async function inferAgentDirFromRuntimePackage(host: FengHost): Promise<string | undefined> {
  const loaded = await loadPackageWithMetadata(host.store, host.workspace);
  if (!loaded.ok) return undefined;
  return existingDirectory(loaded.value.pkg.validation.grownInProject);
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
  if (argv.includes("--loop")) {
    const loop = await growXiaoshuoAgentLoop(host, {
      goal,
      ...(name === undefined ? {} : { name }),
      ...(flagValue(argv, "--rounds") === undefined ? {} : { maxRounds: intFlag(argv, "--rounds", 2) }),
      ...(flagValue(argv, "--sample-chapters") === undefined ? {} : { sampleChapters: intFlag(argv, "--sample-chapters", 2) })
    });
    if (!loop.ok) {
      stderr(`feng grow-agent error [${loop.error.code}]: ${loop.error.message}`);
      return 1;
    }
    stdout(`[grow-agent --loop] ${loop.value.packagePath} growUnit=${loop.value.growUnitId} lifecycle=${loop.value.lifecycle} readiness=${loop.value.readiness}`);
    if (loop.value.seededConstraints.length > 0) {
      stdout(`  seeded ${loop.value.seededConstraints.length} constraint(s) from downstream capability feedback`);
    }
    if (loop.value.capabilityAdoptionPath !== undefined) {
      stdout(`  capability adoption: ${loop.value.capabilityAdoptionPath}`);
    }
    for (const r of loop.value.rounds) {
      stdout(`  round ${r.round} (v${r.version}): chapters=${r.chapters} fail=${r.failChapters} capabilityIssues=[${r.capabilityIssueKinds.join(",")}] added=${r.addedConstraints.length} ${formatCacheSummary(r.llmUsage)}`);
    }
    stdout(`  improved=${loop.value.improved} finalCapabilityIssues=${loop.value.finalCapabilityIssues} ${formatCacheSummary(loop.value.llmUsage)}`);
    return 0;
  }
  const result = await growXiaoshuoAgent(host, {
    goal,
    ...(name === undefined ? {} : { name }),
    ...(version === undefined ? {} : { version })
  });
  if (!result.ok) {
    stderr(`feng grow-agent error [${result.error.code}]: ${result.error.message}`);
    return 1;
  }
  stdout(`[grow-agent] drafted ${result.value.packagePath}`);
  stdout(`  growUnit=${result.value.growUnitId} lifecycle=${result.value.lifecycle} readiness=${result.value.readiness} strategyChars=${result.value.strategyChars}`);
  stdout(`  ${formatCacheSummary(result.value.llmUsage)}`);
  stdout("  design-only draft: run `feng grow-agent --loop` to produce sample-run evidence and a locked hatch package");
  return 0;
}

export async function runGrow(host: FengHost, argv: readonly string[], stdout: Out, stderr: Out): Promise<number> {
  const goal = flagValue(argv, "--goal");
  if (goal === undefined) {
    stderr("feng grow error: --goal <text> is required for high-level agent grow");
    return 2;
  }
  const name = flagValue(argv, "--name") ?? flagValue(argv, "--agent") ?? "agent";
  const draftOnly = argv.includes("--draft");
  if (!draftOnly) {
    const loop = await growXiaoshuoAgentLoop(host, {
      goal,
      name,
      ...(flagValue(argv, "--rounds") === undefined ? {} : { maxRounds: intFlag(argv, "--rounds", 2) }),
      ...(flagValue(argv, "--sample-chapters") === undefined ? {} : { sampleChapters: intFlag(argv, "--sample-chapters", 2) })
    });
    if (!loop.ok) {
      stderr(`feng grow error [${loop.error.code}]: ${loop.error.message}`);
      return 1;
    }
    stdout(`[grow] ${loop.value.packagePath} growUnit=${loop.value.growUnitId} lifecycle=${loop.value.lifecycle} readiness=${loop.value.readiness}`);
    if (loop.value.seededConstraints.length > 0) {
      stdout(`  seeded ${loop.value.seededConstraints.length} constraint(s) from downstream capability feedback`);
    }
    if (loop.value.capabilityAdoptionPath !== undefined) {
      stdout(`  capability adoption: ${loop.value.capabilityAdoptionPath}`);
    }
    for (const r of loop.value.rounds) {
      stdout(`  round ${r.round} (v${r.version}): chapters=${r.chapters} fail=${r.failChapters} capabilityIssues=[${r.capabilityIssueKinds.join(",")}] added=${r.addedConstraints.length} ${formatCacheSummary(r.llmUsage)}`);
    }
    stdout(`  improved=${loop.value.improved} finalCapabilityIssues=${loop.value.finalCapabilityIssues} ${formatCacheSummary(loop.value.llmUsage)}`);
    return 0;
  }
  const version = flagValue(argv, "--version");
  const result = await growXiaoshuoAgent(host, { goal, name, ...(version === undefined ? {} : { version }) });
  if (!result.ok) {
    stderr(`feng grow error [${result.error.code}]: ${result.error.message}`);
    return 1;
  }
  stdout(`[grow] drafted ${result.value.packagePath}`);
  stdout(`  growUnit=${result.value.growUnitId} lifecycle=${result.value.lifecycle} readiness=${result.value.readiness} strategyChars=${result.value.strategyChars}`);
  stdout(`  ${formatCacheSummary(result.value.llmUsage)}`);
  stdout("  design-only draft: rerun `feng grow --goal <text>` without --draft to produce sample-run evidence and a locked hatch package");
  return 0;
}

export async function runRouteFeedback(host: FengHost, argv: readonly string[], stdout: Out, stderr: Out, fetchImpl?: import("../providers/index.js").FetchLike): Promise<number> {
  const buildHost = async (root: string): Promise<FengHost> => {
    const config = await loadFengConfig({ workspaceRoot: root, processEnv: { DEEPSEEK_API_KEY: host.config.provider.apiKey, MODEL: host.config.provider.model, OPEN_AI_BASE_URL: host.config.provider.baseUrl } });
    return createFengHost({ config, ...(fetchImpl === undefined ? {} : { fetchImpl }) });
  };
  const target = flagValue(argv, "--target");
  const workHost = target === undefined ? host : await buildHost(target);
  const installed = await readRuntimePackageInstall(workHost.store, workHost.workspace);
  if (!installed.ok) {
    stderr(`feng route-feedback error [${installed.error.code}]: ${installed.error.message}`);
    return 1;
  }
  const packageAgentDir = flagValue(argv, "--agent-dir") === undefined && installed.value?.sourceWorkspaceRoot === undefined
    ? await inferAgentDirFromRuntimePackage(workHost)
    : undefined;
  const agentDir = flagValue(argv, "--agent-dir") ?? installed.value?.sourceWorkspaceRoot ?? packageAgentDir;
  const fengDir = flagValue(argv, "--feng-dir") ?? installed.value?.systemWorkspaceRoot;
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
  if (agentDir !== undefined && flagValue(argv, "--agent-dir") === undefined) stdout(`  inferred agent: ${agentDir}`);
  if (fengDir !== undefined && flagValue(argv, "--feng-dir") === undefined) stdout(`  inferred feng: ${fengDir}`);
  if (r.capabilityDigestPath !== undefined) stdout(`  capability digest: ${r.capabilityDigestPath}`);
  if (r.systemDigestPath !== undefined) stdout(`  system digest: ${r.systemDigestPath}`);
  return 0;
}

export async function runInstallRuntime(host: FengHost, argv: readonly string[], stdout: Out, stderr: Out, fetchImpl?: import("../providers/index.js").FetchLike): Promise<number> {
  const explicitSourceDir = flagValue(argv, "--from") ?? flagValue(argv, "--agent-dir");
  const explicitFengDir = flagValue(argv, "--feng-dir");
  const buildHost = async (root: string): Promise<FengHost> => {
    const config = await loadFengConfig({ workspaceRoot: root, processEnv: { DEEPSEEK_API_KEY: host.config.provider.apiKey, MODEL: host.config.provider.model, OPEN_AI_BASE_URL: host.config.provider.baseUrl } });
    return createFengHost({ config, ...(fetchImpl === undefined ? {} : { fetchImpl }) });
  };
  const targetHost = flagValue(argv, "--target") === undefined ? host : await buildHost(flagValue(argv, "--target") as string);
  const existingInstall = await readRuntimePackageInstall(targetHost.store, targetHost.workspace);
  if (!existingInstall.ok && explicitSourceDir === undefined) {
    stderr(`feng install-runtime error [${existingInstall.error.code}]: ${existingInstall.error.message}`);
    return 1;
  }
  const packageAgentDir = explicitSourceDir === undefined && existingInstall.ok && existingInstall.value?.sourceWorkspaceRoot === undefined
    ? await inferAgentDirFromRuntimePackage(targetHost)
    : undefined;
  const sourceDir = explicitSourceDir ?? (existingInstall.ok ? existingInstall.value?.sourceWorkspaceRoot : undefined) ?? packageAgentDir;
  if (sourceDir === undefined) {
    stderr("feng install-runtime error: --from <agent-dir> is required unless the target has a prior install record or runtime package grownInProject");
    return 2;
  }
  const systemWorkspaceRoot = explicitFengDir ?? (existingInstall.ok ? existingInstall.value?.systemWorkspaceRoot : undefined);
  const sourceHost = await buildHost(sourceDir);
  const loaded = await loadPackageWithMetadata(sourceHost.store, sourceHost.workspace, flagValue(argv, "--package"));
  if (!loaded.ok) {
    stderr(`feng install-runtime error [${loaded.error.code}]: ${loaded.error.message}`);
    return 1;
  }
  const result = await installRuntimePackage(targetHost.store, targetHost.workspace, loaded.value, {
    sourceWorkspaceRoot: String(sourceHost.workspace.root),
    sourcePackagePath: loaded.value.packagePath,
    ...(systemWorkspaceRoot === undefined ? {} : { systemWorkspaceRoot }),
    allowUnlocked: argv.includes("--allow-unlocked"),
    acceptUpdate: argv.includes("--accept-package-update"),
    reason: flagValue(argv, "--reason") ?? `install runtime package from ${sourceHost.workspace.root}`
  });
  if (!result.ok) {
    stderr(`feng install-runtime error [${result.error.code}]: ${result.error.message}`);
    return 1;
  }
  let packageLockStatus: { readonly status: string; readonly lockPath: string } | undefined;
  if (loaded.value.pkg.locked) {
    const installed = await loadPackageWithMetadata(targetHost.store, targetHost.workspace);
    if (!installed.ok) {
      stderr(`feng install-runtime error [${installed.error.code}]: ${installed.error.message}`);
      return 1;
    }
    const packageLock = await ensureRuntimePackageLock(targetHost.store, targetHost.workspace, installed.value, {
      acceptUpdate: argv.includes("--accept-package-update"),
      reason: argv.includes("--accept-package-update")
        ? "operator accepted runtime package update during install-runtime"
        : "install-runtime accepted locked runtime package"
    });
    if (!packageLock.ok) {
      stderr(`feng install-runtime error [${packageLock.error.code}]: ${packageLock.error.message}`);
      return 1;
    }
    packageLockStatus = packageLock.value;
  }
  stdout(`[install-runtime] ${loaded.value.pkg.name}@${loaded.value.pkg.version} ${result.value.status} -> ${result.value.packagePath}`);
  stdout(`  install record: ${result.value.installPath}`);
  if (packageLockStatus !== undefined) stdout(`  package lock ${packageLockStatus.status}: ${packageLockStatus.lockPath}`);
  stdout(`  source: ${sourceHost.workspace.root}:${loaded.value.packagePath}`);
  stdout(`  hash: ${result.value.contentHash.value}`);
  return 0;
}

function chapterRuntimeDir(chapterNumber: number): string {
  return `.feng/runtime/chapters/chapter-${String(chapterNumber).padStart(2, "0")}`;
}

export async function runResolveSystemFeedback(host: FengHost, argv: readonly string[], stdout: Out, stderr: Out): Promise<number> {
  const issueKind = flagValue(argv, "--issue-kind");
  const reason = flagValue(argv, "--reason");
  const rawDecision = flagValue(argv, "--decision") ?? "resolved";
  if (issueKind === undefined) {
    stderr("feng resolve-system-feedback error: --issue-kind <kind> is required");
    return 2;
  }
  if (reason === undefined) {
    stderr("feng resolve-system-feedback error: --reason <text> is required");
    return 2;
  }
  if (rawDecision !== "resolved" && rawDecision !== "rejected") {
    stderr("feng resolve-system-feedback error: --decision must be resolved or rejected");
    return 2;
  }
  const result = await resolveSystemFeedback(host, {
    issueKind,
    reason,
    decision: rawDecision as SystemFeedbackDecision,
    evidenceRefs: flagValues(argv, "--evidence"),
    feedbackKeys: flagValues(argv, "--feedback-key")
  });
  if (!result.ok) {
    stderr(`feng resolve-system-feedback error [${result.error.code}]: ${result.error.message}`);
    return 1;
  }
  stdout(`[resolve-system-feedback] ${issueKind} ${rawDecision} -> ${result.value}`);
  return 0;
}

export async function runReviewWorkGate(host: FengHost, argv: readonly string[], stdout: Out, stderr: Out): Promise<number> {
  const rawChapter = flagValue(argv, "--chapter");
  const gateId = flagValue(argv, "--gate");
  const reason = flagValue(argv, "--reason");
  const rawDecision = flagValue(argv, "--decision");
  const reviewer = flagValue(argv, "--reviewer");
  if (rawChapter === undefined) {
    stderr("feng review-work-gate error: --chapter <n> is required");
    return 2;
  }
  const chapterNumber = Number.parseInt(rawChapter, 10);
  if (!Number.isFinite(chapterNumber) || chapterNumber <= 0) {
    stderr("feng review-work-gate error: --chapter must be a positive integer");
    return 2;
  }
  if (gateId === undefined) {
    stderr("feng review-work-gate error: --gate <gate-id> is required");
    return 2;
  }
  if (rawDecision !== "passed" && rawDecision !== "failed") {
    stderr("feng review-work-gate error: --decision must be passed or failed");
    return 2;
  }
  if (reason === undefined || reason.trim().length === 0) {
    stderr("feng review-work-gate error: --reason <text> is required");
    return 2;
  }
  const dir = chapterRuntimeDir(chapterNumber);
  const gatePath = `${dir}/${WORK_CHAPTER_QUALITY_GATE_FILE}`;
  const read = await host.store.readText(host.workspace, gatePath, { reason: "read work quality gates for review", maxBytes: 512 * 1024 });
  if (!read.ok) {
    stderr(`feng review-work-gate error [${read.error.code}]: ${read.error.message}`);
    return 1;
  }
  let gateSet: QualityGateSet;
  try {
    gateSet = JSON.parse(read.value.content) as QualityGateSet;
  } catch {
    stderr("feng review-work-gate error [schema_incompatible]: quality-gates.json is invalid JSON");
    return 1;
  }
  if (!gateSet.gates.some((gate) => gate.gateId === gateId)) {
    stderr(`feng review-work-gate error [not_found]: gate ${gateId} does not exist in ${gatePath}`);
    return 1;
  }
  const review: WorkGateReview = {
    schemaVersion: "1.0.0",
    kind: "work_gate_review",
    gateId,
    decision: rawDecision as WorkGateReviewDecision,
    reason,
    ...(reviewer === undefined ? {} : { reviewer }),
    reviewedAt: new Date().toISOString()
  };
  const reviewPath = `${dir}/${WORK_CHAPTER_GATE_REVIEW_FILE}`;
  const wroteReview = await host.store.writeTextAtomic(host.workspace, reviewPath, JSON.stringify(review, null, 2), {
    reason: "write work gate review",
    createParents: true
  });
  if (!wroteReview.ok) {
    stderr(`feng review-work-gate error [${wroteReview.error.code}]: ${wroteReview.error.message}`);
    return 1;
  }
  const updated = applyWorkGateReview(gateSet, review);
  const wroteGates = await host.store.writeTextAtomic(host.workspace, gatePath, JSON.stringify(updated, null, 2), {
    reason: "apply work gate review",
    createParents: true
  });
  if (!wroteGates.ok) {
    stderr(`feng review-work-gate error [${wroteGates.error.code}]: ${wroteGates.error.message}`);
    return 1;
  }
  const authorFeedbackSync = await applyAuthorFeedbackGateReview(host, {
    chapterNumber,
    gateId,
    decision: review.decision,
    reason: review.reason,
    reviewedAt: review.reviewedAt,
    reviewPath,
    ...(review.reviewer === undefined ? {} : { reviewer: review.reviewer })
  });
  if (!authorFeedbackSync.ok) {
    stderr(`feng review-work-gate error [${authorFeedbackSync.error.code}]: ${authorFeedbackSync.error.message}`);
    return 1;
  }
  const tracePath = `${dir}/trace.json`;
  let traceUpdated = false;
  const traceRead = await host.store.readText(host.workspace, tracePath, { reason: "read runtime trace for gate review sync", maxBytes: 512 * 1024 });
  if (traceRead.ok) {
    let trace: Record<string, unknown>;
    try {
      const parsed = JSON.parse(traceRead.value.content) as unknown;
      trace = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      trace = {};
    }
    const wroteTrace = await host.store.writeTextAtomic(host.workspace, tracePath, JSON.stringify({
      ...trace,
      qualityGateRef: gatePath,
      qualityGateSummary: formatQualityGateSummary(updated.summary),
      qualityGateReviewRef: reviewPath,
      qualityGateReviewedGateId: review.gateId,
      qualityGateReviewedDecision: review.decision,
      qualityGateReviewedAt: review.reviewedAt
    }, null, 2), {
      reason: "sync runtime trace after work gate review",
      createParents: true
    });
    if (!wroteTrace.ok) {
      stderr(`feng review-work-gate error [${wroteTrace.error.code}]: ${wroteTrace.error.message}`);
      return 1;
    }
    traceUpdated = true;
  }
  stdout(`[review-work-gate] ch${chapterNumber} ${gateId} ${rawDecision} -> ${gatePath}`);
  stdout(`  review: ${reviewPath}`);
  if (authorFeedbackSync.value !== undefined) stdout(`  author feedback: ${authorFeedbackSync.value.authorFeedbackPath} (${authorFeedbackSync.value.updatedCount})`);
  if (traceUpdated) stdout(`  trace: ${tracePath}`);
  stdout(`  ${formatQualityGateSummary(updated.summary)}`);
  return 0;
}

export async function runAuthorFeedback(host: FengHost, argv: readonly string[], stdout: Out, stderr: Out): Promise<number> {
  const rawChapter = flagValue(argv, "--chapter");
  const content = flagValue(argv, "--text") ?? flagValue(argv, "--content");
  const rawLayer = flagValue(argv, "--layer") ?? "work";
  const rawSeverity = flagValue(argv, "--severity") ?? "warning";
  const issueKind = flagValue(argv, "--issue-kind");
  const suggestedAction = flagValue(argv, "--action");
  const reviewer = flagValue(argv, "--reviewer");
  if (rawChapter === undefined) {
    stderr("feng author-feedback error: --chapter <n> is required");
    return 2;
  }
  const chapterNumber = Number.parseInt(rawChapter, 10);
  if (!Number.isFinite(chapterNumber) || chapterNumber <= 0) {
    stderr("feng author-feedback error: --chapter must be a positive integer");
    return 2;
  }
  if (content === undefined || content.trim().length === 0) {
    stderr("feng author-feedback error: --text <feedback> is required");
    return 2;
  }
  if (rawLayer !== "work" && rawLayer !== "capability" && rawLayer !== "system") {
    stderr("feng author-feedback error: --layer must be work, capability, or system");
    return 2;
  }
  if (rawSeverity !== "warning" && rawSeverity !== "error") {
    stderr("feng author-feedback error: --severity must be warning or error");
    return 2;
  }
  const result = await recordAuthorFeedback(host, {
    chapterNumber,
    content,
    layer: rawLayer,
    severity: rawSeverity,
    ...(issueKind === undefined ? {} : { issueKind }),
    ...(suggestedAction === undefined ? {} : { suggestedAction }),
    ...(reviewer === undefined ? {} : { reviewer })
  });
  if (!result.ok) {
    stderr(`feng author-feedback error [${result.error.code}]: ${result.error.message}`);
    return 1;
  }
  stdout(`[author-feedback] ch${chapterNumber} ${rawLayer}/${issueKind ?? "author_feedback"} -> ${result.value.authorFeedbackPath}`);
  stdout(`  candidate: ${result.value.feedbackPath}`);
  stdout(`  gate: ${result.value.qualityGatePath}`);
  stdout(`  trace: ${result.value.tracePath}`);
  return 0;
}

export async function runRun(host: FengHost, argv: readonly string[], stdout: Out, stderr: Out): Promise<number> {
  const pkgPath = flagValue(argv, "--package");
  const loaded = await loadPackageWithMetadata(host.store, host.workspace, pkgPath);
  if (!loaded.ok) {
    stderr(`feng run error [${loaded.error.code}]: ${loaded.error.message}`);
    return 1;
  }
  const pkg = loaded.value.pkg;
  // Concept (product-concept 210): a published runtime stays version-locked and
  // must not silently drift. Refuse to run an unlocked/draft package unless the
  // operator explicitly opts in.
  if (!pkg.locked && !argv.includes("--allow-unlocked")) {
    stderr(`feng run error [production_lock_violation]: package ${pkg.name}@${pkg.version} is not locked (validation.readiness=${pkg.validation.readiness}); re-hatch a locked package or pass --allow-unlocked`);
    return 1;
  }
  const packageLock = pkg.locked
    ? await ensureRuntimePackageLock(host.store, host.workspace, loaded.value, {
      acceptUpdate: argv.includes("--accept-package-update"),
      reason: argv.includes("--accept-package-update") ? "operator accepted runtime package update" : "first production run of locked runtime package"
    })
    : undefined;
  if (packageLock !== undefined && !packageLock.ok) {
    stderr(`feng run error [${packageLock.error.code}]: ${packageLock.error.message}`);
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
  const result = await runChapters(deps, pkg, intFlag(argv, "--chapters", 1));
  if (!result.ok) {
    stderr(`feng run error [${result.error.code}]: ${result.error.message}`);
    return 1;
  }
  let debugReportPath: string | undefined;
  if (argv.includes("--debug-report")) {
    const report = await writeRuntimeDebugReport(host, {
      pkg,
      packagePath: loaded.value.packagePath,
      contentHash: loaded.value.contentHash,
      ...(packageLock === undefined ? { packageLockStatus: "not_applicable" as const } : { packageLockPath: packageLock.value.lockPath, packageLockStatus: packageLock.value.status }),
      chapters: result.value
    });
    if (!report.ok) {
      stderr(`feng run error [${report.error.code}]: ${report.error.message}`);
      return 1;
    }
    debugReportPath = report.value;
  }
  stdout(`[run] package=${pkg.name}@${pkg.version} chapters=${result.value.length}`);
  if (packageLock !== undefined) stdout(`  package lock ${packageLock.value.status}: ${packageLock.value.lockPath}`);
  if (debugReportPath !== undefined) stdout(`  debug report: ${debugReportPath}`);
  for (const chapter of result.value) {
    const layers = chapter.feedback.byLayer;
    const semantic = chapter.semantic === undefined ? "" : ` semantic=${chapter.semantic.overall}/10`;
    stdout(`  ch${chapter.chapterNumber}: ${chapter.chars} chars, quality=${chapter.quality.status}, issues=${chapter.quality.issues.length} (work=${layers.work} capability=${layers.capability} system=${layers.system})${semantic}, ${chapter.qualityGateSummary}, ${formatCacheSummary(chapter.llmUsage)} -> ${chapter.artifactDir}`);
    stdout(`     outputs: ${chapter.chapterPath}, ${chapter.outlinePath}, ${chapter.feedbackCandidatesPath}, ${chapter.settingConflictsPath}`);
    stdout(`     gates: ${chapter.qualityGatePath}`);
    for (const issue of chapter.quality.issues) {
      stdout(`     · ${issue.kind}[${issue.severity}]: ${issue.detail}`);
    }
  }
  const blocked = result.value.filter((chapter) => chapter.qualityGateBlockingCount > 0);
  if (blocked.length > 0) {
    stderr(`[run] blocked: ${blocked.length}/${result.value.length} chapter(s) have unresolved quality gates; route feedback or review gates before treating outputs as accepted`);
    return 1;
  }
  return 0;
}

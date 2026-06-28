import type { ContentHash, FileNativeStore, WorkspaceHandle } from "../file-store/index.js";
import type { LLMUsageSummary } from "../llm-gateway/index.js";
import { combineLLMUsageSummaries } from "../llm-gateway/index.js";
import type { AuthoringRuntimePackage, FeedbackLayer } from "../runtime-package/index.js";
import { ok, type Result } from "../domain/result.js";
import type { RunChapterResult } from "./runtime.js";
import { WORK_CHAPTER_GOAL_COVERAGE_EVAL_FILE } from "./goal-coverage.js";
import type { QualityGateRecord, QualityGateSet, QualityGateStatus } from "./quality-gates.js";
import { writeJsonFile } from "./state.js";

export const RUNTIME_DEBUG_REPORT_PATH = ".feng/runtime/debug-reports/latest.json";

export interface RuntimeDebugReportCandidate {
  readonly issueKind: string;
  readonly layer: FeedbackLayer;
  readonly severity: "warning" | "error";
  readonly detail: string;
  readonly routingReason: string;
  readonly chapterNumber: number;
  readonly source: "debug_report";
  readonly artifactPath: string;
  readonly gateId?: string;
  readonly qualityGateStatus?: QualityGateStatus;
}

export interface RuntimeDebugReport {
  readonly schemaVersion: "1.0.0";
  readonly kind: "runtime_debug_report";
  readonly generatedAt: string;
  readonly privacyBoundary: "artifact_refs_and_summaries_only";
  readonly rawContentIncluded: false;
  readonly package: {
    readonly packagePath: string;
    readonly packageId: string;
    readonly name: string;
    readonly version: string;
    readonly contentHash: ContentHash;
    readonly locked: boolean;
    readonly readiness: "ready" | "draft";
    readonly lockPath?: string;
    readonly lockStatus?: "created" | "matched" | "updated" | "not_applicable";
  };
  readonly chapters: readonly {
    readonly chapterNumber: number;
    readonly artifactDir: string;
    readonly traceRef: string;
    readonly messageListRef: string;
    readonly modelOutputRef: string;
    readonly qualityEvalRef: string;
    readonly feedbackRef: string;
    readonly qualityGateRef: string;
    readonly qualityGateSummary: string;
    readonly qualityGateBlockingCount: number;
    readonly qualityGateCandidateCount: number;
    readonly goalCoverageRef?: string;
    readonly goalCoverageCovered?: boolean;
    readonly goalCoverageConfidence?: number;
    readonly chars: number;
    readonly qualityStatus: "pass" | "pass_with_warnings" | "fail";
    readonly repairAttempts: number;
    readonly llmUsage: LLMUsageSummary;
    readonly feedbackCandidateCount: number;
    readonly byLayer: Record<FeedbackLayer, number>;
  }[];
  readonly llmUsage: LLMUsageSummary;
  readonly feedbackCandidates: readonly RuntimeDebugReportCandidate[];
}

function feedbackLayerForGate(layer: QualityGateRecord["layer"]): FeedbackLayer {
  return layer === "runtime" ? "system" : layer;
}

function severityForGate(status: QualityGateStatus): "warning" | "error" {
  return status === "failed" ? "error" : "warning";
}

function gateCandidate(chapter: RunChapterResult, gate: QualityGateRecord, reportPath: string): RuntimeDebugReportCandidate {
  return {
    issueKind: gate.issueKinds[0] ?? `gate:${gate.gateId}`,
    layer: feedbackLayerForGate(gate.layer),
    severity: severityForGate(gate.status),
    detail: `${gate.title}: ${gate.sourceRequirement} (${gate.status})`,
    routingReason: gate.notes.length > 0 ? gate.notes.join("; ") : gate.evidenceRequired,
    chapterNumber: chapter.chapterNumber,
    source: "debug_report",
    artifactPath: reportPath,
    gateId: gate.gateId,
    qualityGateStatus: gate.status
  };
}

async function readGateCandidates(
  deps: { readonly store: FileNativeStore; readonly workspace: WorkspaceHandle },
  chapter: RunChapterResult,
  reportPath: string
): Promise<readonly RuntimeDebugReportCandidate[]> {
  const read = await deps.store.readText(deps.workspace, chapter.qualityGatePath, { reason: "runtime debug report: read quality gates", maxBytes: 256 * 1024 });
  if (!read.ok) return [];
  try {
    const parsed = JSON.parse(read.value.content) as QualityGateSet;
    return (parsed.gates ?? []).filter((gate) => gate.status !== "passed").map((gate) => gateCandidate(chapter, gate, reportPath));
  } catch {
    return [];
  }
}

export async function writeRuntimeDebugReport(
  deps: { readonly store: FileNativeStore; readonly workspace: WorkspaceHandle; readonly now?: () => string },
  input: {
    readonly pkg: AuthoringRuntimePackage;
    readonly packagePath: string;
    readonly contentHash: ContentHash;
    readonly packageLockPath?: string;
    readonly packageLockStatus?: "created" | "matched" | "updated" | "not_applicable";
    readonly chapters: readonly RunChapterResult[];
  }
): Promise<Result<string>> {
  const reportPath = RUNTIME_DEBUG_REPORT_PATH;
  const gateCandidatesByChapter = await Promise.all(input.chapters.map((chapter) => readGateCandidates(deps, chapter, reportPath)));
  const gateCandidateCounts = new Map(input.chapters.map((chapter, index) => [chapter.chapterNumber, gateCandidatesByChapter[index]?.length ?? 0]));
  const gateCandidates = gateCandidatesByChapter.flat();
  const report: RuntimeDebugReport = {
    schemaVersion: "1.0.0",
    kind: "runtime_debug_report",
    generatedAt: (deps.now ?? (() => new Date().toISOString()))(),
    privacyBoundary: "artifact_refs_and_summaries_only",
    rawContentIncluded: false,
    package: {
      packagePath: input.packagePath,
      packageId: input.pkg.packageId,
      name: input.pkg.name,
      version: input.pkg.version,
      contentHash: input.contentHash,
      locked: input.pkg.locked,
      readiness: input.pkg.validation.readiness,
      ...(input.packageLockPath === undefined ? {} : { lockPath: input.packageLockPath }),
      ...(input.packageLockStatus === undefined ? {} : { lockStatus: input.packageLockStatus })
    },
    chapters: input.chapters.map((chapter) => ({
      chapterNumber: chapter.chapterNumber,
      artifactDir: chapter.artifactDir,
      traceRef: `${chapter.artifactDir}/trace.json`,
      messageListRef: `${chapter.artifactDir}/message-list.json`,
      modelOutputRef: `${chapter.artifactDir}/model-output.json`,
      qualityEvalRef: `${chapter.artifactDir}/quality-eval.json`,
      feedbackRef: `${chapter.artifactDir}/feedback.json`,
      qualityGateRef: chapter.qualityGatePath,
      qualityGateSummary: chapter.qualityGateSummary,
      qualityGateBlockingCount: chapter.qualityGateBlockingCount,
      qualityGateCandidateCount: gateCandidateCounts.get(chapter.chapterNumber) ?? 0,
      ...(chapter.goalCoverage === undefined ? {} : {
        goalCoverageRef: `${chapter.artifactDir}/${WORK_CHAPTER_GOAL_COVERAGE_EVAL_FILE}`,
        goalCoverageCovered: chapter.goalCoverage.covered,
        goalCoverageConfidence: chapter.goalCoverage.confidence
      }),
      chars: chapter.chars,
      qualityStatus: chapter.quality.status,
      repairAttempts: chapter.repairAttempts,
      llmUsage: chapter.llmUsage,
      feedbackCandidateCount: chapter.feedback.candidates.length,
      byLayer: chapter.feedback.byLayer
    })),
    llmUsage: combineLLMUsageSummaries(input.chapters.map((chapter) => chapter.llmUsage)),
    feedbackCandidates: [
      ...input.chapters.flatMap((chapter) =>
        chapter.feedback.candidates.map((candidate) => ({
          issueKind: candidate.issueKind,
          layer: candidate.layer,
          severity: candidate.severity,
          detail: candidate.detail,
          routingReason: candidate.routingReason,
          chapterNumber: candidate.chapterNumber,
          source: "debug_report" as const,
          artifactPath: reportPath,
          ...(candidate.gateId === undefined ? {} : { gateId: candidate.gateId })
        }))
      ),
      ...gateCandidates
    ]
  };
  const wrote = await writeJsonFile(deps.store, deps.workspace, reportPath, report, "write runtime debug report");
  return wrote.ok ? ok(reportPath) : wrote;
}

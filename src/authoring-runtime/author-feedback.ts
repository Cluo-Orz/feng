import { ok, type Result } from "../domain/result.js";
import { domainErr } from "../domain/index.js";
import type { FileNativeStore, WorkspaceHandle } from "../file-store/index.js";
import { feedbackLayers, qualityCheckKinds, type FeedbackLayer, type QualityCheckKind } from "../runtime-package/index.js";
import { chapterDir, readProjectConfig, writeJsonFile } from "./state.js";
import {
  formatQualityGateSummary,
  summarizeQualityGateSet,
  WORK_CHAPTER_QUALITY_GATE_FILE,
  type QualityGateRecord,
  type QualityGateSet,
  type TargetCoverageRecord,
  type WorkGateReviewDecision
} from "./quality-gates.js";
import type { FeedbackCandidate, RoutedFeedback } from "./feedback.js";

export const WORK_CHAPTER_AUTHOR_FEEDBACK_FILE = "author-feedback.json";

export interface AuthorFeedbackRecord {
  readonly feedbackId: string;
  readonly gateId: string;
  readonly chapterNumber: number;
  readonly issueKind: string;
  readonly layer: FeedbackLayer;
  readonly severity: "warning" | "error";
  readonly content: string;
  readonly suggestedAction?: string;
  readonly reviewer?: string;
  readonly status: "open" | "resolved";
  readonly createdAt: string;
  readonly resolvedAt?: string;
  readonly resolutionReason?: string;
  readonly resolutionRef?: string;
  readonly lastReviewDecision?: WorkGateReviewDecision;
  readonly lastReviewReason?: string;
  readonly lastReviewRef?: string;
  readonly lastReviewedAt?: string;
  readonly reviewedBy?: string;
}

export interface AuthorFeedbackFile {
  readonly schemaVersion: "1.0.0";
  readonly kind: "author_feedback_set";
  readonly chapterNumber: number;
  readonly feedback: readonly AuthorFeedbackRecord[];
  readonly updatedAt: string;
}

export interface RecordAuthorFeedbackInput {
  readonly chapterNumber: number;
  readonly content: string;
  readonly issueKind?: string;
  readonly layer?: FeedbackLayer;
  readonly severity?: "warning" | "error";
  readonly suggestedAction?: string;
  readonly reviewer?: string;
}

export interface RecordAuthorFeedbackResult {
  readonly feedbackId: string;
  readonly authorFeedbackPath: string;
  readonly feedbackPath: string;
  readonly qualityGatePath: string;
  readonly tracePath: string;
}

export interface ApplyAuthorFeedbackGateReviewInput {
  readonly chapterNumber: number;
  readonly gateId: string;
  readonly decision: WorkGateReviewDecision;
  readonly reason: string;
  readonly reviewedAt: string;
  readonly reviewPath: string;
  readonly reviewer?: string;
}

export interface ApplyAuthorFeedbackGateReviewResult {
  readonly authorFeedbackPath: string;
  readonly updatedCount: number;
}

export interface AuthorFeedbackInstruction {
  readonly instruction: string;
  readonly feedbackRef: string;
  readonly gateId: string;
  readonly chapterNumber: number;
  readonly issueKind: string;
  readonly layer: "work";
}

function isFeedbackLayer(value: string): value is FeedbackLayer {
  return (feedbackLayers as readonly string[]).includes(value);
}

function isQualityCheckKind(value: string): value is QualityCheckKind {
  return (qualityCheckKinds as readonly string[]).includes(value);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "feedback";
}

function emptyByLayer(): Record<FeedbackLayer, number> {
  return { work: 0, capability: 0, system: 0 };
}

function countByLayer(candidates: readonly FeedbackCandidate[]): Record<FeedbackLayer, number> {
  const byLayer = emptyByLayer();
  for (const candidate of candidates) byLayer[candidate.layer] += 1;
  return byLayer;
}

async function readJson<T>(store: FileNativeStore, workspace: WorkspaceHandle, path: string, reason: string): Promise<Result<T | undefined>> {
  const read = await store.readText(workspace, path, { reason, maxBytes: 512 * 1024 });
  if (!read.ok) return read.error.code === "not_found" ? ok(undefined) : read;
  try {
    return ok(JSON.parse(read.value.content) as T);
  } catch (cause) {
    return domainErr({ module: "authoring-runtime", code: "schema_incompatible", message: `invalid json at ${path}`, severity: "error", cause });
  }
}

async function readAuthorFeedbackFile(
  store: FileNativeStore,
  workspace: WorkspaceHandle,
  chapterNumber: number,
  path: string
): Promise<Result<AuthorFeedbackFile>> {
  const existing = await readJson<AuthorFeedbackFile>(store, workspace, path, "read author feedback");
  if (!existing.ok) return existing;
  return ok(existing.value ?? {
    schemaVersion: "1.0.0",
    kind: "author_feedback_set",
    chapterNumber,
    feedback: [],
    updatedAt: new Date().toISOString()
  });
}

function feedbackCandidate(record: AuthorFeedbackRecord): FeedbackCandidate {
  return {
    issueKind: record.issueKind,
    layer: record.layer,
    severity: record.severity,
    detail: `author_feedback:${record.content}`,
    routingReason: record.suggestedAction ?? "作者反馈形成的待处理修订/归因任务",
    chapterNumber: record.chapterNumber,
    gateId: record.gateId,
    feedbackRef: `${chapterDir(record.chapterNumber)}/${WORK_CHAPTER_AUTHOR_FEEDBACK_FILE}#${record.feedbackId}`,
    source: "author_feedback"
  };
}

async function updateRoutedFeedback(
  store: FileNativeStore,
  workspace: WorkspaceHandle,
  path: string,
  record: AuthorFeedbackRecord
): Promise<Result<string>> {
  const existing = await readJson<RoutedFeedback>(store, workspace, path, "read routed feedback for author feedback");
  if (!existing.ok) return existing;
  const prior = existing.value?.candidates ?? [];
  const nextCandidates = [...prior.filter((candidate) => candidate.gateId !== record.gateId), feedbackCandidate(record)];
  const next: RoutedFeedback = { candidates: nextCandidates, byLayer: countByLayer(nextCandidates) };
  const wrote = await writeJsonFile(store, workspace, path, next, "write routed author feedback candidate");
  return wrote.ok ? ok(path) : wrote;
}

async function defaultGateSet(
  store: FileNativeStore,
  workspace: WorkspaceHandle,
  chapterNumber: number,
  content: string
): Promise<Result<QualityGateSet>> {
  const project = await readProjectConfig(store, workspace);
  if (!project.ok) return project;
  return ok({
    schemaVersion: "1.0.0",
    kind: "work_project_quality_gate_set",
    generatedAt: new Date().toISOString(),
    goal: project.value?.chapterGoals?.[chapterNumber - 1] ?? project.value?.premise ?? content,
    packageName: "unknown",
    packageVersion: "unknown",
    sampleRoundCount: chapterNumber,
    readiness: "author_feedback",
    gates: [],
    coverage: [],
    summary: summarizeQualityGateSet([], [])
  });
}

function gateFor(record: AuthorFeedbackRecord): QualityGateRecord {
  return {
    gateId: record.gateId,
    layer: record.layer,
    title: "作者反馈处理",
    sourceRequirement: record.content,
    evidenceRequired: "后续运行、修订或人工 review 证明该反馈已处理、拒绝或归因给上游",
    status: "waiting_evidence",
    issueKinds: isQualityCheckKind(record.issueKind) ? [record.issueKind] : [],
    notes: [
      "generated from explicit author feedback",
      `feedbackId=${record.feedbackId}`,
      `layer=${record.layer}`,
      `issueKind=${record.issueKind}`,
      ...(record.suggestedAction === undefined ? [] : [`suggestedAction=${record.suggestedAction}`]),
      ...(record.reviewer === undefined ? [] : [`reviewer=${record.reviewer}`])
    ]
  };
}

function coverageFor(record: AuthorFeedbackRecord): TargetCoverageRecord {
  return {
    requirement: `author_feedback:${record.feedbackId}:${record.content}`,
    source: "work_project",
    status: "waiting_evidence",
    mappedGateIds: [record.gateId],
    notes: [
      "author feedback is tracked explicitly so it cannot be silently dropped",
      `layer=${record.layer}`,
      `issueKind=${record.issueKind}`
    ]
  };
}

async function updateQualityGates(
  store: FileNativeStore,
  workspace: WorkspaceHandle,
  path: string,
  record: AuthorFeedbackRecord
): Promise<Result<string>> {
  const existing = await readJson<QualityGateSet>(store, workspace, path, "read quality gates for author feedback");
  if (!existing.ok) return existing;
  let base: QualityGateSet;
  if (existing.value === undefined) {
    const created = await defaultGateSet(store, workspace, record.chapterNumber, record.content);
    if (!created.ok) return created;
    base = created.value;
  } else {
    base = existing.value;
  }
  const gate = gateFor(record);
  const coverage = coverageFor(record);
  const gates = [...base.gates.filter((item) => item.gateId !== gate.gateId), gate];
  const coverageRecords = [...base.coverage.filter((item) => !item.mappedGateIds.includes(gate.gateId)), coverage];
  const next: QualityGateSet = {
    ...base,
    gates,
    coverage: coverageRecords,
    summary: summarizeQualityGateSet(gates, coverageRecords)
  };
  const wrote = await writeJsonFile(store, workspace, path, next, "write author feedback quality gate");
  return wrote.ok ? ok(path) : wrote;
}

async function updateTrace(
  store: FileNativeStore,
  workspace: WorkspaceHandle,
  path: string,
  record: AuthorFeedbackRecord,
  feedbackPath: string,
  qualityGatePath: string
): Promise<Result<string>> {
  const existing = await readJson<Record<string, unknown>>(store, workspace, path, "read trace for author feedback");
  if (!existing.ok) return existing;
  const base = existing.value ?? {};
  const refs = Array.isArray(base.authorFeedbackRefs) ? base.authorFeedbackRefs.filter((item): item is string => typeof item === "string") : [];
  const ref = `${chapterDir(record.chapterNumber)}/${WORK_CHAPTER_AUTHOR_FEEDBACK_FILE}#${record.feedbackId}`;
  const next = {
    ...base,
    chapterNumber: record.chapterNumber,
    feedbackRef: feedbackPath,
    qualityGateRef: qualityGatePath,
    authorFeedbackRefs: [...new Set([...refs, ref])],
    authorFeedbackCount: [...new Set([...refs, ref])].length,
    tracedAt: new Date().toISOString()
  };
  const wrote = await writeJsonFile(store, workspace, path, next, "write trace author feedback refs");
  return wrote.ok ? ok(path) : wrote;
}

export async function recordAuthorFeedback(
  deps: { readonly store: FileNativeStore; readonly workspace: WorkspaceHandle; readonly now?: () => string },
  input: RecordAuthorFeedbackInput
): Promise<Result<RecordAuthorFeedbackResult>> {
  if (!Number.isFinite(input.chapterNumber) || input.chapterNumber <= 0) {
    return domainErr({ module: "authoring-runtime", code: "invalid_input", message: "chapterNumber must be positive", severity: "warning" });
  }
  const content = input.content.trim();
  if (content.length === 0) {
    return domainErr({ module: "authoring-runtime", code: "invalid_input", message: "author feedback content is required", severity: "warning" });
  }
  const layer = input.layer ?? "work";
  if (!isFeedbackLayer(layer)) {
    return domainErr({ module: "authoring-runtime", code: "invalid_input", message: `invalid feedback layer: ${layer}`, severity: "warning" });
  }
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const dir = chapterDir(input.chapterNumber);
  const authorFeedbackPath = `${dir}/${WORK_CHAPTER_AUTHOR_FEEDBACK_FILE}`;
  const existing = await readAuthorFeedbackFile(deps.store, deps.workspace, input.chapterNumber, authorFeedbackPath);
  if (!existing.ok) return existing;
  const feedbackId = `author-feedback-ch${String(input.chapterNumber).padStart(2, "0")}-${String(existing.value.feedback.length + 1).padStart(2, "0")}`;
  const record: AuthorFeedbackRecord = {
    feedbackId,
    gateId: `gate-${slug(feedbackId)}`,
    chapterNumber: input.chapterNumber,
    issueKind: input.issueKind?.trim() || "author_feedback",
    layer,
    severity: input.severity ?? "warning",
    content,
    ...(input.suggestedAction === undefined ? {} : { suggestedAction: input.suggestedAction }),
    ...(input.reviewer === undefined ? {} : { reviewer: input.reviewer }),
    status: "open",
    createdAt: now
  };
  const feedbackSet: AuthorFeedbackFile = {
    ...existing.value,
    feedback: [...existing.value.feedback, record],
    updatedAt: now
  };
  const wroteAuthor = await writeJsonFile(deps.store, deps.workspace, authorFeedbackPath, feedbackSet, "write author feedback");
  if (!wroteAuthor.ok) return wroteAuthor;
  const feedbackPath = `${dir}/feedback.json`;
  const wroteFeedback = await updateRoutedFeedback(deps.store, deps.workspace, feedbackPath, record);
  if (!wroteFeedback.ok) return wroteFeedback;
  const qualityGatePath = `${dir}/${WORK_CHAPTER_QUALITY_GATE_FILE}`;
  const wroteGate = await updateQualityGates(deps.store, deps.workspace, qualityGatePath, record);
  if (!wroteGate.ok) return wroteGate;
  const tracePath = `${dir}/trace.json`;
  const wroteTrace = await updateTrace(deps.store, deps.workspace, tracePath, record, feedbackPath, qualityGatePath);
  if (!wroteTrace.ok) return wroteTrace;
  return ok({ feedbackId, authorFeedbackPath, feedbackPath, qualityGatePath, tracePath });
}

export async function applyAuthorFeedbackGateReview(
  deps: { readonly store: FileNativeStore; readonly workspace: WorkspaceHandle },
  input: ApplyAuthorFeedbackGateReviewInput
): Promise<Result<ApplyAuthorFeedbackGateReviewResult | undefined>> {
  const authorFeedbackPath = `${chapterDir(input.chapterNumber)}/${WORK_CHAPTER_AUTHOR_FEEDBACK_FILE}`;
  const existing = await readJson<AuthorFeedbackFile>(deps.store, deps.workspace, authorFeedbackPath, "read author feedback for gate review");
  if (!existing.ok) return existing;
  if (existing.value === undefined) return ok(undefined);
  let updatedCount = 0;
  const feedback = existing.value.feedback.map((record): AuthorFeedbackRecord => {
    if (record.gateId !== input.gateId) return record;
    updatedCount += 1;
    const reviewed = {
      ...record,
      status: input.decision === "passed" ? "resolved" as const : "open" as const,
      lastReviewDecision: input.decision,
      lastReviewReason: input.reason,
      lastReviewRef: input.reviewPath,
      lastReviewedAt: input.reviewedAt,
      ...(input.reviewer === undefined ? {} : { reviewedBy: input.reviewer })
    };
    if (input.decision !== "passed") {
      return {
        feedbackId: reviewed.feedbackId,
        gateId: reviewed.gateId,
        chapterNumber: reviewed.chapterNumber,
        issueKind: reviewed.issueKind,
        layer: reviewed.layer,
        severity: reviewed.severity,
        content: reviewed.content,
        ...(reviewed.suggestedAction === undefined ? {} : { suggestedAction: reviewed.suggestedAction }),
        ...(reviewed.reviewer === undefined ? {} : { reviewer: reviewed.reviewer }),
        status: "open",
        createdAt: reviewed.createdAt,
        lastReviewDecision: reviewed.lastReviewDecision,
        lastReviewReason: reviewed.lastReviewReason,
        lastReviewRef: reviewed.lastReviewRef,
        lastReviewedAt: reviewed.lastReviewedAt,
        ...(reviewed.reviewedBy === undefined ? {} : { reviewedBy: reviewed.reviewedBy })
      };
    }
    return {
      ...reviewed,
      resolvedAt: input.reviewedAt,
      resolutionReason: input.reason,
      resolutionRef: input.reviewPath
    };
  });
  if (updatedCount === 0) return ok(undefined);
  const next: AuthorFeedbackFile = {
    ...existing.value,
    feedback,
    updatedAt: input.reviewedAt
  };
  const wrote = await writeJsonFile(deps.store, deps.workspace, authorFeedbackPath, next, "sync author feedback after gate review");
  return wrote.ok ? ok({ authorFeedbackPath, updatedCount }) : wrote;
}

async function passedGateIds(store: FileNativeStore, workspace: WorkspaceHandle, chapterNumber: number): Promise<ReadonlySet<string>> {
  const path = `${chapterDir(chapterNumber)}/${WORK_CHAPTER_QUALITY_GATE_FILE}`;
  const read = await readJson<QualityGateSet>(store, workspace, path, "read quality gates for author feedback context");
  if (!read.ok || read.value === undefined) return new Set();
  return new Set(read.value.gates.filter((gate) => gate.status === "passed").map((gate) => gate.gateId));
}

export async function readAuthorFeedbackInstructions(
  store: FileNativeStore,
  workspace: WorkspaceHandle
): Promise<Result<readonly AuthorFeedbackInstruction[]>> {
  const root = ".feng/runtime/chapters";
  const listing = await store.listDirectory(workspace, root, { reason: "list author feedback chapters", recursive: false });
  if (!listing.ok) return listing.error.code === "not_found" ? ok([]) : listing;
  const instructions: AuthorFeedbackInstruction[] = [];
  for (const entry of listing.value.entries) {
    if (entry.kind !== "directory") continue;
    const match = /chapter-(\d+)/.exec(entry.name);
    const chapterNumber = match === null ? 0 : Number.parseInt(match[1] as string, 10);
    const path = `${root}/${entry.name}/${WORK_CHAPTER_AUTHOR_FEEDBACK_FILE}`;
    const read = await readJson<AuthorFeedbackFile>(store, workspace, path, "read author feedback instructions");
    if (!read.ok) return read;
    if (read.value === undefined) continue;
    const passed = await passedGateIds(store, workspace, chapterNumber);
    for (const record of read.value.feedback) {
      if (record.status !== "open" || record.layer !== "work" || passed.has(record.gateId)) continue;
      instructions.push({
        instruction: `ch${record.chapterNumber} ${record.issueKind}/${record.layer}: ${record.content}${record.suggestedAction === undefined ? "" : `；处理建议：${record.suggestedAction}`}`,
        feedbackRef: `${chapterDir(record.chapterNumber)}/${WORK_CHAPTER_AUTHOR_FEEDBACK_FILE}#${record.feedbackId}`,
        gateId: record.gateId,
        chapterNumber: record.chapterNumber,
        issueKind: record.issueKind,
        layer: "work"
      });
    }
  }
  return ok(instructions);
}

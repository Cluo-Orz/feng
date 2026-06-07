import { ok, type Result } from "../domain/result.js";
import { domainErr } from "../domain/index.js";
import type { GrowUnitRef } from "../domain/index.js";
import type { NovelState } from "./xiaoshuo-writer.js";
import type { FengHost } from "./runtime-host.js";

const TARGET_STATE_PATH = ".feng/xiaoshuo/novel-state.json";

export interface SupervisionIssue {
  readonly kind: "not_started" | "too_short" | "self_repair_logged" | "continuity_gap";
  readonly chapter?: number;
  readonly detail: string;
}

export interface SupervisionReport {
  readonly targetRoot: string;
  readonly chaptersFound: number;
  readonly issues: readonly SupervisionIssue[];
  readonly growUnitRef?: GrowUnitRef;
  readonly inboxItemIds: readonly string[];
  readonly feedbackCandidateCount: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function descriptors(reason: string) {
  const at = nowIso();
  return {
    source: { kind: "runtime" as const, origin: "feng-supervisor", userProvided: false, receivedAt: at, privacyLevel: "workspace_private" as const },
    version: { schemaVersion: "1.0.0", producerVersion: "feng-supervisor" },
    audit: { createdAt: at, createdBy: "feng-supervisor", reason }
  };
}

async function readTargetState(host: FengHost, targetRoot: string): Promise<Result<NovelState | undefined>> {
  const opened = await host.store.openWorkspace({ root: targetRoot });
  if (!opened.ok) return opened;
  const read = await host.store.readText(opened.value, TARGET_STATE_PATH, { reason: "supervise: read target novel state", maxBytes: 1024 * 1024 });
  if (!read.ok) return read.error.code === "not_found" ? ok(undefined) : read;
  try {
    return ok(JSON.parse(read.value.content) as NovelState);
  } catch (cause) {
    return domainErr({ module: "feng-supervisor", code: "schema_incompatible", message: "target novel state is invalid", cause });
  }
}

export function detectIssues(state: NovelState | undefined, minChars: number): readonly SupervisionIssue[] {
  if (state === undefined || state.chapters.length === 0) {
    return [{ kind: "not_started", detail: "目标工作区尚未开始写作（无 novel-state 或无章节）" }];
  }
  const issues: SupervisionIssue[] = [];
  const sorted = [...state.chapters].sort((a, b) => a.number - b.number);
  for (let i = 0; i < sorted.length; i += 1) {
    const chapter = sorted[i] as NovelState["chapters"][number];
    if (chapter.chars < minChars) {
      issues.push({ kind: "too_short", chapter: chapter.number, detail: `第${chapter.number}章仅${chapter.chars}字，低于督查下限${minChars}字` });
    }
    for (const logged of chapter.issues ?? []) {
      issues.push({ kind: "self_repair_logged", chapter: chapter.number, detail: `内层 feng 自修复记录：${logged}` });
    }
    if (i > 0) {
      const prev = sorted[i - 1] as NovelState["chapters"][number];
      if (chapter.number !== prev.number + 1) {
        issues.push({ kind: "continuity_gap", chapter: chapter.number, detail: `章节编号不连续：第${prev.number}章后直接出现第${chapter.number}章` });
      }
    }
  }
  return issues;
}

async function routeIssue(host: FengHost, growUnitRef: GrowUnitRef, issue: SupervisionIssue): Promise<Result<string>> {
  const meta = descriptors("supervise: collect inner feng issue");
  const received = await host.admission.receiveRuntimeReport(growUnitRef, {
    content: issue.detail,
    normalizedSummary: `[${issue.kind}] ${issue.detail}`,
    mediaType: "text/plain",
    encoding: "utf8",
    privacyClass: "workspace_private",
    version: meta.version,
    source: meta.source,
    audit: meta.audit
  });
  if (!received.ok) return received;
  const normalized = await host.admission.normalizeInboxItem(received.value);
  if (!normalized.ok) return normalized;
  const classified = await host.admission.classifyInboxItem(received.value);
  if (!classified.ok) return classified;
  const decided = await host.admission.decideAdmission(received.value, {
    decision: "admit_as_feedback_candidate",
    reason: `supervisor admitted inner feng issue: ${issue.kind}`,
    source: meta.source,
    audit: meta.audit
  });
  if (!decided.ok) return decided;
  const feedback = await host.admission.createFeedbackUnit({
    growUnitRef,
    originLayer: "current_project",
    targetLayer: "current_project",
    summary: `[${issue.kind}] ${issue.detail}`,
    attribution: "inner feng writing output",
    impact: issue.kind,
    suggestedAction: issue.kind === "too_short" ? "扩写该章到下限以上" : "复核并修复内层 feng 的写作产出",
    privacyClass: "workspace_private",
    source: meta.source,
    audit: meta.audit
  });
  if (!feedback.ok) return feedback;
  return ok(received.value.id);
}

export async function superviseNovel(
  host: FengHost,
  input: { readonly targetRoot: string; readonly minChars?: number }
): Promise<Result<SupervisionReport>> {
  const minChars = input.minChars ?? 800;
  const state = await readTargetState(host, input.targetRoot);
  if (!state.ok) return state;
  const issues = detectIssues(state.value, minChars);
  const chaptersFound = state.value?.chapters.length ?? 0;

  if (issues.length === 0) {
    return ok({ targetRoot: input.targetRoot, chaptersFound, issues, inboxItemIds: [], feedbackCandidateCount: 0 });
  }

  const meta = descriptors("supervise: create supervision grow unit");
  const grow = await host.grow.createGrowUnit({
    title: `supervision of ${input.targetRoot}`,
    goalBoundarySummary: "监督内层 feng 的写作产出，采集异常并经 Admission/feedback 机制上报。",
    targetBehaviorSummary: "采集内层 feng 的问题并作为 feedback 候选准入。",
    source: meta.source,
    version: meta.version,
    audit: meta.audit
  });
  if (!grow.ok) return grow;

  const inboxItemIds: string[] = [];
  for (const issue of issues) {
    const routed = await routeIssue(host, grow.value, issue);
    if (!routed.ok) return routed;
    inboxItemIds.push(routed.value);
  }

  const summary = await host.admission.buildAdmissionSummary(grow.value);
  const feedbackCandidateCount = summary.ok ? summary.value.feedbackCandidateCount : 0;
  return ok({
    targetRoot: input.targetRoot,
    chaptersFound,
    issues,
    growUnitRef: grow.value,
    inboxItemIds,
    feedbackCandidateCount
  });
}

import type { QualityCheckKind, QualityRule } from "../runtime-package/index.js";

export interface QualityIssue {
  readonly kind: QualityCheckKind;
  readonly severity: "warning" | "error";
  readonly detail: string;
}

export interface QualityInput {
  readonly rules: readonly QualityRule[];
  readonly chapterNumber: number;
  readonly chapterText: string;
  readonly outline: string;
  readonly priorChapterNumbers: readonly number[];
  readonly priorOutlines: readonly string[];
  readonly establishedYear?: number;
  readonly establishedCharacters?: readonly string[];
  readonly conflictTerms?: readonly string[];
  readonly openingChars?: number;
  readonly messageListWritten: boolean;
  readonly traceWritten: boolean;
}

export interface QualityEval {
  readonly chapterNumber: number;
  readonly chars: number;
  readonly status: "pass" | "pass_with_warnings" | "fail";
  readonly passed: boolean;
  readonly issues: readonly QualityIssue[];
  readonly checkedAt: string;
}

function rule(rules: readonly QualityRule[], kind: QualityCheckKind): QualityRule | undefined {
  return rules.find((r) => r.kind === kind);
}

export function extractYears(text: string): readonly number[] {
  const matches = text.match(/(19|20|21)\d{2}/g) ?? [];
  return matches.map((m) => Number.parseInt(m, 10));
}

function checkLength(input: QualityInput, r: QualityRule, issues: QualityIssue[]): void {
  const len = input.chapterText.length;
  const min = r.minChars ?? 0;
  const max = r.maxChars ?? Number.MAX_SAFE_INTEGER;
  if (len < min) issues.push({ kind: "length", severity: "error", detail: `第${input.chapterNumber}章仅${len}字，低于下限${min}` });
  else if (len > max) issues.push({ kind: "length", severity: "error", detail: `第${input.chapterNumber}章${len}字，超过硬性上限${max}` });
}

function checkChapterContinuity(input: QualityInput, issues: QualityIssue[]): void {
  if (input.priorChapterNumbers.length === 0) return;
  const max = Math.max(...input.priorChapterNumbers);
  if (input.chapterNumber !== max + 1) {
    issues.push({ kind: "chapter_continuity", severity: "error", detail: `章节编号不连续：上一最高为第${max}章，本章为第${input.chapterNumber}章` });
  }
}

function checkYear(input: QualityInput, issues: QualityIssue[]): void {
  if (input.establishedYear === undefined) return;
  for (const year of extractYears(input.chapterText)) {
    if (year !== input.establishedYear) {
      issues.push({ kind: "year_consistency", severity: "error", detail: `第${input.chapterNumber}章出现年份${year}，与既定年份${input.establishedYear}冲突` });
      return;
    }
  }
}

function checkCharacterContinuation(input: QualityInput, issues: QualityIssue[]): void {
  const known = input.establishedCharacters ?? [];
  if (known.length === 0 || input.priorChapterNumbers.length === 0) return;
  const opening = input.chapterText.slice(0, input.openingChars ?? 200);
  if (!known.some((name) => opening.includes(name))) {
    issues.push({ kind: "character_continuation", severity: "warning", detail: `第${input.chapterNumber}章开头未承接任何既有人物(${known.join("、")})` });
  }
}

function hasExplicitGeographyConflict(text: string, term: string): boolean {
  let index = text.indexOf(term);
  while (index !== -1) {
    const start = Math.max(0, index - 16);
    const end = Math.min(text.length, index + term.length + 16);
    const context = text.slice(start, end);
    if (/(以前叫|原名|改名|改作|误作|错写|应为|不是|并非|不在|矛盾|冲突)/.test(context)) return true;
    index = text.indexOf(term, index + term.length);
  }
  return false;
}

function checkGeography(input: QualityInput, issues: QualityIssue[]): void {
  for (const term of input.conflictTerms ?? []) {
    if (hasExplicitGeographyConflict(input.chapterText, term)) {
      issues.push({ kind: "geography_consistency", severity: "warning", detail: `第${input.chapterNumber}章出现可能冲突的地点设定「${term}」，需复核` });
    }
  }
}

function checkOutlineContinuity(input: QualityInput, issues: QualityIssue[]): void {
  const expected = input.priorChapterNumbers.length;
  if (input.priorOutlines.length !== expected) {
    issues.push({ kind: "outline_continuity", severity: "error", detail: `大纲条目数(${input.priorOutlines.length})与已写章节数(${expected})不一致` });
  }
  if (input.outline.trim().length === 0) {
    issues.push({ kind: "outline_continuity", severity: "warning", detail: `第${input.chapterNumber}章缺少大纲摘要` });
  }
}

function checkArtifactPresence(input: QualityInput, issues: QualityIssue[]): void {
  if (!input.messageListWritten) issues.push({ kind: "artifact_presence", severity: "error", detail: `第${input.chapterNumber}章缺少 message list 记录` });
  if (!input.traceWritten) issues.push({ kind: "artifact_presence", severity: "error", detail: `第${input.chapterNumber}章缺少 trace 记录` });
}

export function evaluateChapter(input: QualityInput): QualityEval {
  const issues: QualityIssue[] = [];
  const lengthRule = rule(input.rules, "length");
  if (lengthRule !== undefined) checkLength(input, lengthRule, issues);
  if (rule(input.rules, "chapter_continuity") !== undefined) checkChapterContinuity(input, issues);
  if (rule(input.rules, "year_consistency") !== undefined) checkYear(input, issues);
  if (rule(input.rules, "character_continuation") !== undefined) checkCharacterContinuation(input, issues);
  if (rule(input.rules, "geography_consistency") !== undefined) checkGeography(input, issues);
  if (rule(input.rules, "outline_continuity") !== undefined) checkOutlineContinuity(input, issues);
  if (rule(input.rules, "artifact_presence") !== undefined) checkArtifactPresence(input, issues);
  const hasError = issues.some((i) => i.severity === "error");
  const hasWarning = issues.some((i) => i.severity === "warning");
  const status = hasError ? "fail" : hasWarning ? "pass_with_warnings" : "pass";
  return {
    chapterNumber: input.chapterNumber,
    chars: input.chapterText.length,
    status,
    passed: status !== "fail",
    issues,
    checkedAt: new Date().toISOString()
  };
}

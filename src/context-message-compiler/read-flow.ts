import type { ArtifactRef, MessageListRef } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import { contextErr } from "./errors.js";
import { parseJson } from "./storage.js";
import type { ContextRuntime } from "./runtime.js";
import type {
  BudgetReport,
  CompileReport,
  ExclusionList,
  MessageListExplanation,
  SourceMap
} from "./types.js";

export async function readSourceMapRecord(
  runtime: ContextRuntime,
  messageListRef: MessageListRef
): Promise<Result<SourceMap>> {
  const record = await runtime.storage.readMessageList(messageListRef);
  return record.ok ? readJsonArtifact<SourceMap>(runtime, record.value.sourceMapRef, "read source map") : record;
}

export async function readBudgetReportRecord(
  runtime: ContextRuntime,
  messageListRef: MessageListRef
): Promise<Result<BudgetReport>> {
  const record = await runtime.storage.readMessageList(messageListRef);
  return record.ok ? readJsonArtifact<BudgetReport>(runtime, record.value.budgetReportRef, "read budget report") : record;
}

export async function readExclusionListRecord(
  runtime: ContextRuntime,
  messageListRef: MessageListRef
): Promise<Result<ExclusionList>> {
  const record = await runtime.storage.readMessageList(messageListRef);
  return record.ok ? readJsonArtifact<ExclusionList>(runtime, record.value.exclusionListRef, "read exclusion list") : record;
}

export async function explainMessageListRecord(
  runtime: ContextRuntime,
  messageListRef: MessageListRef
): Promise<Result<MessageListExplanation>> {
  const record = await runtime.storage.readMessageList(messageListRef);
  if (!record.ok) return record;
  const [sourceMap, budgetReport, exclusionList, compileReport] = await Promise.all([
    readJsonArtifact<SourceMap>(runtime, record.value.sourceMapRef, "explain source map"),
    readJsonArtifact<BudgetReport>(runtime, record.value.budgetReportRef, "explain budget report"),
    readJsonArtifact<ExclusionList>(runtime, record.value.exclusionListRef, "explain exclusion list"),
    readJsonArtifact<CompileReport>(runtime, record.value.compileReportRef, "explain compile report")
  ]);
  if (!sourceMap.ok) return sourceMap;
  if (!budgetReport.ok) return budgetReport;
  if (!exclusionList.ok) return exclusionList;
  if (!compileReport.ok) return compileReport;
  return ok({
    messageListRef,
    summary: `Message list ${messageListRef.id} has ${record.value.sections.length} sections and ${sourceMap.value.entries.length} source entries`,
    sourceMap: sourceMap.value,
    budgetReport: budgetReport.value,
    exclusionList: exclusionList.value,
    compileReport: compileReport.value
  });
}

async function readJsonArtifact<T>(
  runtime: ContextRuntime,
  ref: ArtifactRef,
  reason: string
): Promise<Result<T>> {
  const materialized = await runtime.options.artifactRegistry.materializeArtifact(ref, {
    reason,
    allowArchived: true,
    maxBytes: 2 * 1024 * 1024
  });
  if (!materialized.ok) return materialized;
  if (materialized.value.status !== "available" || materialized.value.content === undefined) {
    return contextErr({
      code: materialized.value.status === "redacted" ? "privacy_blocked" : "artifact_unavailable",
      message: `context artifact ${ref.id} is ${materialized.value.status}`
    });
  }
  if (typeof materialized.value.content !== "string") {
    return contextErr({ code: "unsupported_encoding", message: `context artifact ${ref.id} is not utf8 text` });
  }
  return parseJson<T>(materialized.value.content, `context artifact ${ref.id} is invalid JSON`);
}

import type { ArtifactKind, ArtifactRegistry } from "../artifact-registry/index.js";
import type { ArtifactRef, MessageListRef } from "../domain/index.js";
import type { Result } from "../domain/result.js";
import type {
  BudgetReport,
  ContextCompileInput,
  ExclusionList,
  SourceMap
} from "./types.js";
import type { ContextRuntime } from "./runtime.js";

export interface JsonArtifactInput {
  readonly kind: ArtifactKind;
  readonly content: unknown;
  readonly parentRefs: readonly ArtifactRef[];
  readonly input: ContextCompileInput;
}

export interface ReportRefs {
  readonly sourceMapRef: ArtifactRef;
  readonly budgetReportRef: ArtifactRef;
  readonly exclusionListRef: ArtifactRef;
}

export async function registerReports(
  runtime: ContextRuntime,
  input: ContextCompileInput,
  _messageListRef: MessageListRef,
  sourceMap: SourceMap,
  budgetReport: BudgetReport,
  exclusionList: ExclusionList,
  parentRefs: readonly ArtifactRef[]
): Promise<Result<ReportRefs>> {
  const sourceMapRef = await registerJsonArtifact(runtime, {
    kind: "summary",
    content: sourceMap,
    parentRefs,
    input
  });
  if (!sourceMapRef.ok) return sourceMapRef;
  const budgetReportRef = await registerJsonArtifact(runtime, {
    kind: "summary",
    content: budgetReport,
    parentRefs,
    input
  });
  if (!budgetReportRef.ok) return budgetReportRef;
  const exclusionListRef = await registerJsonArtifact(runtime, {
    kind: "summary",
    content: exclusionList,
    parentRefs,
    input
  });
  if (!exclusionListRef.ok) return exclusionListRef;
  return {
    ok: true,
    value: {
      sourceMapRef: sourceMapRef.value,
      budgetReportRef: budgetReportRef.value,
      exclusionListRef: exclusionListRef.value
    }
  };
}

export async function registerJsonArtifact(
  runtime: { readonly options: { readonly artifactRegistry: ArtifactRegistry } },
  artifact: JsonArtifactInput
): Promise<Result<ArtifactRef>> {
  const content = JSON.stringify(artifact.content, null, 2);
  const base = {
    kind: artifact.kind,
    content,
    mediaType: "application/json",
    encoding: "utf8" as const,
    source: artifact.input.source,
    version: artifact.input.version,
    audit: artifact.input.audit,
    privacyClass: "workspace_private" as const,
    retentionClass: "grow_scoped" as const,
    producerModule: "context-message-compiler" as const,
    ...(artifact.input.correlationId === undefined ? {} : { correlationId: artifact.input.correlationId })
  };
  return artifact.parentRefs.length === 0
    ? runtime.options.artifactRegistry.registerArtifact(base)
    : runtime.options.artifactRegistry.registerDerivedArtifact({ ...base, parentRefs: artifact.parentRefs });
}

export function warningsFor(budget: BudgetReport, exclusions: ExclusionList): readonly string[] {
  const warnings: string[] = [];
  if (budget.truncationApplied) warnings.push("context budget caused truncation");
  if (budget.overBudget) warnings.push("message list remains over budget after truncation");
  if (exclusions.records.length > 0) warnings.push(`${exclusions.records.length} source candidates excluded`);
  return warnings;
}

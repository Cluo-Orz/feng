import type { AppendEventInput } from "../event-ledger/index.js";
import type { Result } from "../domain/result.js";
import { contextEventTypes } from "./events.js";
import { payload } from "./payloads.js";
import { appendContextBatch, type ContextRuntime } from "./runtime.js";
import type {
  BudgetReport,
  CompiledMessageListRecord,
  ContextCompileInput,
  ExclusionList
} from "./types.js";

export async function appendCompileEvents(
  runtime: ContextRuntime,
  input: ContextCompileInput,
  record: CompiledMessageListRecord,
  budgetReport: BudgetReport,
  exclusionList: ExclusionList
): Promise<Result<unknown>> {
  const events: AppendEventInput[] = [
    event(input, contextEventTypes.messageListCompiled, {
      messageListRef: record.messageListRef,
      compilePlanRef: record.compilePlanRef,
      artifactRef: record.artifactRef,
      sectionCount: record.sections.length
    }),
    event(input, contextEventTypes.messageListRegistered, {
      messageListRef: record.messageListRef,
      artifactRef: record.artifactRef,
      sourceMapRef: record.sourceMapRef,
      budgetReportRef: record.budgetReportRef,
      exclusionListRef: record.exclusionListRef
    })
  ];
  if (exclusionList.records.length > 0) {
    events.push(event(input, contextEventTypes.sourceExcluded, {
      messageListRef: record.messageListRef,
      excludedCount: exclusionList.records.length,
      exclusionListRef: record.exclusionListRef
    }));
  }
  if (budgetReport.truncationApplied || budgetReport.overBudget) {
    events.push(event(input, contextEventTypes.budgetExceeded, {
      messageListRef: record.messageListRef,
      budgetReportRef: record.budgetReportRef,
      estimatedUsage: budgetReport.estimatedUsage,
      totalBudget: budgetReport.totalBudget,
      overBudget: budgetReport.overBudget
    }));
  }
  return appendContextBatch({ runtime, growUnitRef: input.growUnitRef, events });
}

function event(
  input: ContextCompileInput,
  eventType: string,
  body: Record<string, unknown>
): AppendEventInput {
  return {
    eventType,
    eventVersion: "1",
    payload: payload(body),
    source: input.source,
    audit: input.audit,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId })
  };
}

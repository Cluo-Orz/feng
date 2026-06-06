import { contextEventTypes, contextGrowStream } from "./events.js";
import { payload } from "./payloads.js";
import {
  compileMessageListRecord,
  invalidateMessageListRecord,
  recompileMessageListRecord
} from "./compile-flow.js";
import { buildCompilePlanRecord, explainCompilePlanRecord } from "./plan-flow.js";
import {
  explainMessageListRecord,
  readBudgetReportRecord,
  readExclusionListRecord,
  readSourceMapRecord
} from "./read-flow.js";
import { createContextRuntime } from "./runtime.js";
import type {
  ContextCompileInput,
  ContextMessageCompiler,
  ContextMessageCompilerOptions,
  RecompileMessageListInput
} from "./types.js";
import type { FileNativeStore } from "../file-store/index.js";
import type { MessageListRef } from "../domain/index.js";

export function createContextMessageCompiler(
  store: FileNativeStore,
  options: ContextMessageCompilerOptions
): ContextMessageCompiler {
  const runtime = createContextRuntime(store, options);
  return {
    buildCompilePlan: (input) => buildCompilePlanRecord(runtime, input),
    explainCompilePlan: (ref) => explainCompilePlanRecord(runtime, ref),
    compileMessageList: async (input) => {
      const result = await compileMessageListRecord(runtime, input);
      if (!result.ok) await recordCompileFailure(runtime, input, result.error.code, result.error.message);
      return result;
    },
    recompileMessageList: (previous, input) => recompileMessageListRecord(runtime, previous, input),
    invalidateMessageList: (ref, input) => invalidateMessageListRecord(runtime, ref, input),
    explainMessageList: (ref) => explainMessageListRecord(runtime, ref),
    readSourceMap: (ref) => readSourceMapRecord(runtime, ref),
    readBudgetReport: (ref) => readBudgetReportRecord(runtime, ref),
    readExclusionList: (ref) => readExclusionListRecord(runtime, ref)
  };
}

async function recordCompileFailure(
  runtime: ReturnType<typeof createContextRuntime>,
  input: ContextCompileInput,
  code: string,
  message: string
): Promise<void> {
  await runtime.options.ledger.appendEvent(contextGrowStream(input.growUnitRef), {
    eventType: contextEventTypes.compileFailed,
    eventVersion: "1",
    payload: payload({ growUnitRef: input.growUnitRef, code, message }),
    source: input.source,
    audit: input.audit,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    producer: runtime.options.producer
  });
}

export type { ContextCompileInput, RecompileMessageListInput, MessageListRef };

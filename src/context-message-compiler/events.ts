import type { GrowUnitRef } from "../domain/index.js";
import { makeLedgerStreamId, type LedgerStream } from "../event-ledger/index.js";

export const contextEventTypes = {
  compilePlanCreated: "context_compile_plan_created",
  messageListCompiled: "message_list_compiled",
  messageListRegistered: "message_list_registered",
  messageListInvalidated: "message_list_invalidated",
  messageListRecompiled: "message_list_recompiled",
  sourceExcluded: "context_source_excluded",
  budgetExceeded: "context_budget_exceeded",
  compileFailed: "context_compile_failed"
} as const;

export function contextGrowStream(growUnitRef: GrowUnitRef): LedgerStream {
  return { streamType: "grow_unit", streamId: makeLedgerStreamId(growUnitRef.id) };
}

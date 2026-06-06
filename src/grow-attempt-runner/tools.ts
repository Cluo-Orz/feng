import { randomUUID } from "node:crypto";
import { makeRef, makeToolId, type ArtifactRef, type ToolRef } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import type { ToolCallBlock } from "../llm-gateway/index.js";
import { makeToolCallId } from "../tool-runtime/index.js";
import type {
  JsonValue,
  ToolCallRequest,
  ToolSettlement,
  ToolSurfaceEntry,
  ToolSurfaceSummary as RuntimeToolSurfaceSummary
} from "../tool-runtime/index.js";
import { appendAttemptEvent, attemptEventTypes, mutateAttempt, type AttemptRuntime } from "./runtime.js";
import type {
  AttemptExecutionPlan,
  AttemptPreparedInputs,
  AttemptRecord,
  AttemptTurnRecord,
  AttemptExitReason
} from "./types.js";

export async function settleToolCalls(input: {
  readonly runtime: AttemptRuntime;
  readonly record: AttemptRecord;
  readonly turn: AttemptTurnRecord;
  readonly plan: AttemptExecutionPlan;
  readonly prepared: AttemptPreparedInputs;
  readonly blocks: readonly ToolCallBlock[];
  readonly policyContext: import("../policy-boundary/index.js").PolicyContext;
}): Promise<Result<{
  readonly record: AttemptRecord;
  readonly turn: AttemptTurnRecord;
  readonly settlements: readonly ToolSettlement[];
  readonly exitReason?: AttemptExitReason;
}>> {
  const surface = await input.runtime.options.toolRuntime.explainToolSurface(input.prepared.toolSurfaceRef);
  if (!surface.ok) return surface;
  const requests = input.blocks.map((block) => toToolCallRequest(input, block, surface.value));
  const settlements: ToolSettlement[] = [];
  let record = input.record;
  let turn = input.turn;
  for (const request of requests) {
    const requested = await appendAttemptEvent({
      runtime: input.runtime,
      record,
      eventType: attemptEventTypes.toolCallRequested,
      body: {
        toolCallId: request.toolCallId,
        toolRef: request.toolRef,
        messageListRef: request.messageListRef,
        reason: request.reason
      }
    });
    if (!requested.ok) return requested;
    const settlement = await input.runtime.options.toolRuntime.executeTool(request, {
      policyContext: input.policyContext,
      ...(input.plan.timeoutPolicy.toolTimeoutMs === undefined ? {} : {
        timeoutMs: input.plan.timeoutPolicy.toolTimeoutMs
      })
    });
    if (!settlement.ok) return settlement;
    settlements.push(settlement.value);
    const settlementRef = settlement.value.settlementRef;
    const settlementRefs = settlementRef === undefined ? turn.toolSettlementRefs : [...turn.toolSettlementRefs, settlementRef];
    turn = {
      ...turn,
      toolCallRefs: [...turn.toolCallRefs, request.toolCallId],
      toolSettlementRefs: settlementRefs,
      status: "settled"
    };
    record = mutateAttempt(record, {
      status: "settling",
      toolCallRefs: [...record.toolCallRefs, request.toolCallId],
      toolSettlementRefs: settlementRef === undefined
        ? record.toolSettlementRefs
        : [...record.toolSettlementRefs, settlementRef]
    });
    const turnWrite = await input.runtime.storage.writeTurn(turn);
    if (!turnWrite.ok) return turnWrite;
    const recordWrite = await input.runtime.storage.writeAttempt(record, "record tool settlement");
    if (!recordWrite.ok) return recordWrite;
    const event = await appendAttemptEvent({
      runtime: input.runtime,
      record,
      eventType: attemptEventTypes.toolSettlementRecorded,
      body: {
        toolCallId: settlement.value.toolCallId,
        settlementRef,
        status: settlement.value.status,
        resultArtifactRef: settlement.value.resultArtifactRef,
        nextActionHint: settlement.value.nextActionHint
      }
    });
    if (!event.ok) return event;
  }
  const exitReason = exitReasonForSettlements(settlements, input.plan);
  return ok({
    record,
    turn,
    settlements,
    ...(exitReason === undefined ? {} : { exitReason })
  });
}

export function settlementArtifacts(settlements: readonly ToolSettlement[]): readonly ArtifactRef[] {
  const refs: ArtifactRef[] = [];
  for (const settlement of settlements) {
    if (settlement.settlementRef !== undefined) refs.push(settlement.settlementRef);
    if (settlement.resultArtifactRef !== undefined) refs.push(settlement.resultArtifactRef);
  }
  return uniqueArtifacts(refs);
}

function toToolCallRequest(
  input: Parameters<typeof settleToolCalls>[0],
  block: ToolCallBlock,
  surface: RuntimeToolSurfaceSummary
): ToolCallRequest {
  const toolRef = resolveToolRef(block.name, surface.entries);
  return {
    toolCallId: makeToolCallId(`tool-call-${randomUUID()}`),
    toolRef,
    attemptRef: input.record.attemptRef,
    growUnitRef: input.record.growUnitRef,
    messageListRef: input.turn.messageListRef,
    requestedBy: "grow_attempt_runner",
    input: normalizeToolInput(block),
    requestedCapabilities: [],
    reason: `model requested tool ${block.name}`,
    ...(input.record.correlationId === undefined ? {} : { correlationId: input.record.correlationId }),
    source: input.record.source,
    version: input.record.version,
    audit: input.record.audit
  };
}

function resolveToolRef(name: string, entries: readonly ToolSurfaceEntry[]): ToolRef {
  const match = entries.find((entry) =>
    entry.name === name || `${entry.namespace}.${entry.name}` === name || entry.toolRef.id === name
  );
  if (match !== undefined) return match.toolRef;
  return makeRef("tool", makeToolId(name), { uri: `tool://unresolved/${name}` }) as ToolRef;
}

function normalizeToolInput(block: ToolCallBlock): JsonValue {
  if (isJsonValue(block.arguments)) return block.arguments;
  try {
    const parsed = JSON.parse(block.argumentsText);
    return isJsonValue(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function exitReasonForSettlements(
  settlements: readonly ToolSettlement[],
  plan: AttemptExecutionPlan
): AttemptExitReason | undefined {
  const failed = settlements.filter((settlement) => settlement.status !== "settled_success");
  if (failed.length === 0 || plan.toolUsePolicy.continueAfterToolFailure) return undefined;
  const blocked = failed.find((settlement) => settlement.status === "policy_blocked");
  if (blocked?.error?.message.toLowerCase().includes("ask")) return "approval_required";
  if (blocked !== undefined) return "policy_blocked";
  return "tool_failed";
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).every(isJsonValue);
}

function uniqueArtifacts(refs: readonly ArtifactRef[]): readonly ArtifactRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (seen.has(ref.id)) return false;
    seen.add(ref.id);
    return true;
  });
}

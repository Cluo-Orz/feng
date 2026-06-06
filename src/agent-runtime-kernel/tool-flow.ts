import { ok, type ArtifactRef, type MessageListRef, type Result } from "../domain/index.js";
import {
  makeToolCallId,
  type JsonValue,
  type ToolCallRequest,
  type ToolDefinition,
  type ToolSettlement
} from "../tool-runtime/index.js";
import type { ToolCallBlock } from "../llm-gateway/index.js";
import { runtimeErr } from "./errors.js";
import { appendRuntimeEvent, runtimeEventTypes, type AgentRuntime } from "./runtime.js";
import type { RuntimeInvocation, RuntimeTurnOptions } from "./types.js";

export interface ToolSettlementResult {
  readonly settlements: readonly ToolSettlement[];
  readonly settlementRefs: readonly ArtifactRef[];
}

export async function settleRuntimeToolCalls(input: {
  readonly runtime: AgentRuntime;
  readonly invocation: RuntimeInvocation;
  readonly messageListRef: MessageListRef;
  readonly blocks: readonly ToolCallBlock[];
  readonly options: RuntimeTurnOptions;
}): Promise<Result<ToolSettlementResult>> {
  if (input.blocks.length === 0) return ok({ settlements: [], settlementRefs: [] });
  if (input.options.policyContext === undefined) {
    return runtimeErr({ code: "policy_blocked", message: "tool execution requires policy context" });
  }
  const max = Math.max(0, input.options.maxToolCalls ?? 8);
  if (input.blocks.length > max) {
    return runtimeErr({ code: "tool_failed", message: `tool call count ${input.blocks.length} exceeds max ${max}` });
  }
  const tools = await input.runtime.options.toolRuntime.listTools({ lifecycle: "active" });
  if (!tools.ok) return tools;
  const settlements: ToolSettlement[] = [];
  for (const block of input.blocks) {
    const tool = resolveTool(tools.value.records, block.name);
    if (tool === undefined) {
      return runtimeErr({ code: "tool_unavailable", message: `tool ${block.name} is not active` });
    }
    const request = toolRequest(input, block, tool);
    const settlement = await input.runtime.options.toolRuntime.executeTool(request, {
      policyContext: input.options.policyContext,
      ...(input.options.timeoutMs === undefined ? {} : { timeoutMs: input.options.timeoutMs })
    });
    if (!settlement.ok) return settlement;
    settlements.push(settlement.value);
    const event = await appendRuntimeEvent({
      runtime: input.runtime,
      invocationRef: input.invocation.runtimeInvocationRef,
      eventType: runtimeEventTypes.toolSettlementRecorded,
      body: { toolCallId: request.toolCallId, toolRef: tool.toolRef, status: settlement.value.status, settlementRef: settlement.value.settlementRef },
      source: input.invocation.source,
      audit: input.invocation.audit,
      correlationId: input.invocation.correlationId
    });
    if (!event.ok) return event;
  }
  return ok({
    settlements,
    settlementRefs: settlements.flatMap((item) => item.settlementRef === undefined ? [] : [item.settlementRef])
  });
}

function toolRequest(
  input: {
    readonly invocation: RuntimeInvocation;
    readonly messageListRef: MessageListRef;
  },
  block: ToolCallBlock,
  tool: ToolDefinition
): ToolCallRequest {
  return {
    toolCallId: makeToolCallId(block.callId || `runtime-tool-call-${tool.toolId}`),
    toolRef: tool.toolRef,
    toolVersion: tool.version.schemaVersion,
    messageListRef: input.messageListRef,
    requestedBy: "agent_runtime_kernel",
    input: parseInput(block),
    requestedCapabilities: tool.declaredCapabilities,
    reason: `runtime model requested tool ${block.name}`,
    ...(input.invocation.correlationId === undefined ? {} : { correlationId: input.invocation.correlationId }),
    source: input.invocation.source,
    version: input.invocation.version,
    audit: input.invocation.audit
  };
}

function resolveTool(tools: readonly ToolDefinition[], name: string): ToolDefinition | undefined {
  return tools.find((tool) => tool.name === name || `${tool.namespace}.${tool.name}` === name);
}

function parseInput(block: ToolCallBlock): JsonValue {
  if (block.arguments !== undefined) return toJsonValue(block.arguments);
  try {
    return toJsonValue(JSON.parse(block.argumentsText || "{}"));
  } catch {
    return { rawArgumentsText: block.argumentsText };
  }
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) out[key] = toJsonValue(item);
    return out;
  }
  return String(value);
}

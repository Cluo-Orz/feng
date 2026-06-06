import { randomUUID } from "node:crypto";
import { ok, type MessageListRef, type Result } from "../domain/index.js";
import { makeLLMRequestId, type LLMRequest, type NormalizedLLMResponse } from "../llm-gateway/index.js";
import type { ToolDefinition } from "../tool-runtime/index.js";
import type { ToolSurfaceSummary } from "../context-message-compiler/index.js";
import { runtimeErr } from "./errors.js";
import {
  appendRuntimeEvent,
  evaluateRuntimePolicy,
  policyAllows,
  runtimeEventTypes,
  type AgentRuntime
} from "./runtime.js";
import type { RuntimeInvocation, RuntimeTurnOptions } from "./types.js";

export async function callRuntimeLLM(input: {
  readonly runtime: AgentRuntime;
  readonly invocation: RuntimeInvocation;
  readonly messageListRef: MessageListRef;
  readonly options: RuntimeTurnOptions;
}): Promise<Result<NormalizedLLMResponse | undefined>> {
  if (input.invocation.mode === "dry_run") return ok(undefined);
  if (input.invocation.mode === "replay") {
    return input.options.replayResponse === undefined
      ? runtimeErr({ code: "invalid_input", message: "replay mode requires replayResponse" })
      : ok(input.options.replayResponse);
  }
  const decision = await evaluateRuntimePolicy({
    runtime: input.runtime,
    invocation: input.invocation,
    capability: "external_service.call",
    operation: "send_llm_request",
    resourceSummary: `${input.invocation.modelSelection.provider}/${input.invocation.modelSelection.model}`,
    reason: "Agent Runtime Kernel LLM turn",
    source: input.invocation.source,
    context: input.options.policyContext
  });
  if (!decision.ok) return decision;
  if (!policyAllows(decision.value)) {
    return runtimeErr({ code: "policy_blocked", message: `LLM provider policy verdict is ${decision.value.verdict}` });
  }
  const tools = await input.runtime.options.toolRuntime.listTools({
    ...(input.invocation.toolCatalogQuery ?? {}),
    lifecycle: "active"
  });
  if (!tools.ok) return tools;
  const messageList = await input.runtime.storage.readMessageList(input.messageListRef);
  if (!messageList.ok) return messageList;
  const request: LLMRequest = {
    requestId: makeLLMRequestId(`runtime-llm-request-${randomUUID()}`),
    messageListRef: input.messageListRef,
    providerNeutralMessages: messageList.value.providerNeutralMessages,
    modelSelection: input.invocation.modelSelection,
    requiredCapabilities: input.invocation.requiredCapabilities,
    toolSurfaceSummary: tools.value.records.map(toolSurface),
    streaming: false,
    ...(input.options.timeoutMs === undefined ? {} : { timeoutMs: input.options.timeoutMs }),
    ...(input.options.retryPolicy === undefined ? {} : { retryPolicy: input.options.retryPolicy }),
    ...(input.options.fallbackPolicy === undefined ? {} : { fallbackPolicy: input.options.fallbackPolicy }),
    policyDecisionId: decision.value.policyDecisionId,
    ...(input.invocation.correlationId === undefined ? {} : { correlationId: input.invocation.correlationId }),
    source: input.invocation.source,
    version: input.invocation.version,
    audit: input.invocation.audit
  };
  const response = await input.runtime.options.llmGateway.sendLLMRequest(request);
  if (!response.ok) {
    return response.error.code === "llm_failed" ? response : runtimeErr({
      code: response.error.code,
      message: response.error.message,
      ...(response.error.evidenceRef === undefined ? {} : { evidenceRef: response.error.evidenceRef }),
      cause: response.error
    });
  }
  const event = await appendRuntimeEvent({
    runtime: input.runtime,
    invocationRef: input.invocation.runtimeInvocationRef,
    eventType: runtimeEventTypes.llmCallCompleted,
    body: { requestId: request.requestId, receiptRef: response.value.receiptRef, finishReason: response.value.finishReason },
    source: input.invocation.source,
    audit: input.invocation.audit,
    correlationId: input.invocation.correlationId
  });
  return event.ok ? ok(response.value) : event;
}

function toolSurface(tool: ToolDefinition): ToolSurfaceSummary {
  return {
    toolId: tool.toolId,
    name: `${tool.namespace}.${tool.name}`,
    capabilitySummary: tool.description,
    policyBoundarySummary: tool.sideEffects.summary,
    inclusionReason: "active tool visible to Agent Runtime Kernel",
    safeForModel: tool.lifecycle === "active" && tool.risk !== "critical"
  };
}

import type { ToolRef } from "../domain/index.js";
import { appendToolRuntimeEvent, type toolRuntimeEventTypes } from "./events.js";
import { ToolRuntimeStorage } from "./storage.js";
import type {
  ToolCallRequest,
  ToolDefinition,
  ToolExecutionId,
  ToolImplementation,
  ToolRuntimeOptions
} from "./types.js";

export interface ActiveToolExecution {
  readonly executionId: ToolExecutionId;
  readonly toolRef: ToolRef;
  readonly request: ToolCallRequest;
  readonly definition: ToolDefinition;
  readonly controller: AbortController;
  readonly implementation?: ToolImplementation;
  readonly startedAt: string;
}

export interface ToolRuntimeRuntime {
  readonly options: ToolRuntimeOptions;
  readonly storage: ToolRuntimeStorage;
  readonly implementations: ReadonlyMap<string, ToolImplementation>;
  readonly active: Map<string, ActiveToolExecution>;
}

export function createToolRuntimeRuntime(options: ToolRuntimeOptions): ToolRuntimeRuntime {
  return {
    options,
    storage: new ToolRuntimeStorage(options.store, options.workspace),
    implementations: new Map((options.implementations ?? []).map((item) => [item.implementationId, item])),
    active: new Map()
  };
}

export function activeCountForTool(runtime: ToolRuntimeRuntime, toolRef: ToolRef): number {
  let count = 0;
  for (const execution of runtime.active.values()) {
    if (execution.toolRef.id === toolRef.id) count += 1;
  }
  return count;
}

export function appendToolEvent(input: {
  readonly runtime: ToolRuntimeRuntime;
  readonly eventType: (typeof toolRuntimeEventTypes)[keyof typeof toolRuntimeEventTypes];
  readonly body: Record<string, unknown>;
  readonly request?: ToolCallRequest;
}) {
  return appendToolRuntimeEvent({
    ledger: input.runtime.options.ledger,
    workspace: input.runtime.options.workspace,
    producer: input.runtime.options.producer,
    eventType: input.eventType,
    body: input.body,
    source: input.request?.source ?? {
      kind: "system",
      origin: "tool-runtime",
      workspace: input.runtime.options.workspace.id,
      userProvided: false,
      receivedAt: new Date().toISOString(),
      privacyLevel: "workspace_private"
    },
    audit: input.request?.audit ?? {
      createdAt: new Date().toISOString(),
      createdBy: input.runtime.options.producer,
      reason: "tool runtime event"
    },
    ...(input.request?.correlationId === undefined ? {} : { correlationId: input.request.correlationId })
  });
}

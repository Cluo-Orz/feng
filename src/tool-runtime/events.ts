import { makeLedgerStreamId, type EventLedger, type LedgerStream } from "../event-ledger/index.js";
import type { AuditDescriptor, SourceDescriptor } from "../domain/index.js";
import type { WorkspaceHandle } from "../file-store/index.js";
import { toToolEventPayload } from "./payloads.js";

export const toolRuntimeEventTypes = {
  discovered: "tool_discovered",
  registered: "tool_registered",
  lifecycleChanged: "tool_lifecycle_changed",
  surfaceDescribed: "tool_surface_described",
  callReceived: "tool_call_received",
  inputValidated: "tool_input_validated",
  policyChecked: "tool_policy_checked",
  executionStarted: "tool_execution_started",
  executionCompleted: "tool_execution_completed",
  executionFailed: "tool_execution_failed",
  executionCancelled: "tool_execution_cancelled",
  resultRegistered: "tool_result_registered",
  callSettled: "tool_call_settled"
} as const;

export function toolRuntimeStream(workspace: WorkspaceHandle): LedgerStream {
  return {
    streamType: "tool",
    streamId: makeLedgerStreamId(`tool-runtime:${workspace.id}`)
  };
}

export async function appendToolRuntimeEvent(input: {
  readonly ledger: EventLedger;
  readonly workspace: WorkspaceHandle;
  readonly producer: string;
  readonly eventType: (typeof toolRuntimeEventTypes)[keyof typeof toolRuntimeEventTypes];
  readonly body: Record<string, unknown>;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly correlationId?: string;
}) {
  return input.ledger.appendEvent(toolRuntimeStream(input.workspace), {
    eventType: input.eventType,
    eventVersion: "1",
    payload: toToolEventPayload(input.body),
    source: input.source,
    audit: input.audit,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    producer: input.producer
  });
}

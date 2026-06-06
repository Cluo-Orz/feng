import type { WorkspaceHandle } from "../file-store/index.js";
import { makeLedgerStreamId, type LedgerStream } from "../event-ledger/index.js";

export const llmGatewayEventTypes = {
  requestStarted: "llm_request_started",
  streamEventNormalized: "llm_stream_event_normalized",
  responseCompleted: "llm_response_completed",
  requestFailed: "llm_request_failed",
  retryPerformed: "llm_retry_performed",
  fallbackPerformed: "llm_fallback_performed",
  modelCapabilityChecked: "model_capability_checked"
} as const;

export function llmGatewayStream(workspace: WorkspaceHandle): LedgerStream {
  return {
    streamType: "workspace",
    streamId: makeLedgerStreamId(`llm-gateway:${workspace.id}`)
  };
}

import { makeLedgerStreamId, type LedgerStream } from "../event-ledger/index.js";
import type { WorkspaceId } from "../domain/index.js";

export const cliEventTypes = {
  invocationStarted: "cli_invocation_started",
  invocationCompleted: "cli_invocation_completed"
} as const;

export function cliStream(workspace: WorkspaceId): LedgerStream {
  return { streamType: "workspace", streamId: makeLedgerStreamId(`cli-${workspace}`) };
}

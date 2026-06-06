import type { AuditDescriptor, SourceDescriptor } from "../../src/domain/index.js";
import type { WorkspaceHandle } from "../../src/file-store/index.js";
import {
  createEventLedger,
  makeIdempotencyKey,
  makeLedgerStreamId,
  makeProjectionKey,
  makeProjectionName,
  type AppendEventInput,
  type EventLedger,
  type LedgerStream
} from "../../src/event-ledger/index.js";
import type { TempWorkspace } from "../file-store/helpers.js";

export interface LedgerFixture extends TempWorkspace {
  readonly ledger: EventLedger;
  readonly stream: LedgerStream;
}

export function makeLedgerFixture(workspace: TempWorkspace): LedgerFixture {
  return {
    ...workspace,
    ledger: createEventLedger(workspace.store, { workspace: workspace.workspace, producer: "test-ledger" }),
    stream: { streamType: "grow_unit", streamId: makeLedgerStreamId("grow-1") }
  };
}

export function source(workspace: WorkspaceHandle): SourceDescriptor {
  return {
    kind: "system",
    origin: "event-ledger-test",
    workspace: workspace.id,
    userProvided: false,
    receivedAt: "2026-06-06T00:00:00.000Z",
    privacyLevel: "workspace_private"
  };
}

export function audit(reason: string): AuditDescriptor {
  return {
    createdAt: "2026-06-06T00:00:00.000Z",
    createdBy: "event-ledger-test",
    reason
  };
}

export function eventInput(
  workspace: WorkspaceHandle,
  n: number,
  extra: Partial<AppendEventInput> = {}
): AppendEventInput {
  return {
    eventType: "test.event",
    eventVersion: "1",
    payload: { n },
    source: source(workspace),
    audit: audit(`event-${n}`),
    ...extra
  };
}

export const idem = (value: string) => makeIdempotencyKey(value);
export const projectionName = makeProjectionName("count");
export const projectionKey = makeProjectionKey("grow-1");

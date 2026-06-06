import type { AuditDescriptor, SourceDescriptor } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import type { EventAppendReceipt } from "../event-ledger/index.js";
import { attemptEventTypes, attemptStream } from "./events.js";
import { payload } from "./payloads.js";
import { AttemptStorage } from "./storage.js";
import type {
  AttemptCheckpointRef,
  AttemptRecord,
  GrowAttemptRunnerOptions
} from "./types.js";

export interface AttemptRuntime {
  readonly options: GrowAttemptRunnerOptions;
  readonly storage: AttemptStorage;
}

export function createAttemptRuntime(options: GrowAttemptRunnerOptions): AttemptRuntime {
  return { options, storage: new AttemptStorage(options.store, options.workspace) };
}

export async function appendAttemptEvent(input: {
  readonly runtime: AttemptRuntime;
  readonly record: AttemptRecord;
  readonly eventType: string;
  readonly body: Record<string, unknown>;
  readonly source?: SourceDescriptor;
  readonly audit?: AuditDescriptor;
  readonly correlationId?: string;
}): Promise<Result<EventAppendReceipt>> {
  const correlationId = input.correlationId ?? input.record.correlationId;
  return input.runtime.options.ledger.appendEvent(attemptStream(input.record.attemptRef), {
    eventType: input.eventType,
    eventVersion: "1",
    payload: payload({ ...input.body, record: summarizeAttemptRecord(input.record) }),
    source: input.source ?? input.record.source,
    audit: input.audit ?? input.record.audit,
    ...(correlationId === undefined ? {} : { correlationId }),
    producer: input.runtime.options.producer
  });
}

export async function writeRecordWithEvent(input: {
  readonly runtime: AttemptRuntime;
  readonly record: AttemptRecord;
  readonly eventType: string;
  readonly body: Record<string, unknown>;
  readonly reason: string;
  readonly source?: SourceDescriptor;
  readonly audit?: AuditDescriptor;
}): Promise<Result<AttemptRecord>> {
  const write = await input.runtime.storage.writeAttempt(input.record, input.reason);
  if (!write.ok) return write;
  const event = await appendAttemptEvent(input);
  return event.ok ? ok(input.record) : event;
}

export function mutateAttempt(
  record: AttemptRecord,
  patch: Partial<Omit<AttemptRecord, "attemptId" | "attemptRef" | "growUnitRef" | "attemptIntentRef" | "recordVersion">>
): AttemptRecord {
  return { ...record, ...patch, recordVersion: record.recordVersion + 1 };
}

export function latestCheckpointRef(record: AttemptRecord): AttemptCheckpointRef | undefined {
  return record.checkpointRefs.at(-1);
}

export function terminalStatus(status: AttemptRecord["status"]): boolean {
  return status === "completed" || status === "failed" || status === "interrupted" || status === "cancelled";
}

export function summarizeAttemptRecord(record: AttemptRecord): Record<string, unknown> {
  return {
    attemptRef: record.attemptRef,
    growUnitRef: record.growUnitRef,
    attemptIntentRef: record.attemptIntentRef,
    status: record.status,
    turnCount: record.turnRefs.length,
    checkpointCount: record.checkpointRefs.length,
    messageListCount: record.messageListRefs.length,
    candidateOutputCount: record.candidateOutputRefs.length,
    toolSettlementCount: record.toolSettlementRefs.length,
    providerReceiptCount: record.providerReceiptRefs.length,
    exitReason: record.exitReason,
    recordVersion: record.recordVersion
  };
}

export { attemptEventTypes };

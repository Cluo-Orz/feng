import type { AuditDescriptor, FeedbackUnitRef, GrowUnitRef, SourceDescriptor } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import type { EventAppendReceipt } from "../event-ledger/index.js";
import type { FileNativeStore } from "../file-store/index.js";
import { admissionGrowStream, feedbackStream } from "./events.js";
import { admissionErr } from "./errors.js";
import { payload } from "./payloads.js";
import { AdmissionStorage } from "./storage.js";
import type { AdmissionFeedbackInboxOptions } from "./types.js";

export interface AdmissionRuntime {
  readonly store: FileNativeStore;
  readonly storage: AdmissionStorage;
  readonly options: AdmissionFeedbackInboxOptions;
}

export function createAdmissionRuntime(
  store: FileNativeStore,
  options: AdmissionFeedbackInboxOptions
): AdmissionRuntime {
  return { store, options, storage: new AdmissionStorage(store, options.workspace) };
}

export async function ensureGrowUnitWritable(runtime: AdmissionRuntime, growUnitRef: GrowUnitRef): Promise<Result<void>> {
  const record = await runtime.options.growUnitManager.getGrowUnit(growUnitRef);
  if (!record.ok) return record;
  if (record.value.lifecycle === "archived") {
    return admissionErr({ code: "grow_unit_archived", message: "archived grow unit cannot receive admission changes" });
  }
  return ok(undefined);
}

export async function appendGrowEvent(input: {
  readonly runtime: AdmissionRuntime;
  readonly growUnitRef: GrowUnitRef;
  readonly eventType: string;
  readonly body: Record<string, unknown>;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly correlationId?: string;
}): Promise<Result<EventAppendReceipt>> {
  return input.runtime.options.ledger.appendEvent(admissionGrowStream(input.growUnitRef), {
    eventType: input.eventType,
    eventVersion: "1",
    payload: payload(input.body),
    source: input.source,
    audit: input.audit,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    producer: input.runtime.options.producer
  });
}

export async function appendFeedbackEvent(input: {
  readonly runtime: AdmissionRuntime;
  readonly feedbackUnitRef: FeedbackUnitRef;
  readonly eventType: string;
  readonly body: Record<string, unknown>;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}): Promise<Result<EventAppendReceipt>> {
  return input.runtime.options.ledger.appendEvent(feedbackStream(input.feedbackUnitRef), {
    eventType: input.eventType,
    eventVersion: "1",
    payload: payload(input.body),
    source: input.source,
    audit: input.audit,
    producer: input.runtime.options.producer
  });
}

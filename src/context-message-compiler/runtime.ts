import type { AuditDescriptor, GrowUnitRef, SourceDescriptor } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import type { EventAppendReceipt, AppendEventInput } from "../event-ledger/index.js";
import type { FileNativeStore } from "../file-store/index.js";
import { ContextStorage } from "./storage.js";
import { contextGrowStream } from "./events.js";
import { payload } from "./payloads.js";
import type { ContextMessageCompilerOptions } from "./types.js";

export interface ContextRuntime {
  readonly store: FileNativeStore;
  readonly storage: ContextStorage;
  readonly options: ContextMessageCompilerOptions;
}

export function createContextRuntime(store: FileNativeStore, options: ContextMessageCompilerOptions): ContextRuntime {
  return { store, options, storage: new ContextStorage(store, options.workspace) };
}

export async function ensureGrowUnitCompilable(
  runtime: ContextRuntime,
  growUnitRef: GrowUnitRef
): Promise<Result<void>> {
  const record = await runtime.options.growUnitManager.getGrowUnit(growUnitRef);
  if (!record.ok) return record;
  if (record.value.lifecycle === "archived") {
    return contextErrResult("grow_unit_archived", "archived grow unit cannot compile a new message list");
  }
  return ok(undefined);
}

export async function appendContextEvent(input: {
  readonly runtime: ContextRuntime;
  readonly growUnitRef: GrowUnitRef;
  readonly eventType: string;
  readonly body: Record<string, unknown>;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly correlationId?: string;
}): Promise<Result<EventAppendReceipt>> {
  return input.runtime.options.ledger.appendEvent(contextGrowStream(input.growUnitRef), {
    eventType: input.eventType,
    eventVersion: "1",
    payload: payload(input.body),
    source: input.source,
    audit: input.audit,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    producer: input.runtime.options.producer
  });
}

export async function appendContextBatch(input: {
  readonly runtime: ContextRuntime;
  readonly growUnitRef: GrowUnitRef;
  readonly events: readonly Omit<AppendEventInput, "eventVersion" | "producer">[];
}): Promise<Result<EventAppendReceipt>> {
  return input.runtime.options.ledger.appendBatch(
    contextGrowStream(input.growUnitRef),
    input.events.map((event) => ({ ...event, eventVersion: "1", producer: input.runtime.options.producer }))
  );
}

function contextErrResult(code: "grow_unit_archived", message: string): Result<void> {
  return {
    ok: false,
    error: {
      code,
      message,
      module: "context-message-compiler",
      severity: "error",
      retryable: false
    }
  };
}

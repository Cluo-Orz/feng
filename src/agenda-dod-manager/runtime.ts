import type { AuditDescriptor, GrowUnitRef, SourceDescriptor } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import type { EventAppendReceipt } from "../event-ledger/index.js";
import type { FileNativeStore } from "../file-store/index.js";
import { agendaGrowStream } from "./events.js";
import { agendaErr } from "./errors.js";
import { payload } from "./payloads.js";
import { AgendaStorage } from "./storage.js";
import type { AgendaDoDManagerOptions } from "./types.js";

export interface AgendaRuntime {
  readonly store: FileNativeStore;
  readonly storage: AgendaStorage;
  readonly options: AgendaDoDManagerOptions;
}

export function createAgendaRuntime(store: FileNativeStore, options: AgendaDoDManagerOptions): AgendaRuntime {
  return { store, options, storage: new AgendaStorage(store, options.workspace) };
}

export async function ensureGrowUnitWritable(runtime: AgendaRuntime, growUnitRef: GrowUnitRef): Promise<Result<void>> {
  const record = await runtime.options.growUnitManager.getGrowUnit(growUnitRef);
  if (!record.ok) return record;
  if (record.value.lifecycle === "archived") {
    return agendaErr({ code: "grow_unit_archived", message: "archived grow unit cannot change agenda" });
  }
  return ok(undefined);
}

export async function appendAgendaEvent(input: {
  readonly runtime: AgendaRuntime;
  readonly growUnitRef: GrowUnitRef;
  readonly eventType: string;
  readonly body: Record<string, unknown>;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}): Promise<Result<EventAppendReceipt>> {
  return input.runtime.options.ledger.appendEvent(agendaGrowStream(input.growUnitRef), {
    eventType: input.eventType,
    eventVersion: "1",
    payload: payload(input.body),
    source: input.source,
    audit: input.audit,
    producer: input.runtime.options.producer
  });
}

import type { GrowUnitRef } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import type { WriteReceipt } from "../file-store/index.js";
import { agendaEventTypes, agendaGrowStream } from "./events.js";
import { agendaErr } from "./errors.js";
import { compact, newAgendaRef, nonEmpty } from "./logic.js";
import { projectAgendaEvents } from "./projection.js";
import type { AgendaRuntime } from "./runtime.js";
import { appendAgendaEvent, ensureGrowUnitWritable } from "./runtime.js";
import type { AgendaRecord, AgendaRef, CreateAgendaInput } from "./types.js";

export async function createAgendaRecord(
  runtime: AgendaRuntime,
  growUnitRef: GrowUnitRef,
  input: CreateAgendaInput
): Promise<Result<AgendaRef>> {
  const writable = await ensureGrowUnitWritable(runtime, growUnitRef);
  if (!writable.ok) return writable;
  const existing = await findAgendaForGrow(runtime, growUnitRef);
  if (existing.ok) return agendaErr({ code: "agenda_conflict", message: "grow unit already has an agenda" });
  if (existing.error.code !== "not_found") return existing;
  const goal = nonEmpty(input.goalBoundarySummary, "goalBoundarySummary");
  if (!goal.ok) return goal;
  const agendaRef = newAgendaRef();
  const now = new Date().toISOString();
  const record: AgendaRecord = {
    agendaId: agendaRef.id,
    agendaRef,
    growUnitRef,
    goalBoundarySummary: goal.value,
    currentFocus: compact(input.currentFocus ?? goal.value, 2_000),
    agendaItemRefs: [],
    gapRefs: [],
    dodRefs: [],
    latestEvaluationRefs: [],
    ...(input.recommendedGrowState === undefined ? {} : { recommendedGrowState: input.recommendedGrowState }),
    source: input.source,
    version: input.version,
    audit: input.audit,
    createdAt: now,
    updatedAt: now,
    recordVersion: 1
  };
  const event = await appendAgendaEvent({
    runtime,
    growUnitRef,
    eventType: agendaEventTypes.agendaCreated,
    body: { record },
    source: input.source,
    audit: input.audit
  });
  if (!event.ok) return event;
  const written = await writeAgendaWithIndex(runtime, record, "write agenda");
  return written.ok ? ok(agendaRef) : written;
}

export async function getAgendaRecord(runtime: AgendaRuntime, growUnitRef: GrowUnitRef): Promise<Result<AgendaRecord>> {
  const existing = await findAgendaForGrow(runtime, growUnitRef);
  if (existing.ok || existing.error.code !== "not_found") return existing;
  const replay = await runtime.options.ledger.replayStream(agendaGrowStream(growUnitRef), {
    reason: "rebuild agenda from grow stream"
  });
  if (!replay.ok) return replay;
  const projected = projectAgendaEvents(replay.value.events);
  if (!projected.ok) return projected;
  const written = await writeAgendaWithIndex(runtime, projected.value, "recover agenda projection");
  return written.ok ? ok(projected.value) : written;
}

export async function findAgendaForGrow(runtime: AgendaRuntime, growUnitRef: GrowUnitRef): Promise<Result<AgendaRecord>> {
  const all = await runtime.storage.readAllAgendas();
  if (!all.ok) return all;
  const records = all.value.filter((record) => record.growUnitRef.id === growUnitRef.id);
  if (records.length === 0) return agendaErr({ code: "not_found", message: "agenda not found for grow unit" });
  if (records.length > 1) return agendaErr({ code: "agenda_conflict", message: "grow unit has multiple agendas" });
  return ok(records[0]!);
}

async function writeAgendaWithIndex(
  runtime: AgendaRuntime,
  record: AgendaRecord,
  reason: string
): Promise<Result<WriteReceipt>> {
  const write = await runtime.storage.writeAgenda(record, reason);
  if (!write.ok) return write;
  const index = await runtime.storage.addAgenda(record.agendaRef);
  return index.ok ? ok(write.value) : index;
}

import type { EventEnvelope, EventPayloadSummary } from "../event-ledger/index.js";
import { ok, type Result } from "../domain/result.js";
import { growUnitEventTypes } from "./events.js";
import { growUnitErr } from "./errors.js";
import { phaseForLifecycle } from "./lifecycle.js";
import type { GrowUnitPhase, GrowUnitRecord } from "./types.js";
import type { GrowLifecycle } from "../domain/index.js";

export function projectGrowUnitEvents(events: readonly EventEnvelope[]): Result<GrowUnitRecord> {
  let record: GrowUnitRecord | undefined;
  for (const event of events) {
    const next = applyEvent(record, event);
    if (!next.ok) return next;
    record = next.value;
  }
  return record === undefined
    ? growUnitErr({ code: "not_found", message: "grow unit stream has no create event" })
    : ok(record);
}

function applyEvent(record: GrowUnitRecord | undefined, event: EventEnvelope): Result<GrowUnitRecord | undefined> {
  if (event.eventType === growUnitEventTypes.created) return created(event.payload);
  if (record === undefined) return ok(undefined);
  const now = event.createdAt;
  const payload = asObject(event.payload);
  if (payload === undefined) {
    return growUnitErr({ code: "schema_incompatible", message: "grow unit event payload is invalid" });
  }
  if (event.eventType === growUnitEventTypes.lifecycleChanged) {
    return ok({ ...record, lifecycle: stringValue(payload, "to"), currentPhase: phaseValue(payload), updatedAt: now, recordVersion: record.recordVersion + 1 });
  }
  if (event.eventType === growUnitEventTypes.blocked) {
    return ok({ ...record, lifecycle: "blocked", currentPhase: "blocked", updatedAt: now, recordVersion: record.recordVersion + 1 });
  }
  if (event.eventType === growUnitEventTypes.unblocked || event.eventType === growUnitEventTypes.archived) {
    const lifecycle = stringValue(payload, "to");
    return ok({ ...record, lifecycle, currentPhase: phaseValue(payload), updatedAt: now, recordVersion: record.recordVersion + 1 });
  }
  if (event.eventType === growUnitEventTypes.goalBoundaryUpdated) {
    return ok({
      ...record,
      goalBoundarySummary: stringValue(payload, "goalBoundarySummary"),
      targetBehaviorSummary: optionalString(payload, "targetBehaviorSummary") ?? record.targetBehaviorSummary,
      updatedAt: now,
      recordVersion: record.recordVersion + 1
    });
  }
  if (event.eventType === growUnitEventTypes.targetWorldLinked) {
    return ok({
      ...record,
      targetWorldSummaryRef: value(payload, "targetWorldSummaryRef"),
      targetBehaviorSummary: optionalString(payload, "targetBehaviorSummary") ?? record.targetBehaviorSummary,
      updatedAt: now,
      recordVersion: record.recordVersion + 1
    });
  }
  return ok(applyCoordination(record, event.eventType, payload, now));
}

function created(payload: EventPayloadSummary): Result<GrowUnitRecord> {
  const object = asObject(payload);
  const record = object === undefined ? undefined : object["record"];
  if (typeof record !== "object" || record === null) {
    return growUnitErr({ code: "schema_incompatible", message: "grow unit created event lacks record" });
  }
  return ok(record as GrowUnitRecord);
}

function applyCoordination(
  record: GrowUnitRecord,
  eventType: string,
  payload: Record<string, unknown>,
  updatedAt: string
): GrowUnitRecord {
  const base = { ...record, updatedAt, recordVersion: record.recordVersion + 1 };
  if (eventType === growUnitEventTypes.admissionStateLinked) return { ...base, admissionInboxRef: value(payload, "admissionInboxRef") };
  if (eventType === growUnitEventTypes.agendaStateLinked) return { ...base, agendaRef: value(payload, "agendaRef") };
  if (eventType === growUnitEventTypes.attemptLinked) return { ...base, activeAttemptRef: value(payload, "attemptRef") };
  if (eventType === growUnitEventTypes.messageListLinked) return { ...base, latestMessageListRef: value(payload, "messageListRef") };
  if (eventType === growUnitEventTypes.readinessVerdictApplied) {
    const validationReportRef = payload["validationReportRef"] as GrowUnitRecord["latestValidationReportRef"] | undefined;
    return {
      ...base,
      latestReadinessVerdictRef: value(payload, "readinessVerdictRef"),
      ...(validationReportRef === undefined ? {} : { latestValidationReportRef: validationReportRef })
    };
  }
  if (eventType === growUnitEventTypes.hatchPackageLinked) {
    return { ...base, latestHatchPackageRef: value(payload, "hatchPackageRef"), lifecycle: "hatched", currentPhase: "hatch" };
  }
  return base;
}

function asObject(payload: EventPayloadSummary): Record<string, unknown> | undefined {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : undefined;
}

function value<T>(payload: Record<string, unknown>, key: string): T {
  return payload[key] as T;
}

function stringValue(payload: Record<string, unknown>, key: string): GrowLifecycle {
  return String(payload[key]) as GrowLifecycle;
}

function optionalString(payload: Record<string, unknown>, key: string): string | undefined {
  const item = payload[key];
  return typeof item === "string" ? item : undefined;
}

function phaseValue(payload: Record<string, unknown>) {
  const phase = optionalString(payload, "currentPhase");
  return (phase ?? phaseForLifecycle(stringValue(payload, "to"))) as GrowUnitPhase;
}

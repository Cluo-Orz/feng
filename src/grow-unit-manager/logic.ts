import { makeGrowUnitId, makeRef, type GrowLifecycle, type GrowUnitRef } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import { randomUUID } from "node:crypto";
import { growUnitErr } from "./errors.js";
import type {
  ActiveSkillScopeSummary,
  CreateGrowUnitInput,
  GrowUnitListQuery,
  GrowUnitRecord,
  GrowUnitStateSnapshot,
  GrowUnitTransitionInput
} from "./types.js";
import { phaseForLifecycle } from "./lifecycle.js";

export function makeGrowUnitRef(id = makeGrowUnitId(`grow-${randomUUID()}`)): GrowUnitRef {
  return makeRef("grow_unit", id, { uri: `grow-unit://${id}` });
}

export function createRecord(input: CreateGrowUnitInput, workspace: GrowUnitRecord["workspace"]): Result<GrowUnitRecord> {
  if (input.title.trim().length === 0) return growUnitErr({ code: "invalid_input", message: "title is required" });
  if (input.goalBoundarySummary.trim().length === 0) {
    return growUnitErr({ code: "invalid_input", message: "goal boundary summary is required" });
  }
  if (input.targetBehaviorSummary.trim().length === 0) {
    return growUnitErr({ code: "invalid_input", message: "target behavior summary is required" });
  }
  const growUnitRef = makeGrowUnitRef();
  const now = new Date().toISOString();
  return ok({
    growUnitId: growUnitRef.id,
    growUnitRef,
    workspace,
    lifecycle: "created",
    title: input.title,
    goalBoundarySummary: input.goalBoundarySummary,
    targetBehaviorSummary: input.targetBehaviorSummary,
    ...(input.targetWorldSummaryRef === undefined ? {} : { targetWorldSummaryRef: input.targetWorldSummaryRef }),
    currentPhase: input.currentPhase ?? "intake",
    ...(input.admissionInboxRef === undefined ? {} : { admissionInboxRef: input.admissionInboxRef }),
    ...(input.agendaRef === undefined ? {} : { agendaRef: input.agendaRef }),
    ...(input.skillScopeRef === undefined ? {} : { skillScopeRef: input.skillScopeRef }),
    ...(input.policyScopeRef === undefined ? {} : { policyScopeRef: input.policyScopeRef }),
    createdAt: now,
    updatedAt: now,
    source: input.source,
    version: input.version,
    audit: input.audit,
    recordVersion: 1
  });
}

export function checkExpectedVersion(record: GrowUnitRecord, expected: number | undefined): Result<void> {
  if (expected !== undefined && expected !== record.recordVersion) {
    return growUnitErr({ code: "projection_stale", message: "grow unit record version is stale" });
  }
  return ok(undefined);
}

export function checkRequestedFrom(record: GrowUnitRecord, input: Pick<GrowUnitTransitionInput, "from">): Result<void> {
  if (input.from !== undefined && input.from !== record.lifecycle) {
    return growUnitErr({ code: "transition_conflict", message: "transition source does not match current lifecycle" });
  }
  return ok(undefined);
}

export function transitionRecord(
  record: GrowUnitRecord,
  to: GrowLifecycle,
  updatedAt: string,
  eventCount: number,
  currentPhase = phaseForLifecycle(to)
): GrowUnitRecord {
  return { ...record, lifecycle: to, currentPhase, updatedAt, recordVersion: record.recordVersion + eventCount };
}

export function activeRefs(record: GrowUnitRecord): readonly string[] {
  return [
    record.targetWorldSummaryRef,
    record.activeAttemptRef,
    record.latestMessageListRef,
    record.latestReadinessVerdictRef,
    record.latestValidationReportRef,
    record.latestHatchPackageRef,
    record.admissionInboxRef,
    record.agendaRef,
    record.skillScopeRef,
    record.policyScopeRef
  ]
    .filter((ref): ref is NonNullable<typeof ref> => ref !== undefined)
    .map((ref) => `${ref.kind}:${ref.id}`);
}

export function snapshot(
  record: GrowUnitRecord,
  eventCount: number,
  lastSequence: number | undefined,
  activeSkillSummaries: readonly ActiveSkillScopeSummary[],
  staleProjection: boolean
): GrowUnitStateSnapshot {
  return {
    record,
    eventCount,
    ...(lastSequence === undefined ? {} : { lastSequence }),
    recoveredAt: new Date().toISOString(),
    activeRefs: activeRefs(record),
    activeSkillSummaries,
    staleProjection
  };
}

export function matchesListQuery(record: GrowUnitRecord, query: GrowUnitListQuery): boolean {
  if (query.lifecycle !== undefined && record.lifecycle !== query.lifecycle) return false;
  if (query.includeArchived !== true && record.lifecycle === "archived") return false;
  if (query.text !== undefined) {
    const text = `${record.title}\n${record.goalBoundarySummary}\n${record.targetBehaviorSummary}`.toLowerCase();
    if (!text.includes(query.text.toLowerCase())) return false;
  }
  return true;
}

export function lifecycleFact(record: GrowUnitRecord): string {
  return `lifecycle=${record.lifecycle}, phase=${record.currentPhase}, version=${record.recordVersion}`;
}

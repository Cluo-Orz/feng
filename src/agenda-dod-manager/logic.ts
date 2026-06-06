import { randomUUID } from "node:crypto";
import { ok, type Result } from "../domain/result.js";
import { makeAgendaId, makeAgendaItemId, makeAttemptIntentId, makeDoDId, makeGapId } from "./brand.js";
import { agendaErr } from "./errors.js";
import { makeAgendaItemRef, makeAgendaRef, makeAttemptIntentRef, makeDoDRef, makeGapRef } from "./refs.js";
import type {
  AgendaItemRecord,
  AgendaItemStatus,
  AgendaRecord,
  DoDItemRecord,
  DoDLifecycle,
  GapRecord,
  GapStatus,
  PageQuery,
  RetryPolicy
} from "./types.js";

const terminalItemStatuses = new Set<AgendaItemStatus>(["rejected", "superseded", "retired"]);
const terminalGapStatuses = new Set<GapStatus>(["rejected", "superseded"]);
const openGapStatuses = new Set<GapStatus>([
  "open",
  "waiting_input",
  "waiting_policy",
  "waiting_validation",
  "retrying",
  "blocked"
]);
const terminalDoD = new Set<DoDLifecycle>(["retired", "superseded", "incompatible"]);

export const newAgendaRef = () => makeAgendaRef(makeAgendaId(`agenda-${randomUUID()}`));
export const newAgendaItemRef = () => makeAgendaItemRef(makeAgendaItemId(`agenda-item-${randomUUID()}`));
export const newGapRef = () => makeGapRef(makeGapId(`gap-${randomUUID()}`));
export const newDoDRef = () => makeDoDRef(makeDoDId(`dod-${randomUUID()}`));
export const newAttemptIntentRef = () =>
  makeAttemptIntentRef(makeAttemptIntentId(`attempt-intent-${randomUUID()}`));

export function nonEmpty(value: string, field: string): Result<string> {
  const text = compact(value, 4_000);
  return text.length === 0 ? agendaErr({ code: "invalid_input", message: `${field} is required` }) : ok(text);
}

export function normalizeRetryPolicy(input: Partial<RetryPolicy> = {}): RetryPolicy {
  const retryLimit = Math.max(1, Math.floor(input.retryLimit ?? 3));
  const attemptCount = Math.max(0, Math.floor(input.attemptCount ?? 0));
  return { attemptCount, retryLimit, onLimit: input.onLimit ?? "block" };
}

export function assertItemMutable(record: AgendaItemRecord): Result<void> {
  return terminalItemStatuses.has(record.status)
    ? agendaErr({ code: "agenda_conflict", message: `agenda item is terminal: ${record.status}` })
    : ok(undefined);
}

export function assertGapMutable(record: GapRecord): Result<void> {
  return terminalGapStatuses.has(record.status)
    ? agendaErr({ code: "gap_conflict", message: `gap is terminal: ${record.status}` })
    : ok(undefined);
}

export function assertDoDMutable(record: DoDItemRecord): Result<void> {
  return terminalDoD.has(record.lifecycle)
    ? agendaErr({ code: "dod_incompatible", message: `dod item is terminal: ${record.lifecycle}` })
    : ok(undefined);
}

export function assertNoDuplicateOpenGap(
  gaps: readonly GapRecord[],
  candidate: Pick<GapRecord, "kind" | "summary" | "growUnitRef">
): Result<void> {
  const normalized = compact(candidate.summary, 4_000).toLowerCase();
  const duplicate = gaps.find((gap) =>
    gap.growUnitRef.id === candidate.growUnitRef.id &&
    gap.kind === candidate.kind &&
    gap.summary.toLowerCase() === normalized &&
    openGapStatuses.has(gap.status)
  );
  return duplicate === undefined
    ? ok(undefined)
    : agendaErr({ code: "gap_conflict", message: `open gap already exists: ${duplicate.gapId}` });
}

export function assertRetryBudget(gaps: readonly GapRecord[]): Result<void> {
  const exhausted = gaps.find((gap) => openGapStatuses.has(gap.status) && gap.attemptCount >= gap.retryLimit);
  return exhausted === undefined
    ? ok(undefined)
    : agendaErr({ code: "retry_limit_reached", message: `retry limit reached for gap ${exhausted.gapId}` });
}

export function isOpenGap(record: GapRecord): boolean {
  return openGapStatuses.has(record.status);
}

export function withAgendaRef<T extends { readonly id: string }>(refs: readonly T[], ref: T): readonly T[] {
  return refs.some((item) => item.id === ref.id) ? refs : [...refs, ref];
}

export function updatedAgenda(record: AgendaRecord, patch: Partial<AgendaRecord>): AgendaRecord {
  return {
    ...record,
    ...patch,
    updatedAt: new Date().toISOString(),
    recordVersion: record.recordVersion + 1
  };
}

export function matchesGapQuery(record: GapRecord, query: PageQuery<GapStatus>): boolean {
  if (query.status !== undefined && record.status !== query.status) return false;
  if (query.text !== undefined && !`${record.kind} ${record.summary}`.toLowerCase().includes(query.text.toLowerCase())) {
    return false;
  }
  return true;
}

export function paginate<T>(
  records: readonly T[],
  query: { readonly limit?: number; readonly cursor?: string }
): { readonly page: readonly T[]; readonly total: number; readonly nextCursor?: string; readonly truncated: boolean } {
  const start = query.cursor === undefined ? 0 : Number.parseInt(query.cursor, 10);
  const limit = query.limit ?? 50;
  const page = records.slice(start, start + limit);
  const next = start + page.length;
  return {
    page,
    total: records.length,
    ...(next < records.length ? { nextCursor: String(next) } : {}),
    truncated: next < records.length
  };
}

export function compact(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

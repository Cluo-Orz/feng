import type { GrowUnitRef } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import { getAgendaRecord } from "./agenda-flow.js";
import { isOpenGap } from "./logic.js";
import type { AgendaRuntime } from "./runtime.js";
import type { AgendaExplanation, AgendaItemRecord, AgendaSummary, DoDItemRecord, GapRecord } from "./types.js";

export async function buildAgendaSummaryRecord(
  runtime: AgendaRuntime,
  growUnitRef: GrowUnitRef
): Promise<Result<AgendaSummary>> {
  const agenda = await getAgendaRecord(runtime, growUnitRef);
  if (!agenda.ok) return agenda;
  const records = await readRecords(runtime, growUnitRef);
  if (!records.ok) return records;
  const activeItems = records.value.items.filter((item) => item.status === "active");
  const openGaps = records.value.gaps.filter(isOpenGap);
  const activeDoD = records.value.dod.filter((item) => item.lifecycle === "active");
  const blockedCount = records.value.items.filter((item) => item.status === "blocked").length +
    records.value.gaps.filter((gap) => gap.status === "blocked").length +
    records.value.dod.filter((item) => item.lifecycle === "blocked").length;
  return ok({
    growUnitRef,
    currentFocus: agenda.value.currentFocus,
    activeAgendaItemCount: activeItems.length,
    openGapCount: openGaps.length,
    activeDoDCount: activeDoD.length,
    blockedCount,
    ...(agenda.value.recommendedGrowState === undefined ? {} : { recommendedGrowState: agenda.value.recommendedGrowState }),
    latestAgendaItemRefs: records.value.items.sort(byUpdatedDesc).slice(0, 5).map((item) => item.agendaItemRef),
    latestGapRefs: records.value.gaps.sort(byUpdatedDesc).slice(0, 5).map((gap) => gap.gapRef),
    latestDoDRefs: records.value.dod.sort(byUpdatedDesc).slice(0, 5).map((item) => item.dodRef),
    ...(agenda.value.attemptIntentRef === undefined ? {} : { attemptIntentRef: agenda.value.attemptIntentRef }),
    builtAt: new Date().toISOString()
  });
}

export async function explainAgendaStateRecord(
  runtime: AgendaRuntime,
  growUnitRef: GrowUnitRef
): Promise<Result<AgendaExplanation>> {
  const summary = await buildAgendaSummaryRecord(runtime, growUnitRef);
  if (!summary.ok) return summary;
  return ok({
    growUnitRef,
    summary: `Agenda focus: ${summary.value.currentFocus}`,
    facts: [
      `activeAgendaItems=${summary.value.activeAgendaItemCount}`,
      `openGaps=${summary.value.openGapCount}`,
      `activeDoD=${summary.value.activeDoDCount}`,
      `blocked=${summary.value.blockedCount}`,
      summary.value.attemptIntentRef === undefined
        ? "attemptIntent=none"
        : `attemptIntent=${summary.value.attemptIntentRef.id}`,
      "readinessVerdict=not_decided_by_agenda"
    ]
  });
}

async function readRecords(
  runtime: AgendaRuntime,
  growUnitRef: GrowUnitRef
): Promise<Result<{ readonly items: AgendaItemRecord[]; readonly gaps: GapRecord[]; readonly dod: DoDItemRecord[] }>> {
  const items = await runtime.storage.readAllAgendaItems();
  if (!items.ok) return items;
  const gaps = await runtime.storage.readAllGaps();
  if (!gaps.ok) return gaps;
  const dod = await runtime.storage.readAllDoD();
  if (!dod.ok) return dod;
  return ok({
    items: items.value.filter((item) => item.growUnitRef.id === growUnitRef.id),
    gaps: gaps.value.filter((gap) => gap.growUnitRef.id === growUnitRef.id),
    dod: dod.value.filter((item) => item.growUnitRef.id === growUnitRef.id)
  });
}

function byUpdatedDesc(a: { readonly updatedAt: string }, b: { readonly updatedAt: string }): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

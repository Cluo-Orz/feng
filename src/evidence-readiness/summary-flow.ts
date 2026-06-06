import { ok, type Result } from "../domain/result.js";
import type { GrowUnitRef } from "../domain/index.js";
import type { EvidenceRuntime } from "./runtime.js";
import type { EvidenceSummary, ReadinessSummary } from "./types.js";

export async function buildEvidenceSummaryRecord(
  runtime: EvidenceRuntime,
  growUnitRef: GrowUnitRef
): Promise<Result<EvidenceSummary>> {
  const all = await runtime.storage.readAllEvidence();
  if (!all.ok) return all;
  const records = all.value.filter((item) => item.growUnitRef.id === growUnitRef.id);
  return ok({
    growUnitRef,
    total: records.length,
    accepted: records.filter((item) => item.status === "accepted_for_evaluation").length,
    blocked: records.filter((item) => item.status === "waiting_policy" || item.status === "redacted").length,
    stale: records.filter((item) => item.status === "stale").length,
    latestEvidenceRefs: records.slice(-5).map((item) => item.evidenceRef),
    builtAt: new Date().toISOString()
  });
}

export async function buildReadinessSummaryRecord(
  runtime: EvidenceRuntime,
  growUnitRef: GrowUnitRef
): Promise<Result<ReadinessSummary>> {
  const verdicts = await runtime.storage.readAllVerdicts();
  if (!verdicts.ok) return verdicts;
  const latest = verdicts.value.filter((item) => item.growUnitRef.id === growUnitRef.id).at(-1);
  const activeDoD = await runtime.options.agendaDoDManager.listActiveDoD(growUnitRef);
  if (!activeDoD.ok) return activeDoD;
  const gaps = await runtime.storage.readAllGaps();
  if (!gaps.ok) return gaps;
  const blockingGapCount = gaps.value.filter((item) => item.growUnitRef.id === growUnitRef.id && item.blocking).length;
  return ok({
    growUnitRef,
    ...(latest === undefined ? {} : { latestVerdictRef: latest.readinessVerdictRef }),
    ...(latest === undefined ? {} : { latestVerdictArtifactRef: latest.artifactRef }),
    ...(latest === undefined ? {} : { verdict: latest.verdict }),
    readyToHatch: latest?.verdict === "ready_to_hatch",
    activeDoDCount: activeDoD.value.length,
    blockingGapCount,
    builtAt: new Date().toISOString()
  });
}

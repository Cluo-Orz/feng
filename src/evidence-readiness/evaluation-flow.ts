import { ok, type Result } from "../domain/result.js";
import type { DoDItemRecord, DoDRef } from "../agenda-dod-manager/index.js";
import { evidenceEventTypes } from "./events.js";
import { evidenceErr } from "./errors.js";
import {
  canPassDoD,
  classifyRecord,
  compact,
  contradictsFor,
  evaluationQualitySummary,
  hasCriticalContradiction,
  newDoDEvaluationRef,
  requiredEvidenceText,
  supportingFor,
  uniqueById
} from "./logic.js";
import type { EvidenceRuntime } from "./runtime.js";
import { appendEvidenceEvent, ensureGrowUnitWritable } from "./runtime.js";
import type {
  DoDEvaluation,
  DoDEvaluationExplanation,
  DoDEvaluationSet,
  EvaluateDoDOptions,
  EvidenceRecord,
  EvidenceRef
} from "./types.js";

export async function evaluateDoDRecord(
  runtime: EvidenceRuntime,
  dodRef: DoDRef,
  options: EvaluateDoDOptions
): Promise<Result<DoDEvaluation>> {
  const dod = await findDoD(runtime, dodRef, options);
  if (!dod.ok) return dod;
  const writable = await ensureGrowUnitWritable(runtime, dod.value.growUnitRef);
  if (!writable.ok) return writable;
  const evidence = await loadEvaluationEvidence(runtime, dod.value.growUnitRef, options.evidenceRefs);
  if (!evidence.ok) return evidence;
  const evaluation = buildEvaluation(dod.value, evidence.value, options);
  const write = await runtime.storage.writeEvaluation(evaluation, "write dod evaluation");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addEvaluation(evaluation.dodEvaluationRef);
  if (!indexed.ok) return indexed;
  const event = await appendEvidenceEvent({
    runtime,
    growUnitRef: evaluation.growUnitRef,
    eventType: evidenceEventTypes.dodEvaluationCreated,
    body: {
      dodEvaluationRef: evaluation.dodEvaluationRef,
      dodRef,
      status: evaluation.status,
      supporting: evaluation.supportingEvidenceRefs,
      contradicting: evaluation.contradictingEvidenceRefs,
      missing: evaluation.missingEvidence
    },
    source: options.source,
    audit: options.audit
  });
  return event.ok ? ok(evaluation) : event;
}

export async function evaluateActiveDoDRecords(
  runtime: EvidenceRuntime,
  growUnitRef: DoDItemRecord["growUnitRef"],
  options: EvaluateDoDOptions
): Promise<Result<DoDEvaluationSet>> {
  const writable = await ensureGrowUnitWritable(runtime, growUnitRef);
  if (!writable.ok) return writable;
  const dod = await runtime.options.agendaDoDManager.listActiveDoD(growUnitRef);
  if (!dod.ok) return dod;
  const evaluations: DoDEvaluation[] = [];
  for (const item of dod.value) {
    const evaluated = await evaluateDoDRecord(runtime, item.dodRef, { ...options, growUnitRef });
    if (!evaluated.ok) return evaluated;
    evaluations.push(evaluated.value);
  }
  return ok({ growUnitRef, evaluations, createdAt: new Date().toISOString() });
}

export async function explainDoDEvaluationRecord(
  runtime: EvidenceRuntime,
  evaluationRef: DoDEvaluation["dodEvaluationRef"]
): Promise<Result<DoDEvaluationExplanation>> {
  const record = await runtime.storage.readEvaluation(evaluationRef);
  if (!record.ok) return record;
  return ok({
    evaluationRef,
    summary: record.value.explanation,
    facts: [
      `dod=${record.value.dodRef.id}`,
      `status=${record.value.status}`,
      `supporting=${record.value.supportingEvidenceRefs.length}`,
      `contradicting=${record.value.contradictingEvidenceRefs.length}`,
      `missing=${record.value.missingEvidence.length}`,
      `blocked=${record.value.blockedReasons.length}`,
      `quality=${record.value.evidenceQualitySummary}`
    ]
  });
}

async function findDoD(
  runtime: EvidenceRuntime,
  dodRef: DoDRef,
  options: EvaluateDoDOptions
): Promise<Result<DoDItemRecord>> {
  const growUnitRef = options.growUnitRef ?? await inferGrowUnitFromEvidence(runtime, options.evidenceRefs);
  if (typeof growUnitRef === "object" && "ok" in growUnitRef) return growUnitRef;
  if (growUnitRef === undefined) {
    return evidenceErr({ code: "invalid_input", message: "evaluateDoD requires growUnitRef or evidenceRefs" });
  }
  const active = await runtime.options.agendaDoDManager.listActiveDoD(growUnitRef);
  if (!active.ok) return active;
  const found = active.value.find((item) => item.dodRef.id === dodRef.id);
  return found === undefined
    ? evidenceErr({ code: "dod_missing", message: "active DoD not found for grow unit" })
    : ok(found);
}

async function inferGrowUnitFromEvidence(
  runtime: EvidenceRuntime,
  evidenceRefs: readonly EvidenceRef[] | undefined
): Promise<DoDItemRecord["growUnitRef"] | undefined | Result<never>> {
  const first = evidenceRefs?.[0];
  if (first === undefined) return undefined;
  const evidence = await runtime.storage.readEvidence(first);
  return evidence.ok ? evidence.value.growUnitRef : evidence;
}

async function loadEvaluationEvidence(
  runtime: EvidenceRuntime,
  growUnitRef: DoDItemRecord["growUnitRef"],
  evidenceRefs: readonly EvidenceRef[] | undefined
): Promise<Result<readonly EvidenceRecord[]>> {
  if (evidenceRefs !== undefined) {
    const records: EvidenceRecord[] = [];
    for (const ref of evidenceRefs) {
      const record = await runtime.storage.readEvidence(ref);
      if (!record.ok) return record;
      if (record.value.growUnitRef.id === growUnitRef.id) records.push(record.value);
    }
    return ok(records);
  }
  const all = await runtime.storage.readAllEvidence();
  return all.ok
    ? ok(all.value.filter((record) => record.growUnitRef.id === growUnitRef.id && record.status === "accepted_for_evaluation"))
    : all;
}

function buildEvaluation(
  dod: DoDItemRecord,
  evidence: readonly EvidenceRecord[],
  options: EvaluateDoDOptions
): DoDEvaluation {
  const usable = evidence.filter((item) => classifyRecord(item).usable);
  const supporting = usable.filter((item) => supportingFor(item, dod.dodRef));
  const validSupport = supporting.filter(canPassDoD);
  const contradicting = evidence.filter((item) => item.status !== "rejected" && contradictsFor(item, dod.dodRef));
  const criticalContradictions = contradicting.filter((item) => hasCriticalContradiction(item, dod.dodRef));
  const blocked = evidence
    .filter((item) => item.status === "waiting_policy" || item.status === "redacted" || item.status === "unavailable")
    .map((item) => `${item.evidenceRef.id}: ${item.status}`);
  const weakOnly = supporting.length > 0 && validSupport.length === 0;
  const missing = validSupport.length === 0 ? [requiredEvidenceText(dod)] : [];
  const status = chooseEvaluationStatus({ blocked, criticalContradictions, contradicting, validSupport, weakOnly, missing });
  const evaluationRef = newDoDEvaluationRef();
  return {
    dodEvaluationId: evaluationRef.id,
    dodEvaluationRef: evaluationRef,
    dodRef: dod.dodRef,
    growUnitRef: dod.growUnitRef,
    status,
    supportingEvidenceRefs: uniqueById(supporting.map((item) => item.evidenceRef)),
    contradictingEvidenceRefs: uniqueById(contradicting.map((item) => item.evidenceRef)),
    supportingArtifactRefs: uniqueById(supporting.flatMap((item) => item.artifactRef === undefined ? [] : [item.artifactRef])),
    contradictingArtifactRefs: uniqueById(contradicting.flatMap((item) => item.artifactRef === undefined ? [] : [item.artifactRef])),
    missingEvidence: missing,
    blockedReasons: blocked,
    evaluationScope: compact(dod.scope || "current grow unit", 2_000),
    evidenceQualitySummary: evaluationQualitySummary(supporting),
    explanation: explainStatus(status, validSupport.length, contradicting.length, missing.length, blocked.length),
    createdAt: new Date().toISOString(),
    source: options.source,
    audit: options.audit
  };
}

function chooseEvaluationStatus(input: {
  readonly blocked: readonly string[];
  readonly criticalContradictions: readonly EvidenceRecord[];
  readonly contradicting: readonly EvidenceRecord[];
  readonly validSupport: readonly EvidenceRecord[];
  readonly weakOnly: boolean;
  readonly missing: readonly string[];
}): DoDEvaluation["status"] {
  if (input.blocked.length > 0) return "blocked";
  if (input.criticalContradictions.length > 0 || (input.contradicting.length > 0 && input.validSupport.length === 0)) return "failed";
  if (input.validSupport.length > 0 && input.contradicting.length === 0) return "passed";
  if (input.weakOnly) return "needs_validation";
  return input.missing.length > 0 ? "needs_validation" : "unknown";
}

function explainStatus(
  status: DoDEvaluation["status"],
  support: number,
  contradicting: number,
  missing: number,
  blocked: number
): string {
  if (status === "passed") return `passed with ${support} strong/moderate supporting evidence item(s)`;
  if (status === "failed") return `failed with ${contradicting} contradicting evidence item(s)`;
  if (status === "blocked") return `blocked by ${blocked} unreadable or policy-blocked evidence item(s)`;
  return `needs validation with ${missing} missing evidence item(s)`;
}

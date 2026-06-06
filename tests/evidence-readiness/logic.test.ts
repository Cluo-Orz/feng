import { describe, expect, test } from "vitest";
import { makeDoDId, makeDoDRef } from "../../src/agenda-dod-manager/index.js";
import { makeGrowUnitId, makeRef, type AuditDescriptor, type SourceDescriptor, type VersionDescriptor } from "../../src/domain/index.js";
import {
  artifactKindForSource,
  artifactUsableForReadiness,
  classifyRecord,
  compact,
  defaultQuality,
  evaluationQualitySummary,
  lifecycleFromVerdict,
  lifecycleUsableForReadiness,
  makeEvidenceId,
  makeEvidenceRef,
  nonEmpty,
  qualityRank,
  relationMatchesDoD
} from "../../src/evidence-readiness/index.js";
import type { EvidenceQuality, EvidenceRecord, EvidenceSourceKind } from "../../src/evidence-readiness/index.js";

describe("Evidence Readiness pure logic", () => {
  test("maps source kinds and quality defaults without treating model output as strong evidence", () => {
    const mappings: Record<EvidenceSourceKind, string> = {
      attempt_outcome: "summary",
      candidate_output: "candidate_output",
      tool_result: "tool_result",
      validation_report: "validation_report",
      attempt_trace: "attempt_trace",
      runtime_trace: "runtime_trace",
      feedback_evidence: "feedback_evidence",
      manual_review: "source_material",
      policy_decision: "source_material",
      artifact_metadata: "summary",
      external_test_report: "validation_report",
      llm_judge_report: "validation_report",
      unknown: "source_material"
    };
    for (const [sourceKind, kind] of Object.entries(mappings) as [EvidenceSourceKind, string][]) {
      expect(artifactKindForSource(sourceKind)).toBe(kind);
    }
    expect(defaultQuality("candidate_output").trustLevel).toBe("weak");
    expect(defaultQuality("llm_judge_report").trustLevel).toBe("weak");
    expect(defaultQuality("tool_result").observationKind).toBe("tool_measured");
    expect(defaultQuality("manual_review").observationKind).toBe("manual_reviewed");
    expect(defaultQuality("attempt_trace").observationKind).toBe("observed_runtime");
    expect(defaultQuality("unknown").trustLevel).toBe("weak");
  });

  test("classifies evidence statuses and trust/privacy blockers", () => {
    expect(classifyRecord(record({ status: "candidate" })).usable).toBe(false);
    expect(classifyRecord(record({ status: "redacted" })).status).toBe("redacted");
    expect(classifyRecord(record({ status: "unavailable" })).status).toBe("unavailable");
    expect(classifyRecord(record({ status: "accepted_for_evaluation", quality: { freshnessStatus: "stale" } })).status).toBe("stale");
    expect(classifyRecord(record({ status: "accepted_for_evaluation", quality: { privacyFit: "blocked" } })).status).toBe("waiting_policy");
    expect(classifyRecord(record({ status: "accepted_for_evaluation", quality: { trustLevel: "blocked" } })).status).toBe("waiting_policy");
    expect(classifyRecord(record({ status: "accepted_for_evaluation", quality: { trustLevel: "unsupported" } })).usable).toBe(false);
    expect(classifyRecord(record({ status: "accepted_for_evaluation" })).usable).toBe(true);
  });

  test("covers lifecycle, ranking, validation, relation, and compact helpers", () => {
    expect(lifecycleFromVerdict("ready_to_hatch")).toBe("ready_to_hatch");
    expect(lifecycleFromVerdict("waiting_input")).toBe("waiting_input");
    expect(lifecycleFromVerdict("waiting_feedback")).toBe("waiting_feedback");
    expect(lifecycleFromVerdict("waiting_validation")).toBe("verifying");
    expect(lifecycleFromVerdict("blocked")).toBe("blocked");
    expect(lifecycleFromVerdict("continue_grow")).toBe("growing");
    expect(lifecycleFromVerdict("inconclusive")).toBe("planning");
    expect(lifecycleUsableForReadiness("active")).toBe(true);
    expect(lifecycleUsableForReadiness("registered")).toBe(true);
    expect(lifecycleUsableForReadiness("archived")).toBe(true);
    expect(lifecycleUsableForReadiness("deleted")).toBe(false);
    expect(artifactUsableForReadiness({ lifecycle: "active" } as never)).toBe(true);
    expect(qualityRank("strong")).toBeGreaterThan(qualityRank("moderate"));
    expect(qualityRank("moderate")).toBeGreaterThan(qualityRank("weak"));
    expect(qualityRank("unsupported")).toBeGreaterThan(qualityRank("blocked"));
    expect(compact("abcdef", 5)).toBe("ab...");
    expect(nonEmpty("", "summary").ok).toBe(false);
    expect(nonEmpty("ok", "summary").ok).toBe(true);
    expect(evaluationQualitySummary([
      record({ quality: { trustLevel: "weak" } }),
      record({ quality: { trustLevel: "strong", observationKind: "test_reported" } })
    ])).toContain("strong");

    const dod = makeDoDRef(makeDoDId("dod-logic"));
    const other = makeDoDRef(makeDoDId("dod-other"));
    expect(relationMatchesDoD({ relation: "supports", criticality: "normal", reason: "global" }, dod)).toBe(true);
    expect(relationMatchesDoD({ relation: "supports", relatedDoDRef: dod, criticality: "normal", reason: "match" }, dod)).toBe(true);
    expect(relationMatchesDoD({ relation: "supports", relatedDoDRef: other, criticality: "normal", reason: "miss" }, dod)).toBe(false);
  });
});

function record(patch: Omit<Partial<EvidenceRecord>, "quality"> & { readonly quality?: Partial<EvidenceQuality> }): EvidenceRecord {
  const { quality: qualityPatch, ...recordPatch } = patch;
  const source: SourceDescriptor = {
    kind: "system",
    origin: "logic-test",
    workspace: "workspace-logic" as never,
    userProvided: false,
    receivedAt: "2026-06-06T00:00:00.000Z",
    privacyLevel: "workspace_private"
  };
  const version: VersionDescriptor = { schemaVersion: "1", producerVersion: "logic-test" };
  const audit: AuditDescriptor = { createdAt: "2026-06-06T00:00:00.000Z", createdBy: "logic-test", reason: "logic" };
  const evidenceRef = makeEvidenceRef(makeEvidenceId("evidence-logic"));
  const base = defaultQuality("validation_report");
  return {
    evidenceId: evidenceRef.id,
    evidenceRef,
    growUnitRef: makeRef("grow_unit", makeGrowUnitId("grow-logic")),
    sourceKind: "validation_report",
    status: "accepted_for_evaluation",
    summary: "logic evidence",
    relationHints: [],
    quality: { ...base, ...qualityPatch },
    policyDecisionRefs: [],
    scope: "logic scope",
    createdAt: "2026-06-06T00:00:00.000Z",
    updatedAt: "2026-06-06T00:00:00.000Z",
    source,
    version,
    audit,
    recordVersion: 1,
    ...recordPatch
  };
}

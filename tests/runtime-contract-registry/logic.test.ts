import { describe, expect, test } from "vitest";
import { makeArtifactId, makeGrowUnitId, makeRef, type RuntimeContractRef } from "../../src/domain/index.js";
import { makeReadinessVerdictId, makeReadinessVerdictRef } from "../../src/evidence-readiness/index.js";
import {
  assertMutable,
  assertUsableForHatch,
  completenessMissing,
  compact,
  diffContracts,
  hasPrivacyRules,
  kernelSummary,
  matchesQuery,
  makeContractReportId,
  makeRuntimeContractRef,
  reportRef,
  secretContentDetected,
  validateInput,
  type RuntimeContractRecord
} from "../../src/runtime-contract-registry/index.js";
import { audit, completeShape, source, version, type ContractFixture } from "./helpers.js";

describe("Runtime Contract Registry pure logic", () => {
  test("detects completeness, privacy rules, secrets, and lifecycle guards", () => {
    const complete = record(makeRuntimeContractRef("runtime-contract-complete"));
    expect(completenessMissing(complete)).toHaveLength(0);
    expect(hasPrivacyRules(complete.shape)).toBe(true);
    const empty = record(makeRuntimeContractRef("runtime-contract-empty"), { shape: {}, capabilityRequirements: [] });
    expect(completenessMissing(empty).join("\n")).toContain("input contract");
    expect(completenessMissing(empty).join("\n")).toContain("privacy rules");
    expect(secretContentDetected("apiKey=abc")).toBe(true);
    expect(secretContentDetected("contains_secret")).toBe(true);
    expect(secretContentDetected("no secret output")).toBe(false);
    expect(assertMutable(complete).ok).toBe(true);
    expect(assertMutable(record(makeRuntimeContractRef("runtime-contract-locked"), { lifecycle: "locked_for_hatch" })).ok).toBe(false);
    expect(assertMutable(record(makeRuntimeContractRef("runtime-contract-retracted"), { lifecycle: "retracted" })).ok).toBe(false);
    expect(assertUsableForHatch(record(makeRuntimeContractRef("runtime-contract-incompatible"), { lifecycle: "incompatible" })).ok).toBe(false);
    expect(assertUsableForHatch(record(makeRuntimeContractRef("runtime-contract-unverified"))).ok).toBe(false);
    expect(assertUsableForHatch(record(makeRuntimeContractRef("runtime-contract-ready"), {
      latestVerificationReportRef: reportRef(makeContractReportId("report-ready"))
    })).ok).toBe(true);
  });

  test("validates input and compacts names deterministically", () => {
    const base = record(makeRuntimeContractRef("runtime-contract-input"));
    expect(compact("  short  ")).toBe("short");
    expect(compact("abcdef", 5)).toBe("ab...");
    expect(validateInput({
      growUnitRef: base.growUnitRef,
      name: "valid",
      version,
      runtimeKernelType: "non_llm_runtime",
      source: base.source,
      audit: base.audit
    }).ok).toBe(true);
    expect(validateInput({
      growUnitRef: base.growUnitRef,
      name: "valid",
      version: { schemaVersion: "", producerVersion: "contract-test" },
      runtimeKernelType: "non_llm_runtime",
      source: base.source,
      audit: base.audit
    }).ok).toBe(false);
  });

  test("matches queries and summarizes kernel variants", () => {
    const ref = makeRuntimeContractRef("runtime-contract-query");
    const base = record(ref);
    expect(matchesQuery(base, {})).toBe(true);
    expect(matchesQuery(base, { growUnitRef: base.growUnitRef })).toBe(true);
    expect(matchesQuery(base, { lifecycle: "registered" })).toBe(true);
    expect(matchesQuery(base, { kernelType: "non_llm_runtime" })).toBe(true);
    expect(matchesQuery(base, { text: "query" })).toBe(true);
    expect(matchesQuery(base, { growUnitRef: makeRef("grow_unit", makeGrowUnitId("grow-other")) })).toBe(false);
    expect(matchesQuery(base, { lifecycle: "active" })).toBe(false);
    expect(matchesQuery(base, { kernelType: "hybrid_runtime" })).toBe(false);
    expect(matchesQuery(base, { text: "missing" })).toBe(false);
    expect(kernelSummary("non_llm_runtime")).toContain("non-LLM");
    expect(kernelSummary("standard_agent_kernel")).toContain("standard");
    expect(kernelSummary("custom_agent_kernel")).toContain("custom");
    expect(kernelSummary("hybrid_runtime")).toContain("hybrid");
  });

  test("compares changed contract fields and compatibility", () => {
    const first = record(makeRuntimeContractRef("runtime-contract-v1"));
    const second = record(makeRuntimeContractRef("runtime-contract-v2"), {
      runtimeKernelType: "hybrid_runtime",
      capabilityRequirements: ["runtime.target_action", "network.request"],
      shape: {
        ...completeShape(true),
        compatibility: {
          ...completeShape(true).compatibility!,
          breakingChanges: ["kernel changed"]
        }
      }
    });
    const diff = diffContracts(first, second);
    expect(diff.compatible).toBe(false);
    expect(diff.changedFields).toContain("runtimeKernelType");
    expect(diff.changedFields).toContain("input");
    expect(diff.changedFields).toContain("capabilityRequirements");
    const same = diffContracts(first, first);
    expect(same.compatible).toBe(true);
    expect(same.changedFields).toHaveLength(0);
  });
});

function record(ref: RuntimeContractRef, patch: Partial<RuntimeContractRecord> = {}): RuntimeContractRecord {
  return {
    runtimeContractRef: ref,
    growUnitRef: makeRef("grow_unit", makeGrowUnitId("grow-query")),
    name: "boss query contract",
    version,
    lifecycle: "registered",
    runtimeKernelType: "non_llm_runtime",
    shape: completeShape(false),
    capabilityRequirements: ["runtime.target_action"],
    policyDecisionRefs: [],
    evidenceRefs: [],
    readinessVerdictRef: makeReadinessVerdictRef(makeReadinessVerdictId("ready-query")),
    artifactRef: makeRef("artifact", makeArtifactId("artifact-contract")),
    createdAt: "2026-06-06T00:00:00.000Z",
    updatedAt: "2026-06-06T00:00:00.000Z",
    source: source({ workspace: { id: "workspace-query" as never } } as unknown as ContractFixture, "system"),
    audit: audit("logic"),
    recordVersion: 1,
    ...patch
  };
}

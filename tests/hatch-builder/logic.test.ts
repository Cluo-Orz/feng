import { describe, expect, test } from "vitest";
import { makeArtifactId, makeGrowUnitId, makeRef } from "../../src/domain/index.js";
import {
  defaultPackageName,
  exclusionCodeForArtifactLifecycle,
  matchesPackageQuery,
  secretContentDetected,
  validateHatchRequest
} from "../../src/hatch-builder/index.js";
import { audit, source, version } from "./helpers.js";

describe("Hatch Builder pure logic", () => {
  test("validates request fields and derives defaults", () => {
    const input = {
      growUnitRef: makeRef("grow_unit", makeGrowUnitId("grow-logic")),
      readinessVerdictRef: { kind: "readiness_verdict" as const, id: "ready-logic" as never },
      runtimeContractRef: makeRef("runtime_contract", "runtime-contract-logic" as never),
      requestedVersion: version,
      targetPackageKind: "agent_runtime" as const,
      publishMode: "local_draft" as const,
      reason: "hatch",
      requestedBy: "logic-test",
      source: source({ workspace: { id: "workspace-logic" as never } } as never, "system"),
      audit: audit("logic")
    };
    expect(validateHatchRequest(input).ok).toBe(true);
    expect(defaultPackageName(input)).toContain("hatch-grow-logic");
    expect(defaultPackageName({ ...input, packageName: " named " })).toBe("named");
    expect(validateHatchRequest({ ...input, reason: "" }).ok).toBe(false);
    expect(validateHatchRequest({ ...input, requestedBy: "" }).ok).toBe(false);
    expect(validateHatchRequest({ ...input, requestedVersion: { schemaVersion: "" } }).ok).toBe(false);
    expect(validateHatchRequest({ ...input, packageName: " " }).ok).toBe(false);
  });

  test("classifies secret content, lifecycle exclusions, and package queries", () => {
    expect(secretContentDetected("token: abc")).toBe(true);
    expect(secretContentDetected("ordinary package content")).toBe(false);
    expect(exclusionCodeForArtifactLifecycle("retracted")).toBe("retracted_artifact");
    expect(exclusionCodeForArtifactLifecycle("deleted")).toBe("retracted_artifact");
    expect(exclusionCodeForArtifactLifecycle("redacted")).toBe("unavailable_artifact");
    expect(exclusionCodeForArtifactLifecycle("unavailable")).toBe("unavailable_artifact");
    expect(exclusionCodeForArtifactLifecycle("archived")).toBe("archived_artifact");
    expect(exclusionCodeForArtifactLifecycle("active")).toBeUndefined();
    expect(matchesPackageQuery({ lifecycle: "packaged" }, {})).toBe(true);
    expect(matchesPackageQuery({ lifecycle: "packaged" }, { lifecycle: "packaged" })).toBe(true);
    expect(matchesPackageQuery({ lifecycle: "packaged" }, { lifecycle: "retracted" })).toBe(false);
    expect(makeRef("artifact", makeArtifactId("artifact-logic")).kind).toBe("artifact");
  });
});

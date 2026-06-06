import { describe, expect, expectTypeOf, test } from "vitest";
import * as Domain from "../../src/domain/index.js";

describe("Domain Model & Contracts", () => {
  test("brands ids at compile time while preserving string runtime shape", () => {
    const workspaceId = Domain.makeWorkspaceId("workspace-1");
    const growUnitId = Domain.makeGrowUnitId("grow-1");

    expect(workspaceId).toBe("workspace-1");
    expect(growUnitId).toBe("grow-1");
    expectTypeOf(workspaceId).not.toEqualTypeOf(growUnitId);

    // @ts-expect-error WorkspaceId must not be assignable to GrowUnitId.
    const wrongGrowUnitId: Domain.GrowUnitId = workspaceId;
    expect(wrongGrowUnitId).toBe(workspaceId);
  });

  test("rejects empty branded ids at the factory boundary", () => {
    expect(() => Domain.makeWorkspaceId("")).toThrow("WorkspaceId cannot be empty");
    expect(() => Domain.makeArtifactId("   ")).toThrow("ArtifactId cannot be empty");
  });

  test("provides factories for all required entity ids", () => {
    const factories = [
      ["workspace", Domain.makeWorkspaceId],
      ["grow", Domain.makeGrowUnitId],
      ["attempt", Domain.makeAttemptId],
      ["event", Domain.makeEventId],
      ["artifact", Domain.makeArtifactId],
      ["message-list", Domain.makeMessageListId],
      ["feedback", Domain.makeFeedbackUnitId],
      ["hatch-package", Domain.makeHatchPackageId],
      ["runtime-contract", Domain.makeRuntimeContractId],
      ["skill", Domain.makeSkillId],
      ["tool", Domain.makeToolId],
      ["policy", Domain.makePolicyDecisionId],
      ["target-world", Domain.makeTargetWorldId]
    ] as const;

    for (const [prefix, factory] of factories) {
      expect(factory(`${prefix}-1`)).toBe(`${prefix}-1`);
    }
  });

  test("builds typed refs without treating refs as file paths", () => {
    const artifactId = Domain.makeArtifactId("artifact-1");
    const ref: Domain.ArtifactRef = Domain.makeRef("artifact", artifactId, {
      uri: "artifact://artifact-1",
      version: "v1"
    });

    expect(ref).toEqual({
      kind: "artifact",
      id: "artifact-1",
      uri: "artifact://artifact-1",
      version: "v1"
    });

    const messageListRef: Domain.MessageListRef = Domain.makeRef(
      "message_list",
      Domain.makeMessageListId("message-list-1")
    );
    expect(messageListRef.kind).toBe("message_list");
    expect(messageListRef).not.toHaveProperty("path");
  });

  test("keeps lifecycle and contract values explicit", () => {
    expect(Domain.growLifecycleStates).toContain("ready_to_hatch");
    expect(Domain.feedbackStatuses[0]).toBe("candidate");
    expect(Domain.runtimeKernelTypes).toContain("non_llm_runtime");
    expect(Domain.readinessVerdicts).toContain("continue_grow");

    expect(Domain.isGrowLifecycle("growing")).toBe(true);
    expect(Domain.isGrowLifecycle("session")).toBe(false);
    expect(Domain.isAttemptLifecycle("waiting_tool")).toBe(true);
    expect(Domain.isAttemptLifecycle("waiting_model")).toBe(false);
    expect(Domain.isFeedbackStatus("candidate")).toBe(true);
    expect(Domain.isFeedbackStatus("absorbed")).toBe(false);
    expect(Domain.isHatchLifecycle("published_local")).toBe(true);
    expect(Domain.isHatchLifecycle("published_remote")).toBe(false);
    expect(Domain.isRuntimeKernelType("standard_agent_kernel")).toBe(true);
    expect(Domain.isRuntimeKernelType("chatbot")).toBe(false);
    expect(Domain.isReadinessVerdict("continue_grow")).toBe(true);
    expect(Domain.isReadinessVerdict("model_confident")).toBe(false);
  });

  test("parses unknown states as version errors instead of silently downgrading", () => {
    const valid = Domain.parseLiteralState(Domain.hatchLifecycles, "packaged", "hatch lifecycle");
    expect(valid).toEqual({ ok: true, value: "packaged" });

    const invalid = Domain.parseLiteralState(Domain.hatchLifecycles, "published_remote", "hatch lifecycle");
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.code).toBe("version_unsupported");
      expect(invalid.error.module).toBe("domain-model-contracts");
      expect(invalid.error.message).toContain("published_remote");
    }
  });

  test("models result values without throwing for business failures", () => {
    const success = Domain.ok(3);
    const mapped = Domain.mapResult(success, (value) => value + 1);
    expect(mapped).toEqual({ ok: true, value: 4 });

    const failure = Domain.domainErr({
      code: "invalid_input",
      message: "bad input",
      module: "domain-model-contracts",
      retryable: true
    });

    expect(Domain.isErr(failure)).toBe(true);
    expect(Domain.isOk(success)).toBe(true);
    expect(Domain.unwrapOr(failure, 10)).toBe(10);
    expect(Domain.flatMapResult(failure, (value: number) => Domain.ok(value + 1))).toBe(failure);
    expect(Domain.err(failure.error)).toEqual(failure);
  });

  test("preserves optional descriptor fields without materializing undefined keys", () => {
    const source: Domain.SourceDescriptor = {
      kind: "user",
      origin: "cli",
      workspace: Domain.makeWorkspaceId("workspace-1"),
      growUnit: Domain.makeGrowUnitId("grow-1"),
      userProvided: true,
      receivedAt: "2026-06-06T00:00:00.000Z",
      privacyLevel: "workspace_private"
    };

    const audit: Domain.AuditDescriptor = {
      createdAt: source.receivedAt,
      createdBy: "tester",
      reason: "unit-test",
      evidenceRefs: [Domain.makeRef("artifact", Domain.makeArtifactId("evidence-1"))]
    };

    const error = Domain.createDomainError({
      code: "privacy_blocked",
      message: "private content",
      module: "policy-capability-boundary",
      source,
      audit
    });

    expect(error.source).toBe(source);
    expect(error.audit).toBe(audit);
    expect(error).not.toHaveProperty("cause");
  });

  test("exports contract summaries as cross-module summaries, not full schemas", () => {
    const runtimeContractRef = Domain.makeRef(
      "runtime_contract",
      Domain.makeRuntimeContractId("contract-1")
    );
    const summary: Domain.RuntimeContractSummary = {
      runtimeContractRef,
      runtimeKernelType: "hybrid_runtime",
      version: {
        schemaVersion: "1",
        contractVersion: "1.0.0"
      },
      inputSummary: "world input envelope",
      outputSummary: "world output envelope",
      actionBoundarySummary: "target actions need policy"
    };

    const packageSummary: Domain.HatchPackageSummary = {
      hatchPackageRef: Domain.makeRef("hatch_package", Domain.makeHatchPackageId("package-1")),
      runtimeContractRef,
      runtimeKernelType: summary.runtimeKernelType,
      version: summary.version,
      packageSummary: "copyable local package"
    };

    expect(summary.runtimeKernelType).toBe("hybrid_runtime");
    expect(packageSummary.hatchPackageRef.kind).toBe("hatch_package");
  });

  test("does not expose session as a domain runtime key", () => {
    const runtimeKeys = Object.keys(Domain).filter((key) => key.toLowerCase().includes("session"));
    expect(runtimeKeys).toEqual([]);
  });
});

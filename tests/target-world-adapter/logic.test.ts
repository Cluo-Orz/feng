import { describe, expect, test } from "vitest";
import type { RuntimeContractRecord } from "../../src/runtime-contract-registry/index.js";
import {
  activeAdapterMatches,
  contractAllowedActions,
  contractForbiddenActions,
  contractInputKinds,
  contractOutputKinds,
  intersects,
  isWorldInputKind,
  isWorldOutputKind,
  pageRecords,
  targetWorldAdapterRef,
  targetWorldRef,
  validateAdapterInput,
  validateTargetWorldInput,
  type TargetWorldAdapterDefinition,
  makeTargetWorldAdapterId
} from "../../src/target-world-adapter/index.js";
import { makeTargetWorldId } from "../../src/domain/index.js";
import { audit, source, version } from "./helpers.js";
import { withWorkspace } from "../file-store/helpers.js";

describe("Target World Adapter logic", () => {
  test("validates target world and adapter inputs", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = { workspace: workspace.workspace } as Parameters<typeof source>[0];
      const baseWorld = {
        name: "Arena",
        kind: "game_engine" as const,
        description: "Arena",
        inputKinds: ["tick_state"] as const,
        outputKinds: ["action_event"] as const,
        actionKinds: ["move"],
        validationKinds: ["scenario_check"] as const,
        debugSignalKinds: ["failure_trace"] as const,
        privacyBoundary: "workspace_private" as const,
        environmentBoundary: "local",
        capabilityRequirements: [],
        source: source(fixture, "system"),
        version,
        audit: audit("world")
      };
      expect(validateTargetWorldInput(baseWorld).ok).toBe(true);
      expect(validateTargetWorldInput({ ...baseWorld, name: " " }).ok).toBe(false);
      expect(validateTargetWorldInput({ ...baseWorld, description: " " }).ok).toBe(false);
      expect(validateTargetWorldInput({ ...baseWorld, inputKinds: [] }).ok).toBe(false);
      expect(validateTargetWorldInput({ ...baseWorld, outputKinds: [] }).ok).toBe(false);
      const baseAdapter = {
        targetWorldRef: targetWorldRef(makeTargetWorldId("target-world-logic")),
        name: "Adapter",
        supportedRuntimeKernelTypes: ["non_llm_runtime"] as const,
        supportedInputKinds: ["tick_state"] as const,
        supportedOutputKinds: ["action_event"] as const,
        supportedActionKinds: ["move"],
        supportedValidationKinds: ["scenario_check"] as const,
        hostIntegrationSummary: "local",
        compatibility: "ok",
        policyBoundarySummary: "policy",
        source: source(fixture, "system"),
        version,
        audit: audit("adapter")
      };
      expect(validateAdapterInput(baseAdapter).ok).toBe(true);
      expect(validateAdapterInput({ ...baseAdapter, name: " " }).ok).toBe(false);
      expect(validateAdapterInput({ ...baseAdapter, supportedRuntimeKernelTypes: [] }).ok).toBe(false);
      expect(validateAdapterInput({ ...baseAdapter, supportedInputKinds: [] }).ok).toBe(false);
      expect(validateAdapterInput({ ...baseAdapter, supportedOutputKinds: [] }).ok).toBe(false);
    });
  });

  test("filters adapters, paginates records, and extracts contract modes", () => {
    const target = targetWorldRef(makeTargetWorldId("target-world-filter"));
    const adapter: TargetWorldAdapterDefinition = {
      targetWorldRef: target,
      name: "Adapter",
      supportedRuntimeKernelTypes: ["non_llm_runtime"],
      supportedInputKinds: ["tick_state"],
      supportedOutputKinds: ["action_event"],
      supportedActionKinds: ["move"],
      supportedValidationKinds: ["scenario_check"],
      hostIntegrationSummary: "local",
      compatibility: "ok",
      policyBoundarySummary: "policy",
      source: source({ workspace: { id: "workspace-test" } } as never, "system"),
      version,
      audit: audit("adapter"),
      adapterId: makeTargetWorldAdapterId("target-adapter-filter"),
      adapterRef: targetWorldAdapterRef(makeTargetWorldAdapterId("target-adapter-filter")),
      lifecycle: "active",
      createdAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T00:00:00.000Z",
      recordVersion: 1
    };
    expect(activeAdapterMatches(adapter, {})).toBe(true);
    expect(activeAdapterMatches(adapter, { targetWorldRef: target, lifecycle: "active", kernelType: "non_llm_runtime" })).toBe(true);
    expect(activeAdapterMatches(adapter, { lifecycle: "disabled" })).toBe(false);
    expect(pageRecords([1, 2, 3], 2).nextCursor).toBe("2");
    expect(pageRecords([], undefined, undefined).records).toHaveLength(0);
    expect(intersects(["a", "a", "b"], ["a"])).toEqual(["a"]);
    expect(isWorldInputKind("tick_state")).toBe(true);
    expect(isWorldInputKind("command_args")).toBe(false);
    expect(isWorldOutputKind("action_event")).toBe(true);
    expect(isWorldOutputKind("unknown")).toBe(false);

    const emptyContract = { shape: {} } as unknown as RuntimeContractRecord;
    expect(contractInputKinds(emptyContract)).toEqual([]);
    expect(contractOutputKinds(emptyContract)).toEqual([]);
    expect(contractAllowedActions(emptyContract)).toEqual([]);
    expect(contractForbiddenActions(emptyContract)).toEqual([]);
    const contract = {
      shape: {
        input: { inputModes: ["tick_state", "command_args"] },
        output: { outputModes: ["action_event"] },
        event: { outputModes: ["debug_event"] },
        actionBoundary: { allowedActionKinds: ["move"], forbiddenActionKinds: ["spawn"] }
      }
    } as unknown as RuntimeContractRecord;
    expect(contractInputKinds(contract)).toEqual(["tick_state"]);
    expect(contractOutputKinds(contract)).toEqual(["action_event", "debug_event"]);
    expect(contractAllowedActions(contract)).toEqual(["move"]);
    expect(contractForbiddenActions(contract)).toEqual(["spawn"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  ensureAgentKernelType,
  ensureRunnableContract,
  ensureRunnablePackage,
  firstOutputKind,
  makeRuntimeFeedbackCandidateHintId,
  makeRuntimeTraceId,
  newRuntimeMessageListRef,
  parseRuntimeOutput,
  runtimeTraceRef,
  runtimeFeedbackCandidateHintRef,
  stableHash,
  terminalInvocationStatus
} from "../../src/agent-runtime-kernel/index.js";
import { tracePath } from "../../src/agent-runtime-kernel/paths.js";
import { makeRef, makeHatchPackageId, makeRuntimeContractId } from "../../src/domain/index.js";
import { payload } from "../../src/agent-runtime-kernel/payloads.js";
import { completeShape, version } from "../runtime-contract-registry/helpers.js";

describe("Agent Runtime Kernel logic helpers", () => {
  it("checks supported kernel and terminal statuses", () => {
    expect(ensureAgentKernelType("standard_agent_kernel").ok).toBe(true);
    expect(ensureAgentKernelType("custom_agent_kernel").ok).toBe(true);
    const unsupported = ensureAgentKernelType("non_llm_runtime");
    expect(unsupported.ok).toBe(false);
    if (unsupported.ok) throw new Error("expected unsupported");
    expect(unsupported.error.code).toBe("runtime_kernel_unsupported");
    expect(terminalInvocationStatus("completed")).toBe(true);
    expect(terminalInvocationStatus("failed")).toBe(true);
    expect(terminalInvocationStatus("cancelled")).toBe(true);
    expect(terminalInvocationStatus("interrupted")).toBe(true);
    expect(terminalInvocationStatus("running")).toBe(false);
  });

  it("checks runnable package and contract guards", () => {
    const pkg = packageRecord();
    expect(ensureRunnablePackage(pkg, false).ok).toBe(true);
    expect(ensureRunnablePackage({ ...pkg, lifecycle: "failed" }, false).ok).toBe(false);
    expect(ensureRunnablePackage({ ...pkg, lifecycle: "retracted" }, false).ok).toBe(false);
    expect(ensureRunnablePackage({ ...pkg, lifecycle: "superseded" }, false).ok).toBe(false);
    const prod = ensureRunnablePackage(pkg, true);
    expect(prod.ok).toBe(false);
    if (prod.ok) throw new Error("expected production lock violation");
    expect(prod.error.code).toBe("production_lock_violation");
    expect(ensureRunnablePackage({ ...pkg, lifecycle: "published_local" }, true).ok).toBe(true);
    const contract = contractRecord("standard_agent_kernel");
    expect(ensureRunnableContract(contract, pkg).ok).toBe(true);
    expect(ensureRunnableContract({ ...contract, runtimeContractRef: makeRef("runtime_contract", makeRuntimeContractId("other")) }, pkg).ok).toBe(false);
    expect(ensureRunnableContract({ ...contract, lifecycle: "retracted" }, pkg).ok).toBe(false);
    expect(ensureRunnableContract(contractRecord("non_llm_runtime"), pkg).ok).toBe(false);
  });

  it("parses runtime output text, JSON, structured action, and fallbacks", () => {
    const text = response([{ type: "text" as const, text: "plain text" }]);
    expect(parseRuntimeOutput(text, "text_result").outputKind).toBe("text_result");
    const json = response([{ type: "text" as const, text: JSON.stringify({ outputKind: "action_event", actionKind: "move", payload: { x: 1 } }) }]);
    const parsed = parseRuntimeOutput(json, "structured_result");
    expect(parsed.outputKind).toBe("action_event");
    expect(parsed.actions).toHaveLength(1);
    const structured = response([{ type: "structured_output" as const, value: {
      outputKind: "decision_event",
      actions: [{ actionKind: "attack", actionPayload: { power: 2 }, requiredCapabilities: ["runtime.target_action"] }]
    } }]);
    const structuredParsed = parseRuntimeOutput(structured, "text_result");
    expect(structuredParsed.outputKind).toBe("decision_event");
    expect(structuredParsed.actions[0]?.requiredCapabilities).toContain("runtime.target_action");
    const invalidKind = response([{ type: "structured_output" as const, value: { outputKind: "unknown", content: "x" } }]);
    expect(parseRuntimeOutput(invalidKind, "chapter_output").outputKind).toBe("chapter_output");
  });

  it("normalizes malformed and partial runtime output candidates conservatively", () => {
    const badJson = response([{ type: "text" as const, text: "{bad json" }]);
    const badParsed = parseRuntimeOutput(badJson, "text_result");
    expect(badParsed.outputKind).toBe("text_result");
    expect(outputContent(badParsed.normalizedOutput)).toEqual({ text: "{bad json" });
    const arrayJson = response([{ type: "text" as const, text: JSON.stringify([{ actionKind: "move" }]) }]);
    expect(parseRuntimeOutput(arrayJson, "structured_result").actions).toHaveLength(0);
    const partialActions = response([{ type: "structured_output" as const, value: {
      outputKind: "action_event",
      actions: [
        { actionKind: "", payload: { x: 1 } },
        null,
        { actionKind: "move", payload: { x: 2 }, resourceSummary: 5, requiredCapabilities: "bad" }
      ]
    } }]);
    const parsed = parseRuntimeOutput(partialActions, "structured_result");
    expect(parsed.actions).toHaveLength(1);
    expect(parsed.actions[0]?.actionPayload).toEqual({ x: 2 });
    expect(parsed.actions[0]?.resourceSummary).toBe("target action move");
    const structuredArray = response([{ type: "structured_output" as const, value: [{ outputKind: "action_event" }] }]);
    expect(parseRuntimeOutput(structuredArray, "debug_event").outputKind).toBe("debug_event");
  });

  it("covers payload, refs, paths, hashes, and output kind fallback", () => {
    expect(payload(undefined)).toBeNull();
    expect(payload(["a", 1, true])).toEqual(["a", 1, true]);
    expect(payload({ a: { b: "c" } })).toEqual({ a: { b: "c" } });
    expect(payload(Symbol("x"))).toBe("Symbol(x)");
    const traceRef = runtimeTraceRef(makeRuntimeTraceId("trace-1"));
    expect(traceRef.kind).toBe("runtime_trace");
    expect(runtimeFeedbackCandidateHintRef(makeRuntimeFeedbackCandidateHintId("hint-1")).kind).toBe("runtime_feedback_candidate_hint");
    expect(tracePath(traceRef.id)).toContain("trace-1");
    expect(newRuntimeMessageListRef().kind).toBe("message_list");
    expect(stableHash({ a: 1 })).toHaveLength(64);
    expect(firstOutputKind(contractRecord("standard_agent_kernel"))).toBe("action_event");
    expect(firstOutputKind({ ...contractRecord("standard_agent_kernel"), shape: {} })).toBe("structured_result");
  });
});

function outputContent(value: unknown): unknown {
  return typeof value === "object" && value !== null && "content" in value
    ? (value as { readonly content: unknown }).content
    : undefined;
}

function packageRecord() {
  const hatchPackageRef = makeRef("hatch_package", makeHatchPackageId("pkg-1"));
  const runtimeContractRef = makeRef("runtime_contract", makeRuntimeContractId("contract-1"));
  return {
    hatchPackageId: hatchPackageRef.id,
    hatchPackageRef,
    packageName: "pkg",
    hatchRequestRef: { kind: "hatch_request" as const, id: "request-1" as never },
    hatchBuildPlanRef: { kind: "hatch_build_plan" as const, id: "plan-1" as never },
    growUnitRef: makeRef("grow_unit", "grow-1" as never),
    runtimeContractRef,
    readinessVerdictRef: { kind: "readiness_verdict" as const, id: "ready-1" as never },
    version,
    lifecycle: "packaged" as const,
    artifactRef: makeRef("artifact", "artifact-1" as never),
    manifestRef: makeRef("artifact", "manifest-1" as never),
    includedResourceRefs: [],
    excludedResourceRefs: [],
    policyDecisionRefs: [],
    validationSummaryRefs: [],
    buildReceiptRef: { kind: "hatch_build_receipt" as const, id: "receipt-1" as never },
    source: { kind: "system" as const, origin: "test", userProvided: false, receivedAt: "2026-06-06T00:00:00.000Z", privacyLevel: "workspace_private" as const },
    audit: { createdAt: "2026-06-06T00:00:00.000Z", createdBy: "test", reason: "test" },
    createdAt: "2026-06-06T00:00:00.000Z",
    updatedAt: "2026-06-06T00:00:00.000Z",
    recordVersion: 1
  };
}

function contractRecord(runtimeKernelType: "standard_agent_kernel" | "non_llm_runtime") {
  const runtimeContractRef = makeRef("runtime_contract", makeRuntimeContractId("contract-1"));
  return {
    runtimeContractRef,
    growUnitRef: makeRef("grow_unit", "grow-1" as never),
    name: "contract",
    version,
    lifecycle: "locked_for_hatch" as const,
    runtimeKernelType,
    shape: completeShape(false),
    capabilityRequirements: [],
    policyDecisionRefs: [],
    evidenceRefs: [],
    artifactRef: makeRef("artifact", "contract-artifact-1" as never),
    createdAt: "2026-06-06T00:00:00.000Z",
    updatedAt: "2026-06-06T00:00:00.000Z",
    source: { kind: "system" as const, origin: "test", userProvided: false, receivedAt: "2026-06-06T00:00:00.000Z", privacyLevel: "workspace_private" as const },
    audit: { createdAt: "2026-06-06T00:00:00.000Z", createdBy: "test", reason: "test" },
    recordVersion: 1
  };
}

function response(contentBlocks: readonly import("../../src/llm-gateway/index.js").LLMContentBlock[]) {
  return {
    requestId: "request-1" as never,
    provider: "fake",
    model: "fake-model",
    contentBlocks,
    toolCallBlocks: [],
    usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 2 },
    finishReason: "stop" as const,
    providerMetadataSummary: {},
    source: { kind: "runtime" as const, origin: "test", userProvided: false, receivedAt: "2026-06-06T00:00:00.000Z", privacyLevel: "workspace_private" as const },
    audit: { createdAt: "2026-06-06T00:00:00.000Z", createdBy: "test", reason: "test" }
  };
}

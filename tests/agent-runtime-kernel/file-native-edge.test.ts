import { describe, expect, it } from "vitest";
import {
  AgentRuntimeStorage,
  feedbackHintIndexPath,
  invocationIndexPath,
  invocationPath,
  makeRuntimeFeedbackCandidateHintId,
  makeRuntimeInvocationId,
  runtimeFeedbackCandidateHintRef,
  runtimeInvocationRef
} from "../../src/agent-runtime-kernel/index.js";
import { makeRef, makeRuntimeContractId } from "../../src/domain/index.js";
import { TargetWorldAdapterStorage, newWorldInputRef } from "../../src/target-world-adapter/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import {
  allowRuntimePolicy,
  audit,
  echoToolInput,
  makeAgentRuntimeFixture,
  readyAgentRuntime,
  source,
  version
} from "./helpers.js";

describe("Agent Runtime Kernel file-native edge coverage", () => {
  it("links source map entries and trace artifact content under full runtime options", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgentRuntimeFixture(workspace);
      const tool = await fixture.toolRuntime.registerTool(echoToolInput(fixture));
      expect(tool.ok).toBe(true);
      if (!tool.ok) throw new Error(tool.error.message);
      const ready = await readyAgentRuntime(fixture);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const invocation = await fixture.agentRuntime.startRuntimeInvocation({
        hatchPackageRef: ready.value.hatchPackageRef,
        targetWorldRef: ready.value.targetWorldRef,
        mode: "debug",
        modelSelection: { provider: "fake", model: "fake-model", modelVersion: "2026-06-06" },
        requiredCapabilities: { toolCalls: true, structuredOutput: true },
        toolCatalogQuery: { namespace: "test", includeUnavailable: false },
        maxTurns: 2,
        correlationId: "runtime-options-edge",
        source: source(fixture, "runtime"),
        version,
        audit: audit("start full option runtime")
      });
      expect(invocation.ok).toBe(true);
      if (!invocation.ok) throw new Error(invocation.error.message);
      const turn = await fixture.agentRuntime.runRuntimeTurn(invocation.value, ready.value.worldInputRef, {
        policyContext: allowRuntimePolicy(),
        dispatchTargetActions: true,
        timeoutMs: 5_000,
        retryPolicy: { maxAttempts: 1, retryOn: ["timeout"] },
        fallbackPolicy: { fallbacks: [{ provider: "fake", model: "backup-model" }], onErrorCodes: ["response_invalid"] }
      });
      expect(turn.ok).toBe(true);
      if (!turn.ok) throw new Error(turn.error.message);
      const message = await fixture.agentRuntime.explainRuntimeMessageList(turn.value.runtimeMessageListRef);
      expect(message.ok).toBe(true);
      if (!message.ok) throw new Error(message.error.message);
      const storage = new AgentRuntimeStorage(fixture.store, fixture.workspace);
      const messageRecord = await storage.readMessageList(turn.value.runtimeMessageListRef);
      expect(messageRecord.ok).toBe(true);
      if (!messageRecord.ok) throw new Error(messageRecord.error.message);
      for (const section of messageRecord.value.sections) {
        expect(section.sourceMapEntryIds).toContain(`runtime-source-${section.kind}`);
        expect(message.value.sourceMap.entries.some((entry) => entry.entryId === section.sourceMapEntryIds[0])).toBe(true);
      }
      const explanation = await fixture.agentRuntime.explainRuntimeInvocation(invocation.value);
      expect(explanation.ok).toBe(true);
      if (!explanation.ok || explanation.value.traceRef === undefined) throw new Error("missing trace");
      const trace = await fixture.agentRuntime.readRuntimeTrace(explanation.value.traceRef, {
        policyContext: allowRuntimePolicy(),
        reason: "assert file-native trace content"
      });
      expect(trace.ok).toBe(true);
      if (!trace.ok) throw new Error(trace.error.message);
      expect(trace.value.turnRefs).toHaveLength(1);
      const artifact = await fixture.artifacts.materializeArtifact(trace.value.artifactRef, {
        reason: "read trace artifact",
        allowArchived: true,
        maxBytes: 1024 * 1024
      });
      expect(artifact.ok).toBe(true);
      if (!artifact.ok || typeof artifact.value.content !== "string") throw new Error("missing trace artifact");
      const traceContent = JSON.parse(artifact.value.content) as { turnRefs?: readonly { id: string }[] };
      expect(traceContent.turnRefs?.[0]?.id).toBe(trace.value.turnRefs[0]?.id);
      const unavailable = await fixture.artifacts.markUnavailable(messageRecord.value.sourceMapRef, "make source map unavailable");
      expect(unavailable.ok).toBe(true);
      const unavailableExplain = await fixture.agentRuntime.explainRuntimeMessageList(turn.value.runtimeMessageListRef);
      expect(unavailableExplain.ok).toBe(false);
      if (unavailableExplain.ok) throw new Error("unavailable source map should fail");
      expect(unavailableExplain.error.code).toBe("artifact_unavailable");
      const invalidSourceMap = await fixture.artifacts.registerArtifact({
        kind: "summary",
        content: "{bad json",
        mediaType: "application/json",
        encoding: "utf8",
        source: source(fixture, "runtime"),
        version,
        audit: audit("register invalid source map"),
        privacyClass: "workspace_private",
        retentionClass: "runtime_scoped",
        producerModule: "agent-runtime-kernel"
      });
      expect(invalidSourceMap.ok).toBe(true);
      if (!invalidSourceMap.ok) throw new Error(invalidSourceMap.error.message);
      const corrupted = await storage.writeMessageList({
        ...messageRecord.value,
        sourceMapRef: invalidSourceMap.value
      }, "corrupt runtime message source map");
      expect(corrupted.ok).toBe(true);
      const invalidExplain = await fixture.agentRuntime.explainRuntimeMessageList(turn.value.runtimeMessageListRef);
      expect(invalidExplain.ok).toBe(false);
      if (invalidExplain.ok) throw new Error("invalid source map should fail");
      expect(invalidExplain.error.code).toBe("schema_incompatible");
    });
  });

  it("can trace failed invocations and ignores dangling feedback hint index entries", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgentRuntimeFixture(workspace, ["bad response"]);
      const ready = await readyAgentRuntime(fixture);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const invocation = await startDebug(fixture, ready.value);
      const failed = await fixture.agentRuntime.runRuntimeTurn(invocation, ready.value.worldInputRef, {
        policyContext: allowRuntimePolicy()
      });
      expect(failed.ok).toBe(false);
      const traceRef = await fixture.agentRuntime.recordRuntimeTrace(invocation);
      expect(traceRef.ok).toBe(true);
      if (!traceRef.ok) throw new Error(traceRef.error.message);
      const trace = await fixture.agentRuntime.readRuntimeTrace(traceRef.value, { policyContext: allowRuntimePolicy() });
      expect(trace.ok).toBe(true);
      if (!trace.ok) throw new Error(trace.error.message);
      expect(trace.value.privacyClass).toBe("contains_user_content");
      const dangling = runtimeFeedbackCandidateHintRef(makeRuntimeFeedbackCandidateHintId("missing-hint"));
      const written = await fixture.store.writeTextAtomic(
        fixture.workspace,
        feedbackHintIndexPath,
        JSON.stringify({ refs: [dangling] }),
        { reason: "write dangling hint index", createParents: true }
      );
      expect(written.ok).toBe(true);
      const hints = await fixture.agentRuntime.listFeedbackCandidateHints(invocation);
      expect(hints.ok).toBe(true);
      if (!hints.ok) throw new Error(hints.error.message);
      expect(hints.value.total).toBe(0);
    });
  });

  it("surfaces schema errors from file-native storage and keeps duplicate indexes stable", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgentRuntimeFixture(workspace);
      const storage = new AgentRuntimeStorage(fixture.store, fixture.workspace);
      const ref = runtimeInvocationRef(makeRuntimeInvocationId("storage-edge"));
      const badRecord = await fixture.store.writeTextAtomic(
        fixture.workspace,
        invocationPath(ref.id),
        "{bad json",
        { reason: "write invalid invocation", createParents: true }
      );
      expect(badRecord.ok).toBe(true);
      const readBad = await storage.readInvocation(ref);
      expect(readBad.ok).toBe(false);
      if (readBad.ok) throw new Error("bad record should fail");
      expect(readBad.error.code).toBe("schema_incompatible");
      const badIndex = await fixture.store.writeTextAtomic(
        fixture.workspace,
        invocationIndexPath,
        "{bad index",
        { reason: "write invalid invocation index", createParents: true }
      );
      expect(badIndex.ok).toBe(true);
      expect((await storage.addInvocation(ref)).ok).toBe(false);
      const goodIndex = await fixture.store.writeTextAtomic(
        fixture.workspace,
        invocationIndexPath,
        JSON.stringify({ refs: [ref] }),
        { reason: "restore invocation index", createParents: true }
      );
      expect(goodIndex.ok).toBe(true);
      expect((await storage.addInvocation(ref)).ok).toBe(true);
    });
  });

  it("rejects world input from a different runtime contract before message compilation", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgentRuntimeFixture(workspace);
      const ready = await readyAgentRuntime(fixture);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const targetStorage = new TargetWorldAdapterStorage(fixture.store, fixture.workspace);
      const originalInput = await targetStorage.readWorldInput(ready.value.worldInputRef);
      expect(originalInput.ok).toBe(true);
      if (!originalInput.ok) throw new Error(originalInput.error.message);
      const wrongInputRef = newWorldInputRef();
      const wrongInput = await targetStorage.writeWorldInput({
        ...originalInput.value,
        worldInputId: wrongInputRef.id,
        worldInputRef: wrongInputRef,
        runtimeContractRef: makeRef("runtime_contract", makeRuntimeContractId("wrong-contract"))
      }, "write wrong contract world input");
      expect(wrongInput.ok).toBe(true);
      const invocation = await startDebug(fixture, ready.value);
      const mismatch = await fixture.agentRuntime.runRuntimeTurn(invocation, wrongInputRef, {
        policyContext: allowRuntimePolicy()
      });
      expect(mismatch.ok).toBe(false);
      if (mismatch.ok) throw new Error("contract mismatch should fail");
      expect(mismatch.error.code).toBe("contract_incompatible");
    });
  });

  it("rejects startup when the target world has no compatible active adapter", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgentRuntimeFixture(workspace);
      const ready = await readyAgentRuntime(fixture);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const incompatibleWorld = await fixture.target.registerTargetWorld({
        name: "Incompatible Text Target",
        kind: "file_workflow",
        description: "A target with no shared runtime IO or active adapter.",
        inputKinds: ["manual_trigger"],
        outputKinds: ["text_result"],
        actionKinds: ["move"],
        validationKinds: ["scenario_check"],
        debugSignalKinds: ["failure_trace"],
        privacyBoundary: "workspace_private",
        environmentBoundary: "test",
        capabilityRequirements: [],
        source: source(fixture, "system"),
        version,
        audit: audit("register incompatible target")
      });
      expect(incompatibleWorld.ok).toBe(true);
      if (!incompatibleWorld.ok) throw new Error(incompatibleWorld.error.message);
      const started = await fixture.agentRuntime.startRuntimeInvocation({
        hatchPackageRef: ready.value.hatchPackageRef,
        targetWorldRef: incompatibleWorld.value,
        mode: "debug",
        modelSelection: { provider: "fake", model: "fake-model" },
        source: source(fixture, "runtime"),
        version,
        audit: audit("start incompatible target")
      });
      expect(started.ok).toBe(false);
      if (started.ok) throw new Error("incompatible target should fail");
      expect(started.error.code).toBe("adapter_incompatible");
    });
  });

  it("rejects production turns when the file-native production lock is missing or stale", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgentRuntimeFixture(workspace);
      const ready = await readyAgentRuntime(fixture, true);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const storage = new AgentRuntimeStorage(fixture.store, fixture.workspace);
      const missingLock = await startProduction(fixture, ready.value);
      const missingRecord = await storage.readInvocation(missingLock);
      expect(missingRecord.ok).toBe(true);
      if (!missingRecord.ok) throw new Error(missingRecord.error.message);
      const { productionLock: _removed, ...withoutLock } = missingRecord.value;
      const missingWrite = await storage.writeInvocation(withoutLock, "remove production lock");
      expect(missingWrite.ok).toBe(true);
      const missingResult = await fixture.agentRuntime.runRuntimeTurn(missingLock, ready.value.worldInputRef, {
        policyContext: allowRuntimePolicy()
      });
      expect(missingResult.ok).toBe(false);
      if (missingResult.ok) throw new Error("missing lock should fail");
      expect(missingResult.error.code).toBe("production_lock_violation");
      const staleLock = await startProduction(fixture, ready.value);
      const staleRecord = await storage.readInvocation(staleLock);
      expect(staleRecord.ok).toBe(true);
      if (!staleRecord.ok || staleRecord.value.productionLock === undefined) throw new Error("missing production lock");
      const staleWrite = await storage.writeInvocation({
        ...staleRecord.value,
        productionLock: {
          ...staleRecord.value.productionLock,
          runtimeKernelVersion: "agent-runtime-test@old"
        }
      }, "stale production lock");
      expect(staleWrite.ok).toBe(true);
      const staleResult = await fixture.agentRuntime.runRuntimeTurn(staleLock, ready.value.worldInputRef, {
        policyContext: allowRuntimePolicy()
      });
      expect(staleResult.ok).toBe(false);
      if (staleResult.ok) throw new Error("stale lock should fail");
      expect(staleResult.error.code).toBe("production_lock_violation");
    });
  });
});

async function startDebug(fixture: ReturnType<typeof makeAgentRuntimeFixture>, ready: ReadyRuntime) {
  const invocation = await fixture.agentRuntime.startRuntimeInvocation({
    hatchPackageRef: ready.hatchPackageRef,
    targetWorldRef: ready.targetWorldRef,
    mode: "debug",
    modelSelection: { provider: "fake", model: "fake-model" },
    source: source(fixture, "runtime"),
    version,
    audit: audit("start debug edge")
  });
  if (!invocation.ok) throw new Error(invocation.error.message);
  return invocation.value;
}

async function startProduction(fixture: ReturnType<typeof makeAgentRuntimeFixture>, ready: ReadyRuntime) {
  const invocation = await fixture.agentRuntime.startRuntimeInvocation({
    hatchPackageRef: ready.hatchPackageRef,
    targetWorldRef: ready.targetWorldRef,
    mode: "production",
    modelSelection: { provider: "fake", model: "fake-model" },
    source: source(fixture, "runtime"),
    version,
    audit: audit("start production edge")
  });
  if (!invocation.ok) throw new Error(invocation.error.message);
  return invocation.value;
}

interface ReadyRuntime {
  readonly hatchPackageRef: import("../../src/domain/index.js").HatchPackageRef;
  readonly targetWorldRef: import("../../src/domain/index.js").TargetWorldRef;
  readonly worldInputRef: import("../../src/target-world-adapter/index.js").WorldInputEnvelopeRef;
}

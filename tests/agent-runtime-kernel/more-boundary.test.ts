import { describe, expect, it } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import { registerTextArtifact } from "../hatch-builder/helpers.js";
import { registerGameWorld } from "../target-world-adapter/helpers.js";
import {
  allowRuntimePolicy,
  audit,
  buildWorldInput,
  denyRuntimePolicy,
  makeAgentRuntimeFixture,
  readyAgentRuntime,
  source,
  toolCallResponse,
  version
} from "./helpers.js";

describe("Agent Runtime Kernel additional boundaries", () => {
  it("rejects mismatched world inputs and max turn overflow", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgentRuntimeFixture(workspace);
      const ready = await readyAgentRuntime(fixture);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const otherWorld = await registerGameWorld(fixture);
      expect(otherWorld.ok).toBe(true);
      if (!otherWorld.ok) throw new Error(otherWorld.error.message);
      const otherInput = await buildWorldInput(fixture, ready.value.hatchPackageRef, otherWorld.value.targetWorldRef);
      expect(otherInput.ok).toBe(true);
      if (!otherInput.ok) throw new Error(otherInput.error.message);
      const invocation = await start(fixture, ready.value, "debug", 1);
      const mismatch = await fixture.agentRuntime.runRuntimeTurn(invocation, otherInput.value.worldInputRef, {
        policyContext: allowRuntimePolicy()
      });
      expect(mismatch.ok).toBe(false);
      if (mismatch.ok) throw new Error("mismatched target should fail");
      expect(mismatch.error.code).toBe("target_unavailable");
      const dry = await start(fixture, ready.value, "dry_run", 1);
      expect((await fixture.agentRuntime.runRuntimeTurn(dry, ready.value.worldInputRef)).ok).toBe(true);
      const overflow = await fixture.agentRuntime.runRuntimeTurn(dry, ready.value.worldInputRef);
      expect(overflow.ok).toBe(false);
      if (overflow.ok) throw new Error("max turn should fail");
      expect(overflow.error.code).toBe("invalid_state");
    });
  });

  it("blocks terminal invocations and runs a production turn with version lock", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgentRuntimeFixture(workspace);
      const ready = await readyAgentRuntime(fixture, true);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const cancelled = await start(fixture, ready.value, "debug");
      expect((await fixture.agentRuntime.cancelRuntimeInvocation(cancelled, "done")).ok).toBe(true);
      const blocked = await fixture.agentRuntime.runRuntimeTurn(cancelled, ready.value.worldInputRef, {
        policyContext: allowRuntimePolicy()
      });
      expect(blocked.ok).toBe(false);
      if (blocked.ok) throw new Error("terminal invocation should fail");
      expect(blocked.error.code).toBe("invalid_state");
      const prod = await start(fixture, ready.value, "production");
      const turn = await fixture.agentRuntime.runRuntimeTurn(prod, ready.value.worldInputRef, {
        policyContext: allowRuntimePolicy()
      });
      expect(turn.ok).toBe(true);
      if (!turn.ok) throw new Error(turn.error.message);
      expect(turn.value.status).toBe("completed");
    });
  });

  it("keeps long-term memory reads constrained to accepted package or contract material", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgentRuntimeFixture(workspace);
      const ready = await readyAgentRuntime(fixture);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const extra = await registerTextArtifact(fixture, { content: "unaccepted memory" });
      expect(extra.ok).toBe(true);
      if (!extra.ok) throw new Error(extra.error.message);
      const invalid = await fixture.agentRuntime.startRuntimeInvocation({
        hatchPackageRef: ready.value.hatchPackageRef,
        targetWorldRef: ready.value.targetWorldRef,
        mode: "debug",
        modelSelection: { provider: "fake", model: "fake-model" },
        longTermMemoryArtifactRefs: [extra.value],
        source: source(fixture, "runtime"),
        version,
        audit: audit("start invalid memory")
      });
      expect(invalid.ok).toBe(false);
      if (invalid.ok) throw new Error("invalid memory should fail");
      expect(invalid.error.code).toBe("invalid_input");
      const pkg = await fixture.hatch.getHatchPackage(ready.value.hatchPackageRef);
      expect(pkg.ok).toBe(true);
      if (!pkg.ok) throw new Error(pkg.error.message);
      const contract = await fixture.contracts.getRuntimeContract(pkg.value.runtimeContractRef);
      expect(contract.ok).toBe(true);
      if (!contract.ok || contract.value.evidenceRefs[0] === undefined) throw new Error("missing evidence");
      const valid = await fixture.agentRuntime.startRuntimeInvocation({
        hatchPackageRef: ready.value.hatchPackageRef,
        targetWorldRef: ready.value.targetWorldRef,
        mode: "debug",
        modelSelection: { provider: "fake", model: "fake-model" },
        longTermMemoryArtifactRefs: [contract.value.evidenceRefs[0]],
        source: source(fixture, "runtime"),
        version,
        audit: audit("start valid memory")
      });
      expect(valid.ok).toBe(true);
    });
  });

  it("covers tool policy and max tool call blockers", async () => {
    await withWorkspace(async (workspace) => {
      const noPolicy = makeAgentRuntimeFixture(workspace, [toolCallResponse()]);
      const ready = await readyAgentRuntime(noPolicy);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const blocked = await noPolicy.agentRuntime.runRuntimeTurn(
        await start(noPolicy, ready.value, "debug"),
        ready.value.worldInputRef
      );
      expect(blocked.ok).toBe(false);
      if (blocked.ok) throw new Error("tool without policy should fail");
      expect(blocked.error.code).toBe("policy_blocked");
    });
    await withWorkspace(async (workspace) => {
      const fixture = makeAgentRuntimeFixture(workspace, [toolCallResponse()]);
      const ready = await readyAgentRuntime(fixture);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const maxed = await fixture.agentRuntime.runRuntimeTurn(
        await start(fixture, ready.value, "debug"),
        ready.value.worldInputRef,
        { policyContext: allowRuntimePolicy(), maxToolCalls: 0 }
      );
      expect(maxed.ok).toBe(false);
      if (maxed.ok) throw new Error("max tool calls should fail");
      expect(maxed.error.code).toBe("tool_failed");
    });
  });

  it("handles outputs without target actions and records manual feedback hints", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAgentRuntimeFixture(workspace, [noActionResponse()]);
      const ready = await readyAgentRuntime(fixture);
      expect(ready.ok).toBe(true);
      if (!ready.ok) throw new Error(ready.error.message);
      const invocation = await start(fixture, ready.value, "debug");
      const turn = await fixture.agentRuntime.runRuntimeTurn(invocation, ready.value.worldInputRef, {
        policyContext: allowRuntimePolicy()
      });
      expect(turn.ok).toBe(true);
      if (!turn.ok) throw new Error(turn.error.message);
      expect(turn.value.targetActionRequestRefs).toHaveLength(0);
      const explanation = await fixture.agentRuntime.explainRuntimeInvocation(invocation);
      expect(explanation.ok).toBe(true);
      if (!explanation.ok || explanation.value.traceRef === undefined) throw new Error("missing trace");
      const deniedTrace = await fixture.agentRuntime.readRuntimeTrace(explanation.value.traceRef, {
        policyContext: denyRuntimePolicy("artifact.read")
      });
      expect(deniedTrace.ok).toBe(false);
      const hint = await fixture.agentRuntime.recordFeedbackCandidateHint({
        runtimeInvocationRef: invocation,
        runtimeTraceRef: explanation.value.traceRef,
        targetWorldRef: ready.value.targetWorldRef,
        summary: "manual debug observation",
        attributionHint: "test",
        evidenceRefs: [],
        privacyClass: "workspace_private",
        debugModeOnly: true,
        source: source(fixture, "runtime"),
        audit: audit("manual hint")
      });
      expect(hint.ok).toBe(true);
      const hints = await fixture.agentRuntime.listFeedbackCandidateHints(invocation);
      expect(hints.ok).toBe(true);
      if (!hints.ok) throw new Error(hints.error.message);
      expect(hints.value.total).toBe(1);
    });
  });
});

async function start(
  fixture: ReturnType<typeof makeAgentRuntimeFixture>,
  ready: ReadyRuntime,
  mode: "debug" | "dry_run" | "production",
  maxTurns?: number
) {
  const invocation = await fixture.agentRuntime.startRuntimeInvocation({
    hatchPackageRef: ready.hatchPackageRef,
    targetWorldRef: ready.targetWorldRef,
    mode,
    modelSelection: { provider: "fake", model: "fake-model" },
    ...(maxTurns === undefined ? {} : { maxTurns }),
    source: source(fixture, "runtime"),
    version,
    audit: audit(`start ${mode}`)
  });
  if (!invocation.ok) throw new Error(invocation.error.message);
  return invocation.value;
}

function noActionResponse() {
  return {
    id: "runtime-response-no-action",
    model: "fake-model",
    choices: [{
      message: { content: JSON.stringify({ outputKind: "action_event", content: { decision: "wait" } }) },
      finish_reason: "stop"
    }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }
  };
}

interface ReadyRuntime {
  readonly hatchPackageRef: import("../../src/domain/index.js").HatchPackageRef;
  readonly targetWorldRef: import("../../src/domain/index.js").TargetWorldRef;
  readonly worldInputRef: import("../../src/target-world-adapter/index.js").WorldInputEnvelopeRef;
}

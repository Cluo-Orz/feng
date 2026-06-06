import { describe, expect, test } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import {
  artifactInput,
  audit,
  createGrowAndAgenda,
  source,
  version
} from "../agenda-dod-manager/helpers.js";
import {
  attemptErrResult,
  attemptEventTypes,
  createAttemptRuntime,
  latestCheckpointRef,
  mutateAttempt,
  readAttemptJsonArtifact,
  registerAttemptJsonArtifact,
  settlementArtifacts,
  summarizeAttemptRecord,
  terminalStatus,
  writeRecordWithEvent
} from "../../src/grow-attempt-runner/index.js";
import { makeArtifactId, makeRef } from "../../src/domain/index.js";
import type { GrowAttemptRunnerOptions } from "../../src/grow-attempt-runner/index.js";
import type { LLMProviderAdapter } from "../../src/llm-gateway/index.js";
import type { ToolSettlement } from "../../src/tool-runtime/index.js";
import {
  allowAllPolicy,
  echoToolInput,
  fakeAdapter,
  makeAttemptFixture,
  textResponse,
  toolResponse
} from "./helpers.js";

describe("Grow Attempt Runner misc edge coverage", () => {
  test("attempt JSON artifacts preserve parent links and lifecycle failures", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace);
      const runtime = createAttemptRuntime(runtimeOptions(fixture));
      const parent = await registerAttemptJsonArtifact({
        runtime,
        kind: "summary",
        content: { parent: true },
        source: source(fixture, "system"),
        version,
        audit: audit("parent artifact")
      });
      expect(parent.ok).toBe(true);
      if (!parent.ok) throw new Error(parent.error.message);
      const child = await registerAttemptJsonArtifact({
        runtime,
        kind: "summary",
        content: { child: true },
        source: source(fixture, "system"),
        version,
        audit: audit("child artifact"),
        parentRefs: [parent.value]
      });
      expect(child.ok).toBe(true);
      if (!child.ok) throw new Error(child.error.message);
      const read = await readAttemptJsonArtifact<{ child: boolean }>({
        runtime,
        artifactRef: child.value,
        reason: "read child"
      });
      expect(read.ok).toBe(true);
      if (read.ok) expect(read.value.child).toBe(true);

      const bad = await fixture.artifacts.registerArtifact(artifactInput(fixture, "not-json"));
      expect(bad.ok).toBe(true);
      if (!bad.ok) throw new Error(bad.error.message);
      const invalid = await readAttemptJsonArtifact({ runtime, artifactRef: bad.value, reason: "read bad" });
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) expect(invalid.error.code).toBe("schema_incompatible");

      const unavailable = await registerAttemptJsonArtifact({
        runtime,
        kind: "summary",
        content: { available: false },
        source: source(fixture, "system"),
        version,
        audit: audit("unavailable artifact")
      });
      expect(unavailable.ok).toBe(true);
      if (!unavailable.ok) throw new Error(unavailable.error.message);
      expect((await fixture.artifacts.markUnavailable(unavailable.value, "simulate missing content")).ok).toBe(true);
      const unavailableRead = await readAttemptJsonArtifact({
        runtime,
        artifactRef: unavailable.value,
        reason: "read unavailable"
      });
      expect(unavailableRead.ok).toBe(false);
      if (!unavailableRead.ok) expect(unavailableRead.error.code).toBe("artifact_unavailable");
    });
  });

  test("runtime record helpers expose terminal and checkpoint facts", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace);
      const runtime = createAttemptRuntime(runtimeOptions(fixture));
      const attempt = await createAttempt(fixture);
      const read = await runtime.storage.readAttempt(attempt);
      expect(read.ok).toBe(true);
      if (!read.ok) throw new Error(read.error.message);
      expect(terminalStatus(read.value.status)).toBe(false);
      expect(terminalStatus("completed")).toBe(true);
      expect(latestCheckpointRef(read.value)).toBeUndefined();
      expect(summarizeAttemptRecord(read.value).candidateOutputCount).toBe(0);

      const mutated = mutateAttempt(read.value, { status: "running" });
      const written = await writeRecordWithEvent({
        runtime,
        record: mutated,
        eventType: attemptEventTypes.started,
        body: { manual: true },
        reason: "write helper branch"
      });
      expect(written.ok).toBe(true);
      const err = attemptErrResult<never>("invalid_input", "bad test input", { retryable: true });
      expect(err.ok).toBe(false);
      const cancelled = await fixture.runner.cancelAttempt(attempt, "stop after helper check");
      expect(cancelled.ok).toBe(true);
      if (cancelled.ok) {
        expect(terminalStatus(cancelled.value.status)).toBe(true);
        expect(latestCheckpointRef(cancelled.value)).toBeDefined();
      }
    });
  });

  test("non-candidate content blocks do not create candidate outputs", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace, nonCandidateAdapter());
      const attempt = await createAttempt(fixture);
      const outcome = await fixture.runner.runAttempt(attempt, { policyContext: allowAllPolicy() });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error(outcome.error.message);
      expect(outcome.value.candidateOutputRefs).toHaveLength(0);
      const record = await fixture.runner.readAttempt(attempt);
      expect(record.ok).toBe(true);
      if (record.ok) expect(record.value.candidateOutputRefs).toHaveLength(0);
    });
  });

  test("invalid tool arguments settle through Tool Runtime validation", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace, fakeAdapter([badToolArgsResponse()]));
      const tool = await fixture.toolsRuntime.registerTool(echoToolInput(fixture));
      expect(tool.ok).toBe(true);
      const attempt = await createAttempt(fixture);
      const outcome = await fixture.runner.runAttempt(attempt, {
        policyContext: allowAllPolicy(),
        toolUsePolicy: { continueAfterToolFailure: false }
      });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.value.exitReason).toBe("tool_failed");
    });
  });

  test("provider ask policy finalizes as approval_required", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace, fakeAdapter([textResponse("blocked")]));
      const attempt = await createAttempt(fixture);
      const outcome = await fixture.runner.runAttempt(attempt, {
        policyContext: askProviderPolicy(),
        retryPolicy: { maxRetries: 0 }
      });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.value.status).toBe("failed");
        expect(outcome.value.exitReason).toBe("approval_required");
      }
    });
  });

  test("tool resolution accepts short names and persisted tool ids", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace, fakeAdapter([toolResponse("echo"), textResponse("short name")]));
      const tool = await fixture.toolsRuntime.registerTool(echoToolInput(fixture));
      expect(tool.ok).toBe(true);
      const attempt = await createAttempt(fixture);
      const outcome = await fixture.runner.runAttempt(attempt, {
        policyContext: allowAllPolicy(),
        maxTurns: 2
      });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.value.exitReason).toBe("completed_after_tool_settlement");
    });

    await withWorkspace(async (workspace) => {
      let toolName = "test.echo";
      const fixture = makeAttemptFixture(workspace, dynamicToolAdapter(() => toolName));
      const tool = await fixture.toolsRuntime.registerTool(echoToolInput(fixture));
      expect(tool.ok).toBe(true);
      if (!tool.ok) throw new Error(tool.error.message);
      toolName = tool.value.id;
      const attempt = await createAttempt(fixture);
      const outcome = await fixture.runner.runAttempt(attempt, {
        policyContext: allowAllPolicy(),
        maxTurns: 2
      });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.value.exitReason).toBe("completed_after_tool_settlement");
    });
  });

  test("settlement artifacts are compacted into unique continuation refs", () => {
    const first = makeRef("artifact", makeArtifactId("artifact-settlement-a"));
    const second = makeRef("artifact", makeArtifactId("artifact-settlement-b"));
    const settlements = [
      { settlementRef: first, resultArtifactRef: first },
      { resultArtifactRef: second },
      {}
    ] as unknown as readonly ToolSettlement[];
    expect(settlementArtifacts(settlements).map((ref) => ref.id)).toEqual([first.id, second.id]);
  });
});

async function createAttempt(fixture: ReturnType<typeof makeAttemptFixture>) {
  const grow = await createGrowAndAgenda(fixture);
  expect(grow.ok).toBe(true);
  if (!grow.ok) throw new Error(grow.error.message);
  const intent = await fixture.agenda.buildAttemptIntent(grow.value, {
    source: source(fixture, "system"),
    audit: audit("build intent")
  });
  expect(intent.ok).toBe(true);
  if (!intent.ok) throw new Error(intent.error.message);
  const attempt = await fixture.runner.createAttempt({
    growUnitRef: grow.value,
    attemptIntentRef: intent.value,
    modelSelection: { provider: "fake", model: "fake-model" },
    source: source(fixture, "system"),
    version,
    audit: audit("create attempt")
  });
  expect(attempt.ok).toBe(true);
  if (!attempt.ok) throw new Error(attempt.error.message);
  return attempt.value;
}

function runtimeOptions(fixture: ReturnType<typeof makeAttemptFixture>): GrowAttemptRunnerOptions {
  return {
    workspace: fixture.workspace,
    store: fixture.store,
    ledger: fixture.ledger,
    artifactRegistry: fixture.artifacts,
    policyBoundary: fixture.policy,
    growUnitManager: fixture.grow,
    admissionInbox: fixture.admission,
    agendaDoDManager: fixture.agenda,
    contextCompiler: fixture.context,
    llmGateway: fixture.llm,
    toolRuntime: fixture.toolsRuntime,
    producer: "attempt-test"
  };
}

function nonCandidateAdapter(): LLMProviderAdapter {
  return {
    ...fakeAdapter([textResponse("ignored raw")]),
    normalizeResponse: async (_raw, context) => ({
      requestId: context.request.requestId,
      provider: "fake",
      model: "fake-model",
      contentBlocks: [
        { type: "refusal_or_safety_notice", text: "blocked" },
        { type: "reasoning_summary", text: "private reasoning summary" },
        { type: "unknown", rawSummary: "opaque provider block" }
      ],
      toolCallBlocks: [],
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 2
      },
      finishReason: "stop",
      providerMetadataSummary: {},
      source: context.request.source,
      audit: context.request.audit
    })
  };
}

function dynamicToolAdapter(name: () => string): LLMProviderAdapter {
  let calls = 0;
  return {
    ...fakeAdapter(),
    send: async () => {
      calls += 1;
      return calls === 1 ? toolResponse(name()) : textResponse("after tool");
    }
  };
}

function askProviderPolicy() {
  return {
    ...allowAllPolicy(),
    rules: [{ capability: "external_service.call", resource: "*", verdict: "ask" as const }]
  };
}

function badToolArgsResponse(): unknown {
  return {
    choices: [{
      message: {
        content: "",
        tool_calls: [{
          id: "call-bad-json",
          function: { name: "test.echo", arguments: "{bad json" }
        }]
      },
      finish_reason: "tool_calls"
    }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }
  };
}

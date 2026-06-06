import { describe, expect, test } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import { audit, createGrowAndAgenda, source, version } from "../agenda-dod-manager/helpers.js";
import { makeAttemptId, makeRef } from "../../src/domain/index.js";
import { AttemptStorage, parseJson } from "../../src/grow-attempt-runner/index.js";
import {
  allowAllPolicy,
  echoToolInput,
  fakeAdapter,
  makeAttemptFixture,
  textResponse,
  toolResponse
} from "./helpers.js";
import type { LLMProviderAdapter } from "../../src/llm-gateway/index.js";

describe("Grow Attempt Runner edge paths", () => {
  test("streams normalized response events into candidate output", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace, fakeAdapter());
      const attempt = await createAttempt(fixture);
      const outcome = await fixture.runner.runAttempt(attempt, {
        policyContext: allowAllPolicy(),
        streamingPreference: "preferred"
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error(outcome.error.message);
      expect(outcome.value.exitReason).toBe("completed_no_tool_calls");
      expect(outcome.value.candidateOutputRefs).toHaveLength(1);
    });
  });

  test("stream failure produces failed outcome without provider session resume", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace, failingStreamAdapter());
      const attempt = await createAttempt(fixture);
      const outcome = await fixture.runner.runAttempt(attempt, {
        policyContext: allowAllPolicy(),
        streamingPreference: "preferred",
        retryPolicy: { maxRetries: 0 }
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error(outcome.error.message);
      expect(outcome.value.status).toBe("failed");
      expect(outcome.value.exitReason).toBe("retry_budget_exhausted");
    });
  });

  test("tool failure can stop the attempt by policy", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace, fakeAdapter([toolResponse("missing.tool")]));
      const attempt = await createAttempt(fixture);
      const outcome = await fixture.runner.runAttempt(attempt, {
        policyContext: allowAllPolicy(),
        toolUsePolicy: { continueAfterToolFailure: false }
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error(outcome.error.message);
      expect(outcome.value.exitReason).toBe("tool_failed");
      expect(outcome.value.toolSettlementRefs).toHaveLength(1);
    });
  });

  test("tool policy ask exits with approval_required when tool failures stop attempts", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace, fakeAdapter([toolResponse("echo")]));
      const tool = await fixture.toolsRuntime.registerTool(echoToolInput(fixture));
      expect(tool.ok).toBe(true);
      const attempt = await createAttempt(fixture);
      const outcome = await fixture.runner.runAttempt(attempt, {
        policyContext: askToolPolicy(),
        toolUsePolicy: { continueAfterToolFailure: false }
      });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.value.exitReason).toBe("approval_required");
    });
  });

  test("max tool call and max turn limits are explicit exit reasons", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace, fakeAdapter([toolResponse()]));
      const tool = await fixture.toolsRuntime.registerTool(echoToolInput(fixture));
      expect(tool.ok).toBe(true);
      const attempt = await createAttempt(fixture);
      const tooManyTools = await fixture.runner.runAttempt(attempt, {
        policyContext: allowAllPolicy(),
        maxToolCalls: 0
      });
      expect(tooManyTools.ok).toBe(true);
      if (tooManyTools.ok) expect(tooManyTools.value.exitReason).toBe("max_tool_calls_reached");
    });

    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace, fakeAdapter([toolResponse()]));
      const tool = await fixture.toolsRuntime.registerTool(echoToolInput(fixture));
      expect(tool.ok).toBe(true);
      const attempt = await createAttempt(fixture);
      const tooManyTurns = await fixture.runner.runAttempt(attempt, {
        policyContext: allowAllPolicy(),
        maxTurns: 1
      });
      expect(tooManyTurns.ok).toBe(true);
      if (tooManyTurns.ok) expect(tooManyTurns.value.exitReason).toBe("max_turns_reached");
    });
  });

  test("interrupt can be resumed from file-native checkpoint", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace, fakeAdapter([textResponse("after resume")]));
      const attempt = await createAttempt(fixture);
      const interrupted = await fixture.runner.interruptAttempt(attempt, "process restart");
      expect(interrupted.ok).toBe(true);
      if (interrupted.ok) expect(interrupted.value.phase).toBe("before_interrupt");
      const outcome = await fixture.runner.resumeAttempt(attempt, { policyContext: allowAllPolicy() });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.value.status).toBe("completed");
    });
  });

  test("attempt-level retry records checkpoint and then completes", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace, flakyAdapter());
      const attempt = await createAttempt(fixture);
      const outcome = await fixture.runner.runAttempt(attempt, { policyContext: allowAllPolicy() });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error(outcome.error.message);
      expect(outcome.value.status).toBe("completed");
      const explanation = await fixture.runner.explainAttempt(attempt);
      expect(explanation.ok).toBe(true);
      if (explanation.ok) expect(explanation.value.facts.some((fact) => fact.startsWith("providerReceipts="))).toBe(true);
    });
  });

  test("list, missing trace, and terminal cancel paths stay explicit", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace);
      const page0 = await fixture.runner.listAttempts();
      expect(page0.ok).toBe(true);
      if (page0.ok) expect(page0.value.records).toHaveLength(0);
      const attempt = await createAttempt(fixture);
      const second = await createAttempt(fixture);
      const missingTrace = await fixture.runner.readAttemptTrace(attempt);
      expect(missingTrace.ok).toBe(false);
      const filtered = await fixture.runner.listAttempts({ status: "created", limit: 1 });
      expect(filtered.ok).toBe(true);
      if (filtered.ok) expect(filtered.value.records).toHaveLength(1);
      const paged = await fixture.runner.listAttempts({ limit: 1 });
      expect(paged.ok).toBe(true);
      if (paged.ok) expect(paged.value.nextCursor).toBe("1");
      if (filtered.ok && filtered.value.records[0] !== undefined) {
        const byGrow = await fixture.runner.listAttempts({ growUnitRef: filtered.value.records[0].growUnitRef });
        expect(byGrow.ok).toBe(true);
        if (byGrow.ok) expect(byGrow.value.total).toBeGreaterThanOrEqual(1);
      }
      const cancelled1 = await fixture.runner.cancelAttempt(attempt, "stop once");
      const cancelled2 = await fixture.runner.cancelAttempt(attempt, "stop twice");
      expect(cancelled1.ok).toBe(true);
      expect(cancelled2.ok).toBe(true);
      if (cancelled2.ok) expect(cancelled2.value.status).toBe("cancelled");
      const secondCancelled = await fixture.runner.cancelAttempt(second, "cleanup");
      expect(secondCancelled.ok).toBe(true);
    });
  });

  test("storage can read every file-native record produced by a completed attempt", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace, fakeAdapter([textResponse("candidate")]));
      const attempt = await createAttempt(fixture);
      const outcome = await fixture.runner.runAttempt(attempt, { policyContext: allowAllPolicy() });
      expect(outcome.ok).toBe(true);
      const storage = new AttemptStorage(fixture.store, fixture.workspace);
      const record = await storage.readAttempt(attempt);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);
      const snapshot = await storage.readSnapshot(record.value);
      const plan = await storage.readPlan(record.value);
      const turn = await storage.readTurn(record.value, record.value.turnRefs[0]!);
      const candidate = await storage.readCandidate(record.value, record.value.candidateOutputRefs[0]!);
      const checkpoint = await storage.readCheckpoint(record.value, record.value.checkpointRefs[0]!);
      const storedOutcome = await storage.readOutcome(record.value);
      expect(snapshot.ok).toBe(true);
      expect(plan.ok).toBe(true);
      expect(turn.ok).toBe(true);
      expect(candidate.ok).toBe(true);
      expect(checkpoint.ok).toBe(true);
      expect(storedOutcome.ok).toBe(true);
      const bad = parseJson("{", "bad json");
      expect(bad.ok).toBe(false);
    });
  });

  test("missing attempt and completed terminal paths are explicit", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace, fakeAdapter([textResponse("done")]));
      const missing = await fixture.runner.readAttempt(makeRef("attempt", makeAttemptId("attempt-missing")));
      expect(missing.ok).toBe(false);
      const attempt = await createAttempt(fixture);
      const outcome1 = await fixture.runner.runAttempt(attempt, { policyContext: allowAllPolicy() });
      const outcome2 = await fixture.runner.runAttempt(attempt, { policyContext: allowAllPolicy() });
      expect(outcome1.ok).toBe(true);
      expect(outcome2.ok).toBe(true);
      const interrupted = await fixture.runner.interruptAttempt(attempt, "too late");
      expect(interrupted.ok).toBe(false);
      if (!interrupted.ok) expect(interrupted.error.code).toBe("invalid_state");
    });
  });

  test("createAttempt rejects blocked grow units before execution", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace);
      const grow = await createGrowAndAgenda(fixture);
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);
      const intent = await fixture.agenda.buildAttemptIntent(grow.value, {
        source: source(fixture, "system"),
        audit: audit("build intent")
      });
      expect(intent.ok).toBe(true);
      if (!intent.ok) throw new Error(intent.error.message);
      const blocked = await fixture.grow.blockGrowUnit(grow.value, {
        reason: "block for test",
        source: source(fixture, "system"),
        audit: audit("block")
      });
      expect(blocked.ok).toBe(true);
      const attempt = await fixture.runner.createAttempt({
        growUnitRef: grow.value,
        attemptIntentRef: intent.value,
        modelSelection: { provider: "fake", model: "fake-model" },
        source: source(fixture, "system"),
        version,
        audit: audit("create blocked attempt")
      });
      expect(attempt.ok).toBe(false);
      if (!attempt.ok) expect(attempt.error.code).toBe("grow_unit_blocked");
    });
  });

  test("createAttempt rejects archived grow units", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace);
      const grow = await createGrowAndAgenda(fixture);
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);
      const intent = await fixture.agenda.buildAttemptIntent(grow.value, {
        source: source(fixture, "system"),
        audit: audit("build intent")
      });
      expect(intent.ok).toBe(true);
      if (!intent.ok) throw new Error(intent.error.message);
      const archived = await fixture.grow.archiveGrowUnit(grow.value, {
        reason: "archive for test",
        source: source(fixture, "system"),
        audit: audit("archive"),
        policyContext: allowArchivePolicy()
      });
      expect(archived.ok).toBe(true);
      const attempt = await fixture.runner.createAttempt({
        growUnitRef: grow.value,
        attemptIntentRef: intent.value,
        modelSelection: { provider: "fake", model: "fake-model" },
        source: source(fixture, "system"),
        version,
        audit: audit("create archived attempt")
      });
      expect(attempt.ok).toBe(false);
      if (!attempt.ok) expect(attempt.error.code).toBe("grow_unit_archived");
    });
  });

  test("custom normalized blocks register structured and text candidate kinds", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace, structuredAdapter());
      const attempt = await createAttempt(fixture);
      const outcome = await fixture.runner.runAttempt(attempt, { policyContext: allowAllPolicy() });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.value.candidateOutputRefs.length).toBeGreaterThanOrEqual(3);
    });
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

function failingStreamAdapter(): LLMProviderAdapter {
  return {
    ...fakeAdapter(),
    stream: async function* () {
      throw new Error("stream crashed");
    }
  };
}

function flakyAdapter(): LLMProviderAdapter {
  let failed = false;
  return {
    ...fakeAdapter([textResponse("after retry")]),
    send: async () => {
      if (!failed) {
        failed = true;
        throw new Error("provider unavailable once");
      }
      return textResponse("after retry");
    }
  };
}

function askToolPolicy() {
  return {
    ...allowAllPolicy(),
    rules: [
      { capability: "external_service.call", resource: "*", verdict: "allow" as const },
      { capability: "file.read", resource: "*", verdict: "ask" as const }
    ]
  };
}

function allowArchivePolicy() {
  return {
    ...allowAllPolicy(),
    rules: [{ capability: "file.delete", resource: "*", verdict: "allow" as const }]
  };
}

function structuredAdapter(): LLMProviderAdapter {
  return {
    ...fakeAdapter(),
    normalizeResponse: async (_raw, context) => ({
      requestId: context.request.requestId,
      provider: "fake",
      model: "fake-model",
      contentBlocks: [
        { type: "text", text: "runtime contract patch and validation instructions" },
        { type: "text", text: "skill candidate with tool plan" },
        { type: "structured_output", value: { ok: true } }
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

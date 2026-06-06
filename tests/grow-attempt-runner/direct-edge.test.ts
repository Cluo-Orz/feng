import { describe, expect, test } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import {
  audit,
  createGrowAndAgenda,
  source,
  version
} from "../agenda-dod-manager/helpers.js";
import {
  addPolicyDecisionToPlan,
  createAttemptRuntime,
  mutateAttempt,
  readAttemptJsonArtifact,
  registerNormalizedResponseArtifact
} from "../../src/grow-attempt-runner/index.js";
import { makeArtifactId, makeRef } from "../../src/domain/index.js";
import type { GrowAttemptRunnerOptions } from "../../src/grow-attempt-runner/index.js";
import type { LLMProviderAdapter } from "../../src/llm-gateway/index.js";
import {
  allowAllPolicy,
  fakeAdapter,
  makeAttemptFixture,
  textResponse
} from "./helpers.js";

describe("Grow Attempt Runner direct edge paths", () => {
  test("missing artifacts and terminal records without outcomes fail explicitly", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace);
      const runtime = createAttemptRuntime(runtimeOptions(fixture));
      const missingArtifact = makeRef("artifact", makeArtifactId("artifact-missing-for-attempt"));
      const missing = await readAttemptJsonArtifact({
        runtime,
        artifactRef: missingArtifact,
        reason: "missing artifact"
      });
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.error.code).toBe("not_found");

      const attempt = await createAttempt(fixture);
      const record = await runtime.storage.readAttempt(attempt);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);
      const terminalWithoutOutcome = mutateAttempt(record.value, {
        status: "completed",
        exitReason: "completed_no_tool_calls"
      });
      expect((await runtime.storage.writeAttempt(terminalWithoutOutcome, "force terminal")).ok).toBe(true);
      const rerun = await fixture.runner.runAttempt(attempt, { policyContext: allowAllPolicy() });
      expect(rerun.ok).toBe(false);
      if (!rerun.ok) expect(rerun.error.code).toBe("invalid_state");
    });
  });

  test("validation candidates and duplicate policy decisions stay stable", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace, fakeAdapter([textResponse("verify candidate evidence")]));
      const runtime = createAttemptRuntime(runtimeOptions(fixture));
      const attempt = await createAttempt(fixture);
      const outcome = await fixture.runner.runAttempt(attempt, { policyContext: allowAllPolicy() });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error(outcome.error.message);
      const record = await runtime.storage.readAttempt(attempt);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);
      const candidate = await runtime.storage.readCandidate(record.value, record.value.candidateOutputRefs[0]!);
      expect(candidate.ok).toBe(true);
      if (candidate.ok) expect(candidate.value.kind).toBe("validation_instruction_candidate");
      const plan = await runtime.storage.readPlan(record.value);
      expect(plan.ok).toBe(true);
      if (!plan.ok) throw new Error(plan.error.message);
      expect(plan.value.policyDecisionRefs.length).toBeGreaterThan(0);
      const same = await addPolicyDecisionToPlan(runtime, plan.value, plan.value.policyDecisionRefs[0]!);
      expect(same.ok).toBe(true);
      if (same.ok) expect(same.value.policyDecisionRefs).toHaveLength(plan.value.policyDecisionRefs.length);
    });
  });

  test("stream response_failed events map non-interrupted failures to llm_failed", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace, failedEventStreamAdapter());
      const attempt = await createAttempt(fixture);
      const outcome = await fixture.runner.runAttempt(attempt, {
        policyContext: allowAllPolicy(),
        streamingPreference: "preferred",
        retryPolicy: { maxRetries: 0 }
      });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.value.exitReason).toBe("retry_budget_exhausted");
    });
  });

  test("run options propagate timeout and correlation while artifacting responses without receipts", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace, fakeAdapter([textResponse("timed candidate")]));
      const runtime = createAttemptRuntime(runtimeOptions(fixture));
      const attempt = await createAttempt(fixture);
      const outcome = await fixture.runner.runAttempt(attempt, {
        policyContext: allowAllPolicy(),
        timeoutPolicy: { turnTimeoutMs: 1_000 },
        correlationId: "run-correlation"
      });
      expect(outcome.ok).toBe(true);
      const record = await runtime.storage.readAttempt(attempt);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);
      expect(record.value.correlationId).toBe("run-correlation");
      const turn = await runtime.storage.readTurn(record.value, record.value.turnRefs[0]!);
      expect(turn.ok).toBe(true);
      if (!turn.ok) throw new Error(turn.error.message);
      const artifact = await registerNormalizedResponseArtifact({
        runtime,
        record: record.value,
        turn: turn.value,
        response: {
          requestId: record.value.llmRequestRefs[0]!,
          provider: "fake",
          model: "fake-model",
          contentBlocks: [],
          toolCallBlocks: [],
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 0
          },
          finishReason: "stop",
          providerMetadataSummary: {},
          source: record.value.source,
          audit: record.value.audit
        },
        streamEventCount: 0
      });
      expect(artifact.ok).toBe(true);
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

function failedEventStreamAdapter(): LLMProviderAdapter {
  return {
    ...fakeAdapter(),
    stream: async function* (context) {
      yield {
        requestId: context.request.requestId,
        type: "response_failed",
        errorClassification: {
          code: "timeout",
          message: "provider timed out",
          retryable: true,
          fallbackRecommended: false,
          contextCompressionRequired: false
        }
      };
    }
  };
}

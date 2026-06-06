import { describe, expect, test } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import {
  audit,
  createGrowAndAgenda,
  source,
  version
} from "../agenda-dod-manager/helpers.js";
import {
  allowAllPolicy,
  denyProviderPolicy,
  echoToolInput,
  fakeAdapter,
  makeAttemptFixture,
  textResponse,
  toolResponse
} from "./helpers.js";

describe("Grow Attempt Runner", () => {
  test("runs a file-native attempt with no tool calls and registers trace/outcome", async () => {
    await withWorkspace(async (workspace) => {
      const adapter = fakeAdapter([textResponse("candidate runtime contract")]);
      const fixture = makeAttemptFixture(workspace, adapter);
      const attempt = await createAttempt(fixture);
      const outcome = await fixture.runner.runAttempt(attempt, { policyContext: allowAllPolicy() });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error(outcome.error.message);
      expect(outcome.value.exitReason).toBe("completed_no_tool_calls");
      expect(outcome.value.candidateOutputRefs.length).toBeGreaterThan(0);
      expect(adapter.calls()).toBe(1);

      const record = await fixture.runner.readAttempt(attempt);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);
      expect(record.value.status).toBe("completed");
      expect(record.value.messageListRefs).toHaveLength(1);
      expect(record.value.checkpointRefs.length).toBeGreaterThanOrEqual(4);

      const trace = await fixture.runner.readAttemptTrace(attempt);
      expect(trace.ok).toBe(true);
      if (trace.ok) {
        expect(trace.value.messageListRefs).toHaveLength(1);
        expect(trace.value.exitReason).toBe("completed_no_tool_calls");
      }
    });
  });

  test("settles model tool calls through Tool Runtime before continuation compile", async () => {
    await withWorkspace(async (workspace) => {
      const adapter = fakeAdapter([toolResponse(), textResponse("tool-informed candidate")]);
      const fixture = makeAttemptFixture(workspace, adapter);
      const tool = await fixture.toolsRuntime.registerTool(echoToolInput(fixture));
      expect(tool.ok).toBe(true);
      const attempt = await createAttempt(fixture);
      const outcome = await fixture.runner.runAttempt(attempt, {
        policyContext: allowAllPolicy(),
        maxTurns: 2
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error(outcome.error.message);
      expect(outcome.value.exitReason).toBe("completed_after_tool_settlement");
      expect(outcome.value.toolSettlementRefs).toHaveLength(1);
      expect(adapter.calls()).toBe(2);

      const record = await fixture.runner.readAttempt(attempt);
      expect(record.ok).toBe(true);
      if (record.ok) {
        expect(record.value.messageListRefs).toHaveLength(2);
        expect(record.value.toolCallRefs).toHaveLength(1);
      }
    });
  });

  test("policy denial blocks provider call and records failed outcome", async () => {
    await withWorkspace(async (workspace) => {
      const adapter = fakeAdapter([textResponse("should not run")]);
      const fixture = makeAttemptFixture(workspace, adapter);
      const attempt = await createAttempt(fixture);
      const outcome = await fixture.runner.runAttempt(attempt, { policyContext: denyProviderPolicy() });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error(outcome.error.message);
      expect(outcome.value.exitReason).toBe("policy_blocked");
      expect(outcome.value.status).toBe("failed");
      expect(adapter.calls()).toBe(0);
    });
  });

  test("requires model selection before first execution plan", async () => {
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
      const attempt = await fixture.runner.createAttempt({
        growUnitRef: grow.value,
        attemptIntentRef: intent.value,
        source: source(fixture, "system"),
        version,
        audit: audit("create attempt")
      });
      expect(attempt.ok).toBe(true);
      if (!attempt.ok) throw new Error(attempt.error.message);
      const outcome = await fixture.runner.runAttempt(attempt.value, { policyContext: allowAllPolicy() });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error.code).toBe("invalid_input");
    });
  });

  test("cancel and explain preserve file-native recovery facts", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace);
      const attempt = await createAttempt(fixture);
      const cancelled = await fixture.runner.cancelAttempt(attempt, "user stopped the attempt");
      expect(cancelled.ok).toBe(true);
      if (!cancelled.ok) throw new Error(cancelled.error.message);
      expect(cancelled.value.status).toBe("cancelled");

      const explanation = await fixture.runner.explainAttempt(attempt);
      expect(explanation.ok).toBe(true);
      if (explanation.ok) {
        expect(explanation.value.summary).toContain("cancelled");
        expect(explanation.value.latestCheckpoint?.phase).toBe("final");
        expect(explanation.value.traceRef).toBeDefined();
      }
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

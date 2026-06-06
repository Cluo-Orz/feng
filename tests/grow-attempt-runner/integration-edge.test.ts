import { describe, expect, test } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import {
  artifactInput,
  audit,
  createGrowAndAgenda,
  receiveInput,
  source,
  version
} from "../agenda-dod-manager/helpers.js";
import {
  captureAttemptSnapshot,
  createAttemptRuntime,
  finalizeAttempt
} from "../../src/grow-attempt-runner/index.js";
import type {
  AttemptExitReason,
  GrowAttemptRunnerOptions
} from "../../src/grow-attempt-runner/index.js";
import type { LLMProviderAdapter } from "../../src/llm-gateway/index.js";
import {
  allowAllPolicy,
  echoToolInput,
  fakeAdapter,
  makeAttemptFixture
} from "./helpers.js";

describe("Grow Attempt Runner integration edge paths", () => {
  test("createAttempt options and snapshot capture preserve real grow inputs", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace);
      const runtime = createAttemptRuntime(runtimeOptions(fixture));
      const grow = await createGrowAndAgenda(fixture, "snapshot-agent");
      expect(grow.ok).toBe(true);
      if (!grow.ok) throw new Error(grow.error.message);

      const material = await fixture.artifacts.registerArtifact(
        artifactInput(fixture, "runtime contract source material")
      );
      expect(material.ok).toBe(true);
      if (!material.ok) throw new Error(material.error.message);
      const inbox = await fixture.admission.receiveUserInput(grow.value, receiveInput(fixture, "Use this input"));
      const feedback = await fixture.admission.createFeedbackUnit({
        growUnitRef: grow.value,
        originLayer: "external_runtime",
        targetLayer: "target_agent_project",
        summary: "debug cycle found a wrong action",
        attribution: "debug bridge",
        impact: "invalid command",
        suggestedAction: "tighten action contract",
        privacyClass: "workspace_private",
        source: source(fixture, "runtime"),
        audit: audit("feedback")
      });
      expect(inbox.ok && feedback.ok).toBe(true);
      if (!inbox.ok || !feedback.ok) throw new Error("admission setup failed");

      const item = await fixture.agenda.proposeAgendaItem(grow.value, {
        kind: "define_runtime_contract",
        summary: "Define runtime contract",
        reason: "attempt needs bounded output",
        inputRefs: [material.value, inbox.value],
        expectedOutput: "runtime contract",
        evidenceRequirementRefs: [material.value],
        source: source(fixture, "system"),
        audit: audit("item")
      });
      expect(item.ok).toBe(true);
      if (!item.ok) throw new Error(item.error.message);
      expect((await fixture.agenda.activateAgendaItem(item.value, {
        reason: "activate item",
        source: source(fixture, "system"),
        audit: audit("activate item")
      })).ok).toBe(true);
      const gap = await fixture.agenda.recordGap(grow.value, {
        kind: "missing_validation_environment",
        summary: "need trace runner",
        requiredInput: "trace runner",
        requiredEvidence: "trace report",
        blockingReason: "validation loop absent",
        relatedAdmissionRefs: [inbox.value],
        relatedFeedbackRefs: [feedback.value],
        source: source(fixture, "system"),
        audit: audit("gap")
      });
      expect(gap.ok).toBe(true);
      const dod = await fixture.agenda.defineDoD(grow.value, {
        statement: "Output is bounded",
        scope: "runtime command",
        evidenceRequirement: "trace report validates every command",
        validationIntent: "inspect debug trace",
        targetWorldSummaryRef: material.value,
        source: source(fixture, "system"),
        version,
        audit: audit("dod")
      });
      expect(dod.ok).toBe(true);
      const noCapTool = await fixture.toolsRuntime.registerTool({
        ...echoToolInput(fixture),
        name: "noop",
        namespace: "empty",
        declaredCapabilities: [],
        inputSchema: { type: "object", additionalProperties: false }
      });
      expect(noCapTool.ok).toBe(true);

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
        requiredCapabilities: { toolCalls: true },
        toolCatalogQuery: { namespace: "empty" },
        correlationId: "attempt-correlation",
        source: source(fixture, "system"),
        version,
        audit: audit("create attempt")
      });
      expect(attempt.ok).toBe(true);
      if (!attempt.ok) throw new Error(attempt.error.message);
      const record = await runtime.storage.readAttempt(attempt.value);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);
      expect(record.value.requiredCapabilitiesHint?.toolCalls).toBe(true);
      expect(record.value.toolCatalogQueryHint?.namespace).toBe("empty");
      expect(record.value.correlationId).toBe("attempt-correlation");

      const captured = await captureAttemptSnapshot(runtime, record.value, {
        policyContext: allowAllPolicy(),
        toolCatalogQuery: { namespace: "empty" }
      });
      expect(captured.ok).toBe(true);
      if (!captured.ok) throw new Error(captured.error.message);
      expect(captured.value.snapshot.artifactCandidateRefs.some((ref) => ref.id === material.value.id)).toBe(true);
      expect(captured.value.snapshot.activeDoDRefs.length).toBeGreaterThan(0);
      expect(captured.value.snapshot.openGapRefs.length).toBeGreaterThan(0);
      expect(captured.value.prepared.contextToolSurface[0]?.capabilitySummary).toBe("runtime.target_action");
      expect(captured.value.prepared.domainSourceRefs.some((ref) => ref.id === feedback.value.id)).toBe(true);
    });
  });

  test("stream aggregation handles reasoning and tool blocks when tools are disabled", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace, reasoningToolStreamAdapter());
      const attempt = await createAttempt(fixture);
      const outcome = await fixture.runner.runAttempt(attempt, {
        policyContext: allowAllPolicy(),
        streamingPreference: "preferred",
        toolUsePolicy: { mode: "disable_model_tool_calls" }
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error(outcome.error.message);
      expect(outcome.value.exitReason).toBe("completed_no_tool_calls");
      expect(outcome.value.providerReceiptRefs.length).toBeGreaterThan(0);
    });
  });

  test("direct finalization records terminal hints for each exit family", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeAttemptFixture(workspace);
      const runtime = createAttemptRuntime(runtimeOptions(fixture));
      const cases: readonly {
        readonly exitReason: AttemptExitReason;
        readonly status?: "completed" | "failed" | "interrupted";
        readonly hintIncludes?: string;
      }[] = [
        { exitReason: "completed_after_tool_settlement" },
        { exitReason: "context_compile_failed", status: "failed", hintIncludes: "Agenda DoD Manager" },
        { exitReason: "policy_blocked", status: "failed", hintIncludes: "Policy Boundary" },
        { exitReason: "tool_failed", status: "failed", hintIncludes: "Tool Runtime" },
        { exitReason: "max_tool_calls_reached", status: "failed", hintIncludes: "smaller attempt intent" },
        { exitReason: "interrupted_by_process", status: "interrupted" }
      ];
      for (const item of cases) {
        const attempt = await createAttempt(fixture);
        const record = await runtime.storage.readAttempt(attempt);
        expect(record.ok).toBe(true);
        if (!record.ok) throw new Error(record.error.message);
        const outcome = await finalizeAttempt({
          runtime,
          record: record.value,
          exitReason: item.exitReason,
          ...(item.status === undefined ? {} : { status: item.status })
        });
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) throw new Error(outcome.error.message);
        if (item.hintIncludes !== undefined) {
          expect(outcome.value.nextModuleHints.join(" ")).toContain(item.hintIncludes);
        }
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

function reasoningToolStreamAdapter(): LLMProviderAdapter {
  return {
    ...fakeAdapter(),
    stream: async function* (context) {
      yield streamEvent(context.request.requestId, { type: "reasoning_delta", text: "reasoned" });
      yield streamEvent(context.request.requestId, {
        type: "tool_call_completed",
        toolCall: {
          type: "tool_call",
          callId: "stream-call",
          name: "test.echo",
          argumentsText: JSON.stringify({ prompt: "from stream" }),
          arguments: { prompt: "from stream" }
        }
      });
      yield streamEvent(context.request.requestId, {
        type: "response_completed",
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          reasoningTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 3
        },
        finishReason: "tool_calls"
      });
    }
  };
}

function streamEvent(requestId: string, event: Record<string, unknown>) {
  return { requestId, ...event };
}

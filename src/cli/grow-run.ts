import type { Result } from "../domain/result.js";
import { ok } from "../domain/result.js";
import type { PolicyContext } from "../policy-boundary/index.js";
import { cliErr } from "./errors.js";
import { cliAudit, cliSource, cliVersion, type CLIRuntime } from "./runtime.js";
import { growRef, refView, success } from "./support.js";
import type { CLIExecutionContext, CLIHandlerResult } from "./types.js";

function preapprovedScope(): PolicyContext {
  return {
    caller: "cli-grow-run",
    environment: {
      hostSandboxAvailable: false,
      networkAvailable: true,
      externalEnforcementAvailable: false,
      secretStoreAvailable: false
    },
    rules: [{ capability: "*", resource: "*", verdict: "allow" }]
  };
}

function isPreapproved(ctx: CLIExecutionContext): boolean {
  return ctx.intent.approvalMode === "preapproved_scope" || ctx.intent.flags["allow"] === "true";
}

export async function runGrowAttempt(
  runtime: CLIRuntime,
  ctx: CLIExecutionContext,
  growId: string
): Promise<Result<CLIHandlerResult>> {
  const model = runtime.defaultModelSelection;
  if (!isPreapproved(ctx)) {
    return ok({
      exitStatus: "waiting_approval",
      headline: "grow run is an LLM-driven action and needs approval",
      facts: ["re-run with --allow or --approval preapproved_scope to authorize provider calls"],
      refs: [],
      warnings: [],
      nextActions: [{
        kind: "request_approval",
        summary: "approve the LLM-driven grow attempt",
        command: `feng grow run --grow ${growId} --allow`
      }]
    });
  }
  if (model === undefined) {
    return cliErr({ code: "invalid_state", message: "no model configured; grow run needs a provider model" });
  }

  const ref = growRef(growId);
  const source = cliSource(runtime, ctx.workspace.id);
  const audit = cliAudit(runtime, "cli grow run");
  const record = await runtime.ports.growUnitManager.getGrowUnit(ref);
  if (!record.ok) return record;

  const agenda = await runtime.ports.agendaManager.getAgenda(ref);
  if (!agenda.ok) {
    if (agenda.error.code !== "not_found") return agenda;
    const created = await runtime.ports.agendaManager.createAgenda(ref, {
      goalBoundarySummary: record.value.goalBoundarySummary,
      currentFocus: "run a grow attempt toward the goal",
      source,
      version: cliVersion,
      audit
    });
    if (!created.ok) return created;
  }

  const intent = await runtime.ports.agendaManager.buildAttemptIntent(ref, {
    purpose: record.value.goalBoundarySummary,
    source,
    audit
  });
  if (!intent.ok) return intent;

  const attempt = await runtime.ports.attemptRunner.createAttempt({
    growUnitRef: ref,
    attemptIntentRef: intent.value,
    modelSelection: model,
    source,
    version: cliVersion,
    audit
  });
  if (!attempt.ok) return attempt;

  const maxTurnsRaw = Number.parseInt(ctx.intent.flags["max-turns"] ?? "1", 10);
  const maxTurns = Number.isFinite(maxTurnsRaw) && maxTurnsRaw > 0 ? maxTurnsRaw : 1;
  const outcome = await runtime.ports.attemptRunner.runAttempt(attempt.value, {
    policyContext: preapprovedScope(),
    maxTurns
  });
  if (!outcome.ok) return outcome;

  return ok(success(`grow attempt ${outcome.value.exitReason}`, {
    facts: [
      `candidate outputs: ${outcome.value.candidateOutputRefs.length}`,
      `completed turns: ${outcome.value.completedTurnCount}`,
      `evidence candidates: ${outcome.value.evidenceCandidateRefs.length}`
    ],
    refs: [refView("attempt", attempt.value), refView("attempt_outcome", outcome.value.outcomeSummaryRef)],
    warnings: outcome.value.observedIssueSummaries,
    data: {
      exitReason: outcome.value.exitReason,
      candidateOutputRefs: outcome.value.candidateOutputRefs,
      nextModuleHints: outcome.value.nextModuleHints
    }
  }));
}

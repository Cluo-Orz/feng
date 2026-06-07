import type { DomainError } from "../domain/index.js";
import type { Result } from "../domain/result.js";
import { ok } from "../domain/result.js";
import { cliStream } from "./events.js";
import { cliEventTypes } from "./events.js";
import { mapErrorToExitStatus } from "./exit.js";
import {
  feedbackHandler,
  explainHandler,
  growHandler,
  inputHandler,
  statusHandler,
  workspaceHandler
} from "./handlers-core.js";
import {
  artifactHandler,
  attemptHandler,
  debugHandler,
  hatchHandler,
  policyHandler,
  readinessHandler,
  runtimeHandler,
  skillHandler
} from "./handlers-runtime.js";
import { cliAudit, cliSource, type CLIRuntime } from "./runtime.js";
import { CLIStorage } from "./storage.js";
import type { CLIExecutionContext, CLICommandFamily, CLIHandlerResult, CLIInvocationReceipt } from "./types.js";

type Handler = (runtime: CLIRuntime, ctx: CLIExecutionContext) => Promise<Result<CLIHandlerResult>>;

const handlers: Record<CLICommandFamily, Handler> = {
  workspace: workspaceHandler,
  grow: growHandler,
  input: inputHandler,
  status: statusHandler,
  explain: explainHandler,
  attempt: attemptHandler,
  readiness: readinessHandler,
  hatch: hatchHandler,
  runtime: runtimeHandler,
  debug: debugHandler,
  feedback: feedbackHandler,
  policy: policyHandler,
  artifact: artifactHandler,
  skill: skillHandler
};

export function errorToResult(error: DomainError): CLIHandlerResult {
  return {
    exitStatus: mapErrorToExitStatus(error),
    headline: error.message,
    facts: [`code: ${error.code}`],
    refs: [],
    warnings: [],
    nextActions: []
  };
}

export async function dispatchCommand(runtime: CLIRuntime, ctx: CLIExecutionContext): Promise<CLIHandlerResult> {
  const handler = handlers[ctx.intent.family];
  const result = await handler(runtime, ctx);
  return result.ok ? result.value : errorToResult(result.error);
}

export async function persistInvocation(
  runtime: CLIRuntime,
  ctx: CLIExecutionContext,
  result: CLIHandlerResult
): Promise<Result<CLIInvocationReceipt>> {
  const storage = new CLIStorage(runtime.ports.store, ctx.workspace);
  const receipt: CLIInvocationReceipt = {
    invocationId: ctx.invocationId,
    family: ctx.intent.family,
    action: ctx.intent.action,
    exitStatus: result.exitStatus,
    requestedMode: ctx.intent.requestedMode,
    approvalMode: ctx.intent.approvalMode,
    displayMode: ctx.intent.displayMode,
    workspace: ctx.workspace.id,
    headline: result.headline,
    warnings: result.warnings,
    refs: result.refs,
    startedAt: ctx.startedAt,
    finishedAt: runtime.now(),
    recordVersion: 1,
    source: cliSource(runtime, ctx.workspace.id),
    audit: cliAudit(runtime, `cli ${ctx.intent.family} ${ctx.intent.action}`)
  };
  const written = await storage.writeReceipt(receipt, "persist cli invocation receipt");
  if (!written.ok) return written;
  const indexed = await storage.addInvocation(ctx.invocationId);
  if (!indexed.ok) return indexed;
  const appended = await runtime.ports.ledger.appendEvent(cliStream(ctx.workspace.id), {
    eventType: cliEventTypes.invocationCompleted,
    eventVersion: "1",
    payload: {
      invocationId: ctx.invocationId,
      family: ctx.intent.family,
      action: ctx.intent.action,
      exitStatus: result.exitStatus
    },
    source: cliSource(runtime, ctx.workspace.id),
    audit: cliAudit(runtime, "record cli invocation event"),
    producer: runtime.producer
  });
  if (!appended.ok) return appended;
  return ok(receipt);
}

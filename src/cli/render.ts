import { exitCodeForStatus } from "./exit.js";
import type { CLIInvocationId } from "./brand.js";
import type {
  CLICommandIntent,
  CLIExitStatus,
  CLIHandlerResult,
  CLIOutputEnvelope,
  CLIRefView
} from "./types.js";

const blockedStatuses: ReadonlySet<CLIExitStatus> = new Set(["blocked_by_policy", "blocked_by_privacy"]);

function isBlocked(status: CLIExitStatus): boolean {
  return blockedStatuses.has(status);
}

function renderHuman(result: CLIHandlerResult, refs: readonly CLIRefView[], verbose: boolean): string {
  const lines = [`[${result.exitStatus}] ${result.headline}`];
  for (const fact of result.facts) lines.push(`  - ${fact}`);
  for (const warning of result.warnings) lines.push(`  ! ${warning}`);
  if (verbose) {
    for (const ref of refs) lines.push(`  ref ${ref.label}: ${ref.uri ?? ref.ref}`);
  }
  for (const action of result.nextActions) {
    lines.push(`  next (${action.kind}): ${action.summary}${action.command ? ` -> ${action.command}` : ""}`);
  }
  return lines.join("\n");
}

function renderRefs(refs: readonly CLIRefView[]): string {
  if (refs.length === 0) return "(no file-native refs)";
  return refs.map((ref) => `${ref.label}\t${ref.uri ?? ref.ref}`).join("\n");
}

export function renderEnvelope(
  invocationId: CLIInvocationId,
  intent: CLICommandIntent,
  result: CLIHandlerResult
): CLIOutputEnvelope {
  const blocked = isBlocked(result.exitStatus);
  const refs = blocked ? [] : result.refs;
  const data = blocked || result.data === undefined ? undefined : result.data;
  const machine = intent.displayMode === "json" || intent.requestedMode === "machine_readable";
  const safeBody = {
    invocationId,
    family: intent.family,
    action: intent.action,
    exitStatus: result.exitStatus,
    headline: result.headline,
    facts: blocked ? [] : result.facts,
    refs,
    warnings: result.warnings,
    nextActions: result.nextActions,
    ...(data === undefined ? {} : { data })
  };

  let rendered: string;
  if (intent.displayMode === "quiet") {
    rendered = `${result.exitStatus}`;
  } else if (machine) {
    rendered = JSON.stringify(safeBody, null, 2);
  } else if (intent.displayMode === "source_refs") {
    rendered = renderRefs(refs);
  } else {
    rendered = renderHuman({ ...result, refs, facts: safeBody.facts }, refs, intent.displayMode === "verbose");
  }

  return {
    invocationId,
    family: intent.family,
    action: intent.action,
    exitStatus: result.exitStatus,
    displayMode: intent.displayMode,
    headline: result.headline,
    facts: safeBody.facts,
    refs,
    warnings: result.warnings,
    nextActions: result.nextActions,
    ...(data === undefined ? {} : { data }),
    rendered,
    exitCode: exitCodeForStatus(result.exitStatus)
  };
}

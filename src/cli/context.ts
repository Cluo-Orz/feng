import type { Result } from "../domain/result.js";
import { ok } from "../domain/result.js";
import { makeCLIInvocationId } from "./brand.js";
import { cliErr } from "./errors.js";
import type { CLIRuntime } from "./runtime.js";
import type { CLICommandIntent, CLIExecutionContext } from "./types.js";

export async function buildExecutionContext(
  runtime: CLIRuntime,
  intent: CLICommandIntent
): Promise<Result<CLIExecutionContext>> {
  if (intent.workspaceRoot.trim().length === 0) {
    return cliErr({ code: "invalid_input", message: "workspace root is required", severity: "warning" });
  }
  const opened = await runtime.ports.store.openWorkspace({ root: intent.workspaceRoot });
  if (!opened.ok) return opened;
  return ok({
    invocationId: makeCLIInvocationId(`cli-invocation-${runtime.newId()}`),
    intent,
    workspace: opened.value,
    startedAt: runtime.now()
  });
}

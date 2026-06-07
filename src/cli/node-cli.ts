import type { Result } from "../domain/result.js";
import { ok } from "../domain/result.js";
import { makeCLIInvocationId, type CLIInvocationId } from "./brand.js";
import { buildExecutionContext } from "./context.js";
import { dispatchCommand, errorToResult, persistInvocation } from "./dispatch.js";
import { parseArgv } from "./parse.js";
import { renderEnvelope } from "./render.js";
import { createCLIRuntime, type CLIRuntime } from "./runtime.js";
import { CLIStorage } from "./storage.js";
import type { FengCliOptions } from "./ports.js";
import type {
  CLICommandIntent,
  CLIHandlerResult,
  CLIInvocationReceipt,
  CLIOutputEnvelope,
  FengCli
} from "./types.js";

export class NodeFengCli implements FengCli {
  private readonly runtime: CLIRuntime;
  private readonly defaultRoot: string;

  constructor(options: FengCliOptions, defaultRoot: string) {
    this.runtime = createCLIRuntime(options);
    this.defaultRoot = defaultRoot;
  }

  async run(argv: readonly string[]): Promise<Result<CLIOutputEnvelope>> {
    const parsed = parseArgv(argv, this.defaultRoot);
    if (!parsed.ok) return ok(this.detachedEnvelope(argv, errorToResult(parsed.error)));
    const intent = parsed.value;
    const context = await buildExecutionContext(this.runtime, intent);
    if (!context.ok) return ok(this.detachedEnvelope(argv, errorToResult(context.error), intent));
    const result = await dispatchCommand(this.runtime, context.value);
    const persisted = await persistInvocation(this.runtime, context.value, result);
    if (!persisted.ok) return persisted;
    return ok(renderEnvelope(context.value.invocationId, intent, result));
  }

  async getInvocationReceipt(id: CLIInvocationId): Promise<Result<CLIInvocationReceipt>> {
    const opened = await this.runtime.ports.store.openWorkspace({ root: this.defaultRoot });
    if (!opened.ok) return opened;
    return new CLIStorage(this.runtime.ports.store, opened.value).readReceipt(id);
  }

  async listInvocations(): Promise<Result<readonly CLIInvocationReceipt[]>> {
    const opened = await this.runtime.ports.store.openWorkspace({ root: this.defaultRoot });
    if (!opened.ok) return opened;
    return new CLIStorage(this.runtime.ports.store, opened.value).listReceipts();
  }

  private detachedEnvelope(
    argv: readonly string[],
    result: CLIHandlerResult,
    intent?: CLICommandIntent
  ): CLIOutputEnvelope {
    const resolved: CLICommandIntent = intent ?? {
      raw: argv,
      family: "workspace",
      action: "default",
      positionals: [],
      flags: {},
      requestedMode: "normal",
      approvalMode: "ask",
      displayMode: "human_summary",
      workspaceRoot: this.defaultRoot
    };
    return renderEnvelope(makeCLIInvocationId(`cli-invocation-${this.runtime.newId()}`), resolved, result);
  }
}

export function createFengCli(options: FengCliOptions, defaultRoot: string): FengCli {
  return new NodeFengCli(options, defaultRoot);
}

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadFengConfig } from "./config.js";
import { createFengHost } from "./runtime-host.js";
import { runAuthorFeedback, runGrow, runGrowAgent, runInstallRuntime, runResolveSystemFeedback, runReviewWorkGate, runRouteFeedback, runRun, runSupervise, runWrite } from "./host-commands.js";
import type { FetchLike } from "../providers/index.js";

export interface RunCliInput {
  readonly argv: readonly string[];
  readonly workspaceRoot: string;
  readonly envFilePath?: string;
  readonly processEnv?: Record<string, string | undefined>;
  readonly fetchImpl?: FetchLike;
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
}

const hostCommands = new Set(["write", "supervise", "grow-agent", "install-runtime", "run", "route-feedback", "resolve-system-feedback", "review-work-gate", "author-feedback"]);

function isHighLevelGrow(argv: readonly string[]): boolean {
  if (argv[0] !== "grow") return false;
  const action = argv[1];
  return action === undefined || action.startsWith("--");
}

export async function runCli(input: RunCliInput): Promise<number> {
  const stdout = input.stdout ?? ((text) => process.stdout.write(`${text}\n`));
  const stderr = input.stderr ?? ((text) => process.stderr.write(`${text}\n`));
  let config;
  try {
    config = await loadFengConfig({
      workspaceRoot: input.workspaceRoot,
      ...(input.envFilePath === undefined ? {} : { envFilePath: input.envFilePath }),
      ...(input.processEnv === undefined ? {} : { processEnv: input.processEnv })
    });
  } catch (error) {
    stderr(`feng config error: ${(error as Error).message}`);
    return 78;
  }
  const host = await createFengHost({
    config,
    ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl })
  });
  const command = input.argv[0];
  if (isHighLevelGrow(input.argv)) return runGrow(host, input.argv, stdout, stderr);
  if (command !== undefined && hostCommands.has(command)) {
    if (command === "write") return runWrite(host, input.argv, stdout, stderr);
    if (command === "supervise") return runSupervise(host, input.argv, stdout, stderr);
    if (command === "grow-agent") return runGrowAgent(host, input.argv, stdout, stderr);
    if (command === "install-runtime") return runInstallRuntime(host, input.argv, stdout, stderr, input.fetchImpl);
    if (command === "route-feedback") return runRouteFeedback(host, input.argv, stdout, stderr, input.fetchImpl);
    if (command === "resolve-system-feedback") return runResolveSystemFeedback(host, input.argv, stdout, stderr);
    if (command === "review-work-gate") return runReviewWorkGate(host, input.argv, stdout, stderr);
    if (command === "author-feedback") return runAuthorFeedback(host, input.argv, stdout, stderr);
    return runRun(host, input.argv, stdout, stderr);
  }
  const result = await host.cli.run(input.argv);
  if (!result.ok) {
    stderr(`feng error [${result.error.code}]: ${result.error.message}`);
    return 1;
  }
  stdout(result.value.rendered);
  return result.value.exitCode;
}

function defaultEnvFilePath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..", ".env");
}

export async function main(argv: readonly string[]): Promise<number> {
  const wsIndex = argv.indexOf("--workspace");
  const rootIndex = argv.indexOf("--root");
  const explicit = wsIndex !== -1 ? argv[wsIndex + 1] : rootIndex !== -1 ? argv[rootIndex + 1] : undefined;
  const workspaceRoot = explicit ?? process.cwd();
  const envFromFlag = ((): string | undefined => {
    const i = argv.indexOf("--env-file");
    return i !== -1 ? argv[i + 1] : undefined;
  })();
  return runCli({
    argv,
    workspaceRoot,
    envFilePath: envFromFlag ?? process.env.FENG_ENV_FILE ?? defaultEnvFilePath(),
    processEnv: process.env
  });
}

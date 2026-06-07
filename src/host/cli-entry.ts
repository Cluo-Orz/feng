import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadFengConfig } from "./config.js";
import { createFengHost, type FengHost } from "./runtime-host.js";
import { writeNovel } from "./xiaoshuo-writer.js";
import { superviseNovel } from "./supervisor.js";
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

function flagValue(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
}

async function runWrite(
  host: FengHost,
  argv: readonly string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void
): Promise<number> {
  const premise = flagValue(argv, "--premise");
  const title = flagValue(argv, "--title");
  const chaptersRaw = flagValue(argv, "--chapters");
  const chapters = chaptersRaw === undefined ? 1 : Math.max(1, Number.parseInt(chaptersRaw, 10) || 1);
  const result = await writeNovel(host, {
    chapters,
    ...(premise === undefined ? {} : { premise }),
    ...(title === undefined ? {} : { title })
  });
  if (!result.ok) {
    stderr(`feng write error [${result.error.code}]: ${result.error.message}`);
    return 1;
  }
  for (const chapter of result.value) {
    stdout(`[chapter ${chapter.chapterNumber}] ${chapter.chars} chars -> ${chapter.path} (${chapter.finishReason})`);
    stdout(`  outline: ${chapter.outline}`);
  }
  return 0;
}

async function runSupervise(
  host: FengHost,
  argv: readonly string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void
): Promise<number> {
  const target = flagValue(argv, "--target");
  if (target === undefined) {
    stderr("feng supervise error: --target <dir> is required");
    return 2;
  }
  const minRaw = flagValue(argv, "--min-chars");
  const result = await superviseNovel(host, {
    targetRoot: target,
    ...(minRaw === undefined ? {} : { minChars: Math.max(1, Number.parseInt(minRaw, 10) || 800) })
  });
  if (!result.ok) {
    stderr(`feng supervise error [${result.error.code}]: ${result.error.message}`);
    return 1;
  }
  const report = result.value;
  stdout(`[supervise] target=${report.targetRoot} chapters=${report.chaptersFound} issues=${report.issues.length} feedbackCandidates=${report.feedbackCandidateCount}`);
  for (const issue of report.issues) {
    stdout(`  - (${issue.kind}${issue.chapter === undefined ? "" : ` ch${issue.chapter}`}) ${issue.detail}`);
  }
  return report.issues.length === 0 ? 0 : 0;
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
  if (input.argv[0] === "write") {
    return runWrite(host, input.argv, stdout, stderr);
  }
  if (input.argv[0] === "supervise") {
    return runSupervise(host, input.argv, stdout, stderr);
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

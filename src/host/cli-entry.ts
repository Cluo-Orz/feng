import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadFengConfig } from "./config.js";
import { createFengHost } from "./runtime-host.js";

export interface RunCliInput {
  readonly argv: readonly string[];
  readonly workspaceRoot: string;
  readonly envFilePath?: string;
  readonly processEnv?: Record<string, string | undefined>;
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
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
  const host = await createFengHost({ config });
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

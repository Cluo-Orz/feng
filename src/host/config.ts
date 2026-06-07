import { readFile } from "node:fs/promises";

export interface FengProviderConfig {
  readonly provider: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly maxTokens: number;
  readonly reasoningModel: boolean;
}

export interface FengConfig {
  readonly workspaceRoot: string;
  readonly provider: FengProviderConfig;
}

export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key.length > 0) out[key] = value;
  }
  return out;
}

export async function loadEnvFile(path: string): Promise<Record<string, string>> {
  try {
    return parseEnvText(await readFile(path, "utf8"));
  } catch {
    return {};
  }
}

export function resolveProviderConfig(
  env: Record<string, string | undefined>
): FengProviderConfig {
  const apiKey = env.DEEPSEEK_API_KEY ?? env.OPENAI_API_KEY ?? env.LLM_API_KEY ?? "";
  if (apiKey.length === 0) {
    throw new Error("missing provider api key (DEEPSEEK_API_KEY / OPENAI_API_KEY / LLM_API_KEY)");
  }
  const baseUrl = env.OPEN_AI_BASE_URL ?? env.OPENAI_BASE_URL ?? env.LLM_BASE_URL ?? "https://api.deepseek.com";
  const model = env.MODEL ?? env.LLM_MODEL ?? "deepseek-chat";
  const provider = env.LLM_PROVIDER ?? inferProvider(baseUrl);
  const maxTokensRaw = env.MAX_TOKENS ?? env.LLM_MAX_TOKENS;
  const maxTokens = maxTokensRaw === undefined ? 4096 : Number.parseInt(maxTokensRaw, 10);
  const reasoningModel = (env.REASONING_MODEL ?? "true").toLowerCase() !== "false";
  return {
    provider,
    apiKey,
    baseUrl,
    model,
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 4096,
    reasoningModel
  };
}

function inferProvider(baseUrl: string): string {
  if (baseUrl.includes("deepseek")) return "deepseek";
  if (baseUrl.includes("openai")) return "openai";
  if (baseUrl.includes("moonshot")) return "moonshot";
  return "openai_compatible";
}

export async function loadFengConfig(input: {
  readonly workspaceRoot: string;
  readonly envFilePath?: string;
  readonly processEnv?: Record<string, string | undefined>;
}): Promise<FengConfig> {
  const fileEnv = input.envFilePath === undefined ? {} : await loadEnvFile(input.envFilePath);
  const merged: Record<string, string | undefined> = { ...fileEnv, ...(input.processEnv ?? {}) };
  return {
    workspaceRoot: input.workspaceRoot,
    provider: resolveProviderConfig(merged)
  };
}

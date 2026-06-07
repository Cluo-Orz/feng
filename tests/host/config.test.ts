import { describe, expect, it } from "vitest";
import {
  parseEnvText,
  resolveProviderConfig,
  loadFengConfig
} from "../../src/host/index.js";

describe("host config", () => {
  it("parses env text, ignoring comments and quotes", () => {
    const env = parseEnvText("# comment\nA=1\nB=\"two\"\nC='three'\n\nBAD_LINE\nD=has=equals");
    expect(env.A).toBe("1");
    expect(env.B).toBe("two");
    expect(env.C).toBe("three");
    expect(env.D).toBe("has=equals");
    expect(env.BAD_LINE).toBeUndefined();
  });

  it("resolves deepseek config from env and infers provider", () => {
    const config = resolveProviderConfig({
      DEEPSEEK_API_KEY: "k",
      MODEL: "deepseek-v4-pro",
      OPEN_AI_BASE_URL: "https://api.deepseek.com"
    });
    expect(config.provider).toBe("deepseek");
    expect(config.model).toBe("deepseek-v4-pro");
    expect(config.maxTokens).toBe(4096);
    expect(config.reasoningModel).toBe(true);
  });

  it("supports openai/alternate keys, explicit provider and max tokens", () => {
    expect(resolveProviderConfig({ OPENAI_API_KEY: "k", OPENAI_BASE_URL: "https://api.openai.com" }).provider).toBe("openai");
    expect(resolveProviderConfig({ LLM_API_KEY: "k", LLM_BASE_URL: "https://x.moonshot.cn" }).provider).toBe("moonshot");
    expect(resolveProviderConfig({ LLM_API_KEY: "k", LLM_BASE_URL: "https://x.example.com" }).provider).toBe("openai_compatible");
    const explicit = resolveProviderConfig({ DEEPSEEK_API_KEY: "k", LLM_PROVIDER: "custom", MAX_TOKENS: "200", REASONING_MODEL: "false" });
    expect(explicit.provider).toBe("custom");
    expect(explicit.maxTokens).toBe(200);
    expect(explicit.reasoningModel).toBe(false);
  });

  it("falls back to a positive default when max tokens is invalid", () => {
    expect(resolveProviderConfig({ DEEPSEEK_API_KEY: "k", MAX_TOKENS: "-5" }).maxTokens).toBe(4096);
    expect(resolveProviderConfig({ DEEPSEEK_API_KEY: "k", MAX_TOKENS: "notnum" }).maxTokens).toBe(4096);
  });

  it("throws when no api key is present", () => {
    expect(() => resolveProviderConfig({})).toThrow(/api key/);
  });

  it("loads config from process env without an env file", async () => {
    const config = await loadFengConfig({ workspaceRoot: "/tmp/ws", processEnv: { DEEPSEEK_API_KEY: "k", MODEL: "m" } });
    expect(config.workspaceRoot).toBe("/tmp/ws");
    expect(config.provider.model).toBe("m");
  });

  it("returns empty env for a missing env file path", async () => {
    const config = await loadFengConfig({
      workspaceRoot: "/tmp/ws",
      envFilePath: "F:\\definitely-missing-feng.env",
      processEnv: { DEEPSEEK_API_KEY: "k" }
    });
    expect(config.provider.apiKey).toBe("k");
  });
});

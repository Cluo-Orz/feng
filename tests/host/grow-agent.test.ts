import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFengHost, growXiaoshuoAgent, grownLengthRule } from "../../src/host/index.js";
import { PACKAGE_PATH } from "../../src/runtime-package/index.js";
import type { FetchLike } from "../../src/providers/index.js";

const provider = { provider: "deepseek", apiKey: "k", baseUrl: "https://api.deepseek.com", model: "m", maxTokens: 256, reasoningModel: true };

function designFetch(content: string): FetchLike {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: "d", model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 50, total_tokens: 60 } }),
    text: async () => ""
  });
}

async function withRoot(body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "feng-growagent-"));
  try {
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const STRATEGY_JSON = JSON.stringify({
  systemPrompt: "你是连载小说写作 agent，保持设定、人物、年份、地点连贯，每章输出正文与 ===OUTLINE===。",
  stylePrinciples: ["有画面感", "有对话"],
  constraints: ["每章字数达标", "章节编号连续"],
  minChars: 1500,
  maxChars: 2800
});

describe("growXiaoshuoAgent", () => {
  it("clamps the grown length contract to sane bounds", () => {
    expect(grownLengthRule(1500, 2800)).toEqual({ minChars: 1500, maxChars: 2800 });
    expect(grownLengthRule(undefined, undefined)).toEqual({ minChars: 900, maxChars: 1500 });
    expect(grownLengthRule(50, 50)).toEqual({ minChars: 300, maxChars: 600 });
    expect(grownLengthRule(99999, 99999)).toEqual({ minChars: 4000, maxChars: 8000 });
  });

  it("grows a real grow unit and hatches a file-native package with grown strategy", async () => {
    await withRoot(async (root) => {
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: designFetch(STRATEGY_JSON) });
      const result = await growXiaoshuoAgent(host, { goal: "成长出一个连贯的连载小说写作 agent" });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.strategyChars).toBeGreaterThan(0);
      expect(result.value.lifecycle).toBe("ready_to_hatch");

      const pkgText = await readFile(path.join(root, PACKAGE_PATH), "utf8");
      const pkg = JSON.parse(pkgText);
      expect(pkg.kind).toBe("serialized_authoring_agent");
      expect(pkg.locked).toBe(true);
      expect(pkg.writingStrategy.systemPrompt).toContain("写作 agent");
      expect(pkg.writingStrategy.stylePrinciples.length).toBeGreaterThan(0);
      expect(pkg.qualityRules.length).toBeGreaterThan(0);
      expect(pkg.feedbackRouting.length).toBeGreaterThan(0);
      expect(pkg.validation.grownByGrowUnitId).toBe(result.value.growUnitId);

      // the length DoD is owned by the grown agent, not a hardcoded feng default
      const lengthRule = pkg.qualityRules.find((r: { kind: string }) => r.kind === "length");
      expect(lengthRule.minChars).toBe(1500);
      expect(lengthRule.maxChars).toBe(2800);

      // grow unit really exists and advanced beyond a bare intake record
      const grow = await host.grow.getGrowUnit({ kind: "grow_unit", id: result.value.growUnitId } as never);
      expect(grow.ok).toBe(true);
    });
  });

  it("falls back to a default strategy when the model returns non-JSON", async () => {
    await withRoot(async (root) => {
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: designFetch("抱歉我无法输出 JSON") });
      const result = await growXiaoshuoAgent(host, { goal: "写小说 agent" });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.writingStrategy.systemPrompt.length).toBeGreaterThan(0);
    });
  });

  it("parses a fenced JSON code block", async () => {
    await withRoot(async (root) => {
      const fenced = "```json\n" + STRATEGY_JSON + "\n```";
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: designFetch(fenced) });
      const result = await growXiaoshuoAgent(host, { goal: "写小说 agent", name: "xiaoshuo", version: "2.0.0" });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.version).toBe("2.0.0");
      expect(pkg.writingStrategy.stylePrinciples).toContain("有对话");
    });
  });
});

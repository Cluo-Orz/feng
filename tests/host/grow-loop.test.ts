import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFengHost, growXiaoshuoAgentLoop } from "../../src/host/index.js";
import { PACKAGE_PATH } from "../../src/runtime-package/index.js";
import type { FetchLike } from "../../src/providers/index.js";

const provider = { provider: "deepseek", apiKey: "k", baseUrl: "https://api.deepseek.com", model: "m", maxTokens: 256, reasoningModel: true };

const STRATEGY = JSON.stringify({
  systemPrompt: "你是连载小说写作 agent，保持连贯。",
  stylePrinciples: ["生动"],
  constraints: ["章节连续"],
  minChars: 800,
  maxChars: 4000
});

const body = (chars: number) => "正文".repeat(chars);

// Round 1 (calls 2-3): chapter 2's opening does NOT mention 林越 -> capability
// issue (character_continuation). Round 2 (calls 4-5): openings DO mention 林越
// -> no capability issue. The design call is call 1.
function loopFetch(): FetchLike {
  let n = 0;
  return async () => {
    n += 1;
    let content: string;
    if (n === 1) content = STRATEGY;
    else if (n === 2) content = `林越捡到徽章。${body(500)}\n===OUTLINE===\n第1章`;
    else if (n === 3) content = `一个全新的陌生人登场了。${body(500)}\n===OUTLINE===\n第2章`;
    else content = `林越继续行动。${body(500)}\n===OUTLINE===\n续章`;
    return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
  };
}

async function withRoot(b: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "feng-loop-"));
  try {
    await b(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("growXiaoshuoAgentLoop", () => {
  it("runs multiple rounds, revises after a capability failure, and improves", async () => {
    await withRoot(async (root) => {
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: loopFetch() });
      const result = await growXiaoshuoAgentLoop(host, { goal: "成长出连贯小说 agent", maxRounds: 2, sampleChapters: 2 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);

      // round 1 found a capability issue; round 2 added a constraint and cleared it
      expect(result.value.rounds.length).toBe(2);
      expect(result.value.rounds[0]?.capabilityIssueKinds).toContain("character_continuation");
      expect(result.value.rounds[0]?.addedConstraints.length).toBeGreaterThan(0);
      expect(result.value.rounds[1]?.capabilityIssueKinds.length).toBe(0);
      expect(result.value.improved).toBe(true);
      expect(result.value.finalCapabilityIssues).toBe(0);

      // file-native round evidence exists
      const r1 = JSON.parse(await readFile(path.join(root, ".feng", "grow-samples", "round-1", "round-report.json"), "utf8"));
      expect(r1.capabilityIssueKinds).toContain("character_continuation");

      // final package is locked and ready, and carries the revised constraint
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.locked).toBe(true);
      expect(pkg.validation.readiness).toBe("ready");
      expect(pkg.writingStrategy.constraints.some((c: string) => c.includes("人物承接"))).toBe(true);
      expect(pkg.storyModel.trackedFacts.length).toBeGreaterThan(0);
    });
  });

  it("stays draft (unlocked) when capability issues persist across all rounds", async () => {
    await withRoot(async (root) => {
      // every chapter opening lacks 林越 -> capability issue never clears
      let n = 0;
      const persistent: FetchLike = async () => {
        n += 1;
        const content = n === 1 ? STRATEGY : `陌生人登场。${body(500)}\n===OUTLINE===\n章`;
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: persistent });
      const result = await growXiaoshuoAgentLoop(host, { goal: "g", maxRounds: 2, sampleChapters: 2 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.finalCapabilityIssues).toBeGreaterThan(0);
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.locked).toBe(false);
      expect(pkg.validation.readiness).toBe("draft");
    });
  });

  it("locks on the first round when the sample run has no capability issues", async () => {
    await withRoot(async (root) => {
      let n = 0;
      const cleanFetch: FetchLike = async () => {
        n += 1;
        const content = n === 1
          ? JSON.stringify({ systemPrompt: "你是写作 agent。", stylePrinciples: [], constraints: [] })
          : `林越登场。${"正文".repeat(500)}\n===OUTLINE===\n章`;
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: cleanFetch });
      const result = await growXiaoshuoAgentLoop(host, { goal: "g", maxRounds: 3, sampleChapters: 2 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.rounds.length).toBe(1);
      expect(result.value.improved).toBe(true);
      expect(result.value.finalCapabilityIssues).toBe(0);
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      expect(pkg.locked).toBe(true);
      expect(pkg.validation.readiness).toBe("ready");
    });
  });

  it("calibrates its length contract upward when sample chapters overflow", async () => {
    await withRoot(async (root) => {
      let n = 0;
      // agent declares a tight max (900) but the model writes ~2000 chars;
      // the loop should widen maxChars from sample evidence
      const overflowFetch: FetchLike = async () => {
        n += 1;
        const content = n === 1
          ? JSON.stringify({ systemPrompt: "你是写作 agent。", stylePrinciples: [], constraints: [], minChars: 600, maxChars: 900 })
          : `林越登场。${"正文".repeat(1000)}\n===OUTLINE===\n章`;
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: overflowFetch });
      const result = await growXiaoshuoAgentLoop(host, { goal: "g", maxRounds: 3, sampleChapters: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const pkg = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
      const lengthRule = pkg.qualityRules.find((r: { kind: string }) => r.kind === "length");
      // widened from the declared 900 to accommodate the ~2000-char samples
      expect(lengthRule.maxChars).toBeGreaterThan(900);
    });
  });
});

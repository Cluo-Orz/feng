import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFengHost } from "../../src/host/index.js";
import { runChapters, type AuthoringRuntimeDeps } from "../../src/authoring-runtime/index.js";
import {
  savePackage,
  defaultContextPolicy,
  defaultNovelTargetWorld,
  defaultQualityRules,
  defaultFeedbackRouting,
  PACKAGE_SCHEMA_VERSION,
  type AuthoringRuntimePackage
} from "../../src/runtime-package/index.js";
import type { FetchLike } from "../../src/providers/index.js";

const provider = { provider: "deepseek", apiKey: "k", baseUrl: "https://api.deepseek.com", model: "m", maxTokens: 256, reasoningModel: true };

function pkg(): AuthoringRuntimePackage {
  return {
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    packageId: "pkg-1",
    name: "xiaoshuo",
    kind: "serialized_authoring_agent",
    version: "1.0.0",
    locked: true,
    runEntry: "feng run",
    targetWorld: defaultNovelTargetWorld,
    contextPolicy: defaultContextPolicy,
    writingStrategy: { systemPrompt: "你是连贯写作 agent。", stylePrinciples: ["生动"], constraints: ["保持连贯"] },
    qualityRules: defaultQualityRules,
    feedbackRouting: defaultFeedbackRouting,
    validation: { readiness: "ready", grownInProject: "/x", evidenceSummary: "ok", checkedAt: "t" },
    provenance: { model: "m", provider: "deepseek", hatchedAt: "t" }
  };
}

function chapterFetch(text: (n: number) => string): FetchLike {
  let n = 0;
  return async () => {
    n += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: String(n), model: "m", choices: [{ message: { content: text(n) }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }),
      text: async () => ""
    };
  };
}

async function withProject(body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "feng-auth-"));
  try {
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function seedProject(root: string, config: Record<string, unknown>): Promise<void> {
  const dir = path.join(root, ".feng", "runtime");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "project.json"), JSON.stringify(config), "utf8");
}

describe("authoring runtime runChapter", () => {
  it("writes every file-native per-chapter artifact and a passing eval", async () => {
    await withProject(async (root) => {
      await seedProject(root, { premise: "李白重生现代成都", title: "李白重生了", establishedYear: 2024, establishedCharacters: ["李白"] });
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: chapterFetch((n) => `李白在第${n}章继续行动。${"正文".repeat(600)}\n===OUTLINE===\n第${n}章：李白推进剧情`) });
      const deps: AuthoringRuntimeDeps = { store: host.store, workspace: host.workspace, llmGateway: host.llmGateway, policy: host.policy, provider: "deepseek", model: "m" };
      const result = await runChapters(deps, pkg(), 1);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const dir = path.join(root, ".feng", "runtime", "chapters", "chapter-01");
      for (const file of ["input.json", "message-list.json", "model-output.json", "trace.json", "quality-eval.json", "feedback.json"]) {
        const content = await readFile(path.join(dir, file), "utf8");
        expect(content.length).toBeGreaterThan(0);
      }
      const chapter = await readFile(path.join(root, "chapters", "chapter-01.md"), "utf8");
      expect(chapter).toContain("第1章");
      const state = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "novel-state.json"), "utf8"));
      expect(state.chapters).toHaveLength(1);
      expect(result.value[0]?.qualityPassed).toBe(true);
    });
  });

  it("catches a year drift across chapters and routes it to the work layer", async () => {
    await withProject(async (root) => {
      await seedProject(root, { premise: "p", title: "t", establishedYear: 2024, establishedCharacters: ["李白"] });
      const host = await createFengHost({
        config: { workspaceRoot: root, provider },
        fetchImpl: chapterFetch((n) => n === 1
          ? `李白现身，时值2024年。${"正文".repeat(600)}\n===OUTLINE===\n第1章：开端`
          : `李白前行，转眼已是2025年。${"正文".repeat(600)}\n===OUTLINE===\n第2章：推进`)
      });
      const deps: AuthoringRuntimeDeps = { store: host.store, workspace: host.workspace, llmGateway: host.llmGateway, policy: host.policy, provider: "deepseek", model: "m" };
      const result = await runChapters(deps, pkg(), 2);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const ch2 = result.value[1];
      expect(ch2?.quality.issues.some((i) => i.kind === "year_consistency")).toBe(true);
      expect(ch2?.feedback.byLayer.work).toBeGreaterThanOrEqual(1);
    });
  });

  it("self-repairs a too-short chapter and records the repair", async () => {
    await withProject(async (root) => {
      await seedProject(root, { premise: "p", title: "t" });
      let n = 0;
      const shortThenLong: FetchLike = async () => {
        n += 1;
        const content = n === 1
          ? "太短了。\n===OUTLINE===\n梗概"
          : `${"扩写后的正文内容。".repeat(120)}\n===OUTLINE===\n扩写后的梗概`;
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: shortThenLong });
      const deps: AuthoringRuntimeDeps = { store: host.store, workspace: host.workspace, llmGateway: host.llmGateway, policy: host.policy, provider: "deepseek", model: "m" };
      const result = await runChapters(deps, pkg(), 1);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value[0]?.repairAttempts).toBe(1);
      expect(result.value[0]?.chars).toBeGreaterThanOrEqual(900);
      const output = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "chapters", "chapter-01", "model-output.json"), "utf8"));
      expect(output.repairAttempts).toBe(1);
      expect(n).toBe(2);
    });
  });

  it("writes a file-native semantic eval artifact when enabled", async () => {
    await withProject(async (root) => {
      await seedProject(root, { premise: "p", title: "t" });
      let n = 0;
      const fetch: FetchLike = async () => {
        n += 1;
        const content = n % 2 === 1
          ? `${"正文内容。".repeat(200)}\n===OUTLINE===\n梗概`
          : '{"style": 8, "character": 7, "plot": 9, "notes": "好"}';
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: fetch });
      const deps: AuthoringRuntimeDeps = { store: host.store, workspace: host.workspace, llmGateway: host.llmGateway, policy: host.policy, provider: "deepseek", model: "m", semanticEval: true };
      const result = await runChapters(deps, pkg(), 1);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value[0]?.semantic?.overall).toBe(8);
      const semantic = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "chapters", "chapter-01", "semantic-eval.json"), "utf8"));
      expect(semantic.scores.style).toBe(8);
      expect(semantic.chapterNumber).toBe(1);
    });
  });

  it("errors when the work project has no project.json", async () => {
    await withProject(async (root) => {
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: chapterFetch(() => "x") });
      const deps: AuthoringRuntimeDeps = { store: host.store, workspace: host.workspace, llmGateway: host.llmGateway, policy: host.policy, provider: "deepseek", model: "m" };
      const result = await runChapters(deps, pkg(), 1);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_state");
    });
  });

  it("loads a saved package and runs through it", async () => {
    await withProject(async (root) => {
      await seedProject(root, { premise: "p", title: "t" });
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: chapterFetch((n) => `${"正文".repeat(600)}\n===OUTLINE===\n第${n}章`) });
      const saved = await savePackage(host.store, host.workspace, pkg());
      expect(saved.ok).toBe(true);
      const deps: AuthoringRuntimeDeps = { store: host.store, workspace: host.workspace, llmGateway: host.llmGateway, policy: host.policy, provider: "deepseek", model: "m" };
      const result = await runChapters(deps, pkg(), 1);
      expect(result.ok).toBe(true);
    });
  });
});

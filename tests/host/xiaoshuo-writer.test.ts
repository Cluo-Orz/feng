import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFengHost, readNovelState, writeNextChapter, writeNovel, runCli } from "../../src/host/index.js";
import type { FetchLike } from "../../src/providers/index.js";

const provider = {
  provider: "deepseek",
  apiKey: "test-key",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-pro",
  maxTokens: 256,
  reasoningModel: true
};

async function withRoot(body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "feng-xiaoshuo-test-"));
  try {
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function chapterFetch(): FetchLike {
  let n = 0;
  return async () => {
    n += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: `resp-${n}`,
        model: "deepseek-v4-pro",
        choices: [{
          message: { content: `第${n}章正文：李白在现代成都的第${n}天。\n===OUTLINE===\n第${n}章梗概：李白适应现代生活的第${n}步。` },
          finish_reason: "stop"
        }],
        usage: { prompt_tokens: 30, completion_tokens: 50, total_tokens: 80 }
      }),
      text: async () => ""
    };
  };
}

describe("xiaoshuo writer", () => {
  it("writes a first chapter, persists novel state and a chapter file", async () => {
    await withRoot(async (root) => {
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: chapterFetch() });
      const result = await writeNextChapter(host, { premise: "李白重生到现代成都", title: "李白重生了" });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.chapterNumber).toBe(1);
      expect(result.value.chars).toBeGreaterThan(0);

      const state = await readNovelState(host);
      expect(state?.chapters.length).toBe(1);
      expect(state?.premise).toBe("李白重生到现代成都");

      const file = await readFile(path.join(root, result.value.path), "utf8");
      expect(file).toContain("第1章");
      expect(file).toContain("李白");
    });
  });

  it("requires a premise for the first chapter", async () => {
    await withRoot(async (root) => {
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: chapterFetch() });
      const result = await writeNextChapter(host, {});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_input");
    });
  });

  it("continues serialized chapters using persisted state", async () => {
    await withRoot(async (root) => {
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: chapterFetch() });
      const novel = await writeNovel(host, { premise: "李白重生到现代成都", title: "李白重生了", chapters: 3 });
      expect(novel.ok).toBe(true);
      if (!novel.ok) throw new Error(novel.error.message);
      expect(novel.value.length).toBe(3);
      expect(novel.value.map((c) => c.chapterNumber)).toEqual([1, 2, 3]);
      const state = await readNovelState(host);
      expect(state?.chapters.length).toBe(3);
    });
  });

  it("drives the writer from runCli with the write subcommand", async () => {
    await withRoot(async (root) => {
      const out: string[] = [];
      const code = await runCli({
        argv: ["write", "--premise", "李白重生到现代成都", "--title", "李白重生了", "--chapters", "2"],
        workspaceRoot: root,
        processEnv: { DEEPSEEK_API_KEY: "k", MODEL: "deepseek-v4-pro" },
        fetchImpl: chapterFetch(),
        stdout: (t) => out.push(t),
        stderr: () => {}
      });
      expect(code).toBe(0);
      expect(out.join("\n")).toContain("chapter 1");
      expect(out.join("\n")).toContain("chapter 2");
    });
  });

  it("propagates provider failures and returns an error", async () => {
    await withRoot(async (root) => {
      const failFetch: FetchLike = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "boom" });
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: failFetch });
      const result = await writeNextChapter(host, { premise: "p" });
      expect(result.ok).toBe(false);
    });
  });

  it("rejects an empty model response as invalid", async () => {
    await withRoot(async (root) => {
      const emptyFetch: FetchLike = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: "e", model: "m", choices: [{ message: { content: "" }, finish_reason: "stop" }], usage: {} }),
        text: async () => ""
      });
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: emptyFetch });
      const result = await writeNextChapter(host, { premise: "p" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("response_invalid");
    });
  });

  it("runCli write reports a non-zero code when the provider fails", async () => {
    await withRoot(async (root) => {
      const errors: string[] = [];
      const failFetch: FetchLike = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "boom" });
      const code = await runCli({
        argv: ["write", "--premise", "p", "--chapters", "1"],
        workspaceRoot: root,
        processEnv: { DEEPSEEK_API_KEY: "k", MODEL: "m" },
        fetchImpl: failFetch,
        stdout: () => {},
        stderr: (t) => errors.push(t)
      });
      expect(code).toBe(1);
      expect(errors.join(" ")).toContain("feng write error");
    });
  });

  it("returns partial results when a later chapter fails", async () => {
    await withRoot(async (root) => {
      let n = 0;
      const flaky: FetchLike = async () => {
        n += 1;
        if (n === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "1", model: "m", choices: [{ message: { content: "第1章。\n===OUTLINE===\n梗概1" }, finish_reason: "stop" }], usage: {} }),
            text: async () => ""
          };
        }
        return { ok: false, status: 500, json: async () => ({}), text: async () => "boom" };
      };
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: flaky });
      const novel = await writeNovel(host, { premise: "p", chapters: 3 });
      expect(novel.ok).toBe(true);
      if (novel.ok) expect(novel.value.length).toBe(1);
    });
  });
});

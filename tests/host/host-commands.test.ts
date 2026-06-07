import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/host/index.js";
import type { FetchLike } from "../../src/providers/index.js";

const env = { DEEPSEEK_API_KEY: "k", MODEL: "m" };

function fetchFor(body: (call: number) => string): FetchLike {
  let n = 0;
  return async () => {
    n += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: String(n), model: "m", choices: [{ message: { content: body(n) }, finish_reason: "stop" }], usage: {} }),
      text: async () => ""
    };
  };
}

async function withRoot(body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "feng-hostcmd-"));
  try {
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const STRATEGY = JSON.stringify({ systemPrompt: "你是写作 agent，保持连贯。", stylePrinciples: ["生动"], constraints: ["900-1500字"] });

describe("host command dispatch via runCli", () => {
  it("grow-agent requires --goal", async () => {
    await withRoot(async (root) => {
      const errors: string[] = [];
      const code = await runCli({ argv: ["grow-agent"], workspaceRoot: root, processEnv: env, fetchImpl: fetchFor(() => STRATEGY), stdout: () => {}, stderr: (t) => errors.push(t) });
      expect(code).toBe(2);
      expect(errors.join(" ")).toContain("--goal");
    });
  });

  it("grow-agent hatches a package and run consumes it end to end", async () => {
    await withRoot(async (root) => {
      const out: string[] = [];
      const growCode = await runCli({
        argv: ["grow-agent", "--goal", "写小说 agent"],
        workspaceRoot: root, processEnv: env, fetchImpl: fetchFor(() => STRATEGY),
        stdout: (t) => out.push(t), stderr: () => {}
      });
      expect(growCode).toBe(0);
      expect(out.join("\n")).toContain("hatched");

      // work project provides facts
      await mkdir(path.join(root, ".feng", "runtime"), { recursive: true });
      await writeFile(path.join(root, ".feng", "runtime", "project.json"), JSON.stringify({ premise: "李白重生", title: "李白重生了", establishedCharacters: ["李白"] }), "utf8");

      const runOut: string[] = [];
      const runCode = await runCli({
        argv: ["run", "--chapters", "2"],
        workspaceRoot: root, processEnv: env,
        fetchImpl: fetchFor((n) => `李白在第${n}章。${"正文".repeat(600)}\n===OUTLINE===\n第${n}章梗概`),
        stdout: (t) => runOut.push(t), stderr: () => {}
      });
      expect(runCode).toBe(0);
      expect(runOut.join("\n")).toContain("[run] package=xiaoshuo");
      expect(runOut.join("\n")).toContain("ch1");
      const evalText = await readFile(path.join(root, ".feng", "runtime", "chapters", "chapter-01", "quality-eval.json"), "utf8");
      expect(evalText).toContain("chapterNumber");
    });
  });

  it("run errors clearly when no package is hatched", async () => {
    await withRoot(async (root) => {
      const errors: string[] = [];
      const code = await runCli({ argv: ["run"], workspaceRoot: root, processEnv: env, fetchImpl: fetchFor(() => "x"), stdout: () => {}, stderr: (t) => errors.push(t) });
      expect(code).toBe(1);
      expect(errors.join(" ")).toContain("package_unavailable");
    });
  });

  it("write still works as the legacy host demo", async () => {
    await withRoot(async (root) => {
      const out: string[] = [];
      const code = await runCli({
        argv: ["write", "--premise", "p", "--title", "t", "--chapters", "1"],
        workspaceRoot: root, processEnv: env,
        fetchImpl: fetchFor((n) => `第${n}章。\n===OUTLINE===\n梗概`),
        stdout: (t) => out.push(t), stderr: () => {}
      });
      expect(code).toBe(0);
      expect(out.join("\n")).toContain("chapter 1");
    });
  });

  it("dispatches non-host commands to the module CLI", async () => {
    await withRoot(async (root) => {
      const out: string[] = [];
      const code = await runCli({ argv: ["grow", "list"], workspaceRoot: root, processEnv: env, stdout: (t) => out.push(t), stderr: () => {} });
      expect(code).toBe(0);
      expect(out.join("\n").toLowerCase()).toContain("grow unit");
    });
  });
});

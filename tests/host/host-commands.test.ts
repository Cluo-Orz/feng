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

  it("refuses to run an unlocked package unless --allow-unlocked is passed", async () => {
    await withRoot(async (root) => {
      const dir = path.join(root, ".feng", "hatch");
      await mkdir(dir, { recursive: true });
      await mkdir(path.join(root, ".feng", "runtime"), { recursive: true });
      await writeFile(path.join(root, ".feng", "runtime", "project.json"), JSON.stringify({ premise: "p", title: "t" }), "utf8");
      const unlocked = {
        schemaVersion: "1.0.0", packageId: "pkg-x", name: "xiaoshuo", kind: "serialized_authoring_agent", version: "0.1.0",
        locked: false, runEntry: "feng run",
        targetWorld: { description: "d", inputKinds: [], outputKinds: [], actionBoundary: [], failureHandling: [], dialogueAllowed: false },
        contextPolicy: [{ kind: "observation", title: "o", source: "s", maxChars: 1000 }],
        writingStrategy: { systemPrompt: "你是写作 agent。", stylePrinciples: [], constraints: [] },
        qualityRules: [{ kind: "length", minChars: 1, maxChars: 100000 }], feedbackRouting: [],
        validation: { readiness: "draft", grownInProject: "/x", evidenceSummary: "", checkedAt: "t" },
        provenance: { model: "m", provider: "deepseek", hatchedAt: "t" }
      };
      await writeFile(path.join(dir, "xiaoshuo-runtime.json"), JSON.stringify(unlocked), "utf8");

      const errors: string[] = [];
      const refused = await runCli({ argv: ["run"], workspaceRoot: root, processEnv: env, fetchImpl: fetchFor(() => `${"正文".repeat(50)}\n===OUTLINE===\n梗概`), stdout: () => {}, stderr: (t) => errors.push(t) });
      expect(refused).toBe(1);
      expect(errors.join(" ")).toContain("production_lock_violation");

      const out: string[] = [];
      const allowed = await runCli({ argv: ["run", "--allow-unlocked"], workspaceRoot: root, processEnv: env, fetchImpl: fetchFor(() => `${"正文".repeat(50)}\n===OUTLINE===\n梗概`), stdout: (t) => out.push(t), stderr: () => {} });
      expect(allowed).toBe(0);
      expect(out.join("\n")).toContain("[run] package=xiaoshuo");
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

  it("route-feedback requires --target", async () => {
    await withRoot(async (root) => {
      const errors: string[] = [];
      const code = await runCli({ argv: ["route-feedback"], workspaceRoot: root, processEnv: env, fetchImpl: fetchFor(() => "x"), stdout: () => {}, stderr: (t) => errors.push(t) });
      expect(code).toBe(2);
      expect(errors.join(" ")).toContain("--target");
    });
  });

  it("route-feedback keeps work facts local and absorbs capability upstream", async () => {
    await withRoot(async (work) => {
      const agent = await mkdtemp(path.join(tmpdir(), "feng-rf-cli-agent-"));
      try {
        const dir = path.join(work, ".feng", "runtime", "chapters", "chapter-01");
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, "feedback.json"), JSON.stringify({ candidates: [
          { issueKind: "length", layer: "work", severity: "warning", detail: "字数", routingReason: "本地", chapterNumber: 1 },
          { issueKind: "character_continuation", layer: "capability", severity: "warning", detail: "人物", routingReason: "回流", chapterNumber: 1 }
        ] }), "utf8");
        const out: string[] = [];
        const code = await runCli({
          argv: ["route-feedback", "--target", work, "--agent-dir", agent],
          workspaceRoot: work, processEnv: env, stdout: (t) => out.push(t), stderr: () => {}
        });
        expect(code).toBe(0);
        expect(out.join("\n")).toContain("work(kept-local)=1");
        expect(out.join("\n")).toContain("capability->agent=1");
      } finally {
        await rm(agent, { recursive: true, force: true });
      }
    });
  });

  it("grow-agent surfaces a provider failure", async () => {
    await withRoot(async (root) => {
      const failFetch: FetchLike = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "boom" });
      const errors: string[] = [];
      const code = await runCli({ argv: ["grow-agent", "--goal", "x"], workspaceRoot: root, processEnv: env, fetchImpl: failFetch, stdout: () => {}, stderr: (t) => errors.push(t) });
      expect(code).toBe(1);
      expect(errors.join(" ")).toContain("grow-agent error");
    });
  });

  it("grow-agent --loop runs multi-round and prints round reports", async () => {
    await withRoot(async (root) => {
      let n = 0;
      const loopFetch: FetchLike = async () => {
        n += 1;
        let content: string;
        if (n === 1) content = JSON.stringify({ systemPrompt: "你是写作 agent，保持连贯。", stylePrinciples: ["生动"], constraints: ["连续"], minChars: 800, maxChars: 4000 });
        else if (n === 3) content = `一个陌生人登场。${"正文".repeat(500)}\n===OUTLINE===\n第2章`;
        else content = `林越继续行动。${"正文".repeat(500)}\n===OUTLINE===\n章`;
        return { ok: true, status: 200, json: async () => ({ id: String(n), model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => "" };
      };
      const out: string[] = [];
      const code = await runCli({ argv: ["grow-agent", "--loop", "--goal", "成长小说 agent", "--rounds", "2", "--sample-chapters", "2"], workspaceRoot: root, processEnv: env, fetchImpl: loopFetch, stdout: (t) => out.push(t), stderr: () => {} });
      expect(code).toBe(0);
      const joined = out.join("\n");
      expect(joined).toContain("[grow-agent --loop]");
      expect(joined).toContain("round 1");
      expect(joined).toContain("improved=true");
    });
  });
});

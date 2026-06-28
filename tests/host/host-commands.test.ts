import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
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

function response(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ id: "judge", model: "m", choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }),
    text: async () => ""
  };
}

function withJudges(fetch: FetchLike): FetchLike {
  return async (url, init) => {
    const body = init.body;
    if (body.includes("严格的中文小说质量评审")) {
      return response('{"style": 9, "character": 9, "plot": 9, "problems": [], "notes": "达标"}');
    }
    if (body.includes("严格的章节目标覆盖评审")) {
      return response('{"covered": true, "confidence": 0.92, "evidence": ["章节覆盖目标"], "missing": [], "notes": "目标已覆盖"}');
    }
    return fetch(url, init);
  };
}

function withMissingGoalJudge(fetch: FetchLike): FetchLike {
  return async (url, init) => {
    const body = init.body;
    if (body.includes("严格的中文小说质量评审")) {
      return response('{"style": 9, "character": 9, "plot": 9, "problems": [], "notes": "达标"}');
    }
    if (body.includes("严格的章节目标覆盖评审")) {
      return response('{"covered": false, "confidence": 0.91, "evidence": [], "missing": ["没有写出手机支付"], "notes": "漏掉目标"}');
    }
    return fetch(url, init);
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

const STRATEGY = JSON.stringify({
  systemPrompt: "你是写作 agent，保持连贯。",
  stylePrinciples: ["生动"],
  constraints: ["900-1500字"],
  coveragePolicy: {
    noMissingTopic: {
      enabled: true,
      gateId: "gate-grown-cli-goal-coverage",
      title: "章节目标必须被正面回应",
      evidenceRequired: "goal coverage judge or author review confirms the chapter answered the chapter goal",
      promptOnlyAllowed: true,
      blockingUntilReviewed: true
    }
  }
});

function runtimePackage(input: { readonly locked?: boolean; readonly readiness?: "ready" | "draft"; readonly version?: string; readonly grownInProject?: string } = {}) {
  return {
    schemaVersion: "1.0.0", packageId: "pkg-x", name: "xiaoshuo", kind: "serialized_authoring_agent", version: input.version ?? "1.0.0",
    locked: input.locked ?? true, runEntry: "feng run",
    targetWorld: { description: "d", inputKinds: ["premise", "title"], outputKinds: ["chapter_text", "updated_outline"], actionBoundary: [], failureHandling: [], dialogueAllowed: false },
    contextPolicy: [], writingStrategy: { systemPrompt: "installed package", stylePrinciples: [], constraints: [] },
    qualityRules: [{ kind: "length", minChars: 1, maxChars: 100000 }], feedbackRouting: [],
    validation: { readiness: input.readiness ?? "ready", grownInProject: input.grownInProject ?? "/agent", evidenceSummary: "sample evidence", checkedAt: "t" },
    provenance: { model: "m", provider: "deepseek", hatchedAt: "t" }
  };
}

describe("host command dispatch via runCli", () => {
  it("grow-agent requires --goal", async () => {
    await withRoot(async (root) => {
      const errors: string[] = [];
      const code = await runCli({ argv: ["grow-agent"], workspaceRoot: root, processEnv: env, fetchImpl: fetchFor(() => STRATEGY), stdout: () => {}, stderr: (t) => errors.push(t) });
      expect(code).toBe(2);
      expect(errors.join(" ")).toContain("--goal");
    });
  });

  it("grow-agent writes a draft package unless the loop path validates it", async () => {
    await withRoot(async (root) => {
      const out: string[] = [];
      const code = await runCli({
        argv: ["grow-agent", "--goal", "写小说 agent"],
        workspaceRoot: root, processEnv: env, fetchImpl: fetchFor(() => STRATEGY),
        stdout: (t) => out.push(t), stderr: () => {}
      });
      expect(code).toBe(0);
      expect(out.join("\n")).toContain("[grow-agent] drafted");
      expect(out.join("\n")).toContain("design-only draft");
      const pkg = JSON.parse(await readFile(path.join(root, ".feng", "hatch", "xiaoshuo-runtime.json"), "utf8"));
      expect(pkg.locked).toBe(false);
      expect(pkg.validation.readiness).toBe("draft");
    });
  });

  it("grow-agent --loop hatches a locked package and run consumes it end to end", async () => {
    await withRoot(async (root) => {
      const out: string[] = [];
      const growCode = await runCli({
        argv: ["grow-agent", "--loop", "--goal", "写小说 agent", "--rounds", "1", "--sample-chapters", "1"],
        workspaceRoot: root, processEnv: env,
        fetchImpl: withJudges(fetchFor((n) => n === 1 ? STRATEGY : `李白在第${n}章。${"正文".repeat(600)}\n===OUTLINE===\n第${n}章梗概`)),
        stdout: (t) => out.push(t), stderr: () => {}
      });
      expect(growCode).toBe(0);
      expect(out.join("\n")).toContain("[grow-agent --loop]");
      const pkg = JSON.parse(await readFile(path.join(root, ".feng", "hatch", "xiaoshuo-runtime.json"), "utf8"));
      expect(pkg.locked).toBe(true);
      expect(pkg.validation.readiness).toBe("ready");

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
      expect(runOut.join("\n")).toContain("quality gates");
      expect(runOut.join("\n")).toContain("gates: .feng/runtime/chapters/chapter-01/quality-gates.json");
      const evalText = await readFile(path.join(root, ".feng", "runtime", "chapters", "chapter-01", "quality-eval.json"), "utf8");
      expect(evalText).toContain("chapterNumber");
    });
  });

  it("feng grow --goal is the high-level case-flow entry and passes the goal into design context", async () => {
    await withRoot(async (root) => {
      const out: string[] = [];
      const goal = "成长出一个可复制的中文连载小说写作 agent，不能只写 prompt";
      const code = await runCli({
        argv: ["grow", "--goal", goal, "--name", "xiaoshuo", "--rounds", "1", "--sample-chapters", "1"],
        workspaceRoot: root, processEnv: env,
        fetchImpl: withJudges(fetchFor((n) => n === 1 ? STRATEGY : `李白在第${n}章。${"正文".repeat(600)}\n===OUTLINE===\n第${n}章梗概`)),
        stdout: (t) => out.push(t), stderr: () => {}
      });
      expect(code).toBe(0);
      expect(out.join("\n")).toContain("[grow]");
      expect(out.join("\n")).not.toContain("[grow-agent --loop]");

      const pkg = JSON.parse(await readFile(path.join(root, ".feng", "hatch", "xiaoshuo-runtime.json"), "utf8"));
      expect(pkg.locked).toBe(true);
      expect(pkg.validation.readiness).toBe("ready");

      const attemptsRoot = path.join(root, ".feng", "grow-agent", "design-attempts");
      const growIds = await readdir(attemptsRoot);
      const messageList = JSON.parse(await readFile(path.join(attemptsRoot, growIds[0] as string, "loop-design", "message-list.json"), "utf8"));
      expect(messageList.goal).toBe(goal);
      expect(JSON.stringify(messageList.messages)).toContain(goal);
    });
  });

  it("install-runtime copies a locked hatch package into a work project and records the receipt", async () => {
    await withRoot(async (agent) => {
      const work = await mkdtemp(path.join(tmpdir(), "feng-install-work-"));
      try {
        await mkdir(path.join(agent, ".feng", "hatch"), { recursive: true });
        await writeFile(path.join(agent, ".feng", "hatch", "xiaoshuo-runtime.json"), JSON.stringify(runtimePackage()), "utf8");
        const out: string[] = [];
        const installed = await runCli({
          argv: ["install-runtime", "--from", agent],
          workspaceRoot: work,
          processEnv: env,
          stdout: (t) => out.push(t),
          stderr: () => {}
        });
        expect(installed).toBe(0);
        expect(out.join("\n")).toContain("[install-runtime] xiaoshuo@1.0.0 installed");
        const copied = JSON.parse(await readFile(path.join(work, ".feng", "hatch", "xiaoshuo-runtime.json"), "utf8"));
        expect(copied.name).toBe("xiaoshuo");
        const receipt = JSON.parse(await readFile(path.join(work, ".feng", "runtime", "package-install.json"), "utf8"));
        expect(receipt.kind).toBe("runtime_package_install");
        expect(receipt.sourceWorkspaceRoot).toBe(agent);
        expect(receipt.installedPackagePath).toBe(".feng/hatch/xiaoshuo-runtime.json");
        expect(receipt.locked).toBe(true);
        expect(receipt.readiness).toBe("ready");
        expect(out.join("\n")).toContain("package lock created");
        const lock = JSON.parse(await readFile(path.join(work, ".feng", "runtime", "package-lock.json"), "utf8"));
        expect(lock.kind).toBe("runtime_package_lock");
        expect(lock.version).toBe("1.0.0");
        expect(lock.contentHash).toEqual(receipt.contentHash);

        await mkdir(path.join(work, ".feng", "runtime"), { recursive: true });
        await writeFile(path.join(work, ".feng", "runtime", "project.json"), JSON.stringify({ premise: "李白重生", title: "李白重生了" }), "utf8");
        const runOut: string[] = [];
        const runCode = await runCli({
          argv: ["run"],
          workspaceRoot: work,
          processEnv: env,
          fetchImpl: fetchFor(() => `${"正文".repeat(50)}\n===OUTLINE===\n梗概`),
          stdout: (t) => runOut.push(t),
          stderr: () => {}
        });
        expect(runCode).toBe(0);
        expect(runOut.join("\n")).toContain("[run] package=xiaoshuo@1.0.0");
        expect(runOut.join("\n")).toContain("package lock matched");
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    });
  });

  it("install-runtime refuses unlocked draft packages by default", async () => {
    await withRoot(async (agent) => {
      const work = await mkdtemp(path.join(tmpdir(), "feng-install-work-"));
      try {
        await mkdir(path.join(agent, ".feng", "hatch"), { recursive: true });
        await writeFile(path.join(agent, ".feng", "hatch", "xiaoshuo-runtime.json"), JSON.stringify(runtimePackage({ locked: false, readiness: "draft" })), "utf8");
        const errors: string[] = [];
        const code = await runCli({
          argv: ["install-runtime", "--from", agent],
          workspaceRoot: work,
          processEnv: env,
          stdout: () => {},
          stderr: (t) => errors.push(t)
        });
        expect(code).toBe(1);
        expect(errors.join("\n")).toContain("production_lock_violation");
        expect(errors.join("\n")).toContain("--allow-unlocked");
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    });
  });

  it("install-runtime refuses package drift unless the operator accepts the update", async () => {
    await withRoot(async (agent) => {
      const work = await mkdtemp(path.join(tmpdir(), "feng-install-work-"));
      try {
        await mkdir(path.join(agent, ".feng", "hatch"), { recursive: true });
        await mkdir(path.join(work, ".feng", "hatch"), { recursive: true });
        await writeFile(path.join(work, ".feng", "hatch", "xiaoshuo-runtime.json"), JSON.stringify(runtimePackage({ version: "1.0.0" })), "utf8");
        await writeFile(path.join(agent, ".feng", "hatch", "xiaoshuo-runtime.json"), JSON.stringify(runtimePackage({ version: "1.0.1" })), "utf8");

        const errors: string[] = [];
        const refused = await runCli({
          argv: ["install-runtime", "--from", agent],
          workspaceRoot: work,
          processEnv: env,
          stdout: () => {},
          stderr: (t) => errors.push(t)
        });
        expect(refused).toBe(1);
        expect(errors.join("\n")).toContain("production_lock_violation");
        expect(errors.join("\n")).toContain("--accept-package-update");

        const out: string[] = [];
        const accepted = await runCli({
          argv: ["install-runtime", "--from", agent, "--accept-package-update"],
          workspaceRoot: work,
          processEnv: env,
          stdout: (t) => out.push(t),
          stderr: () => {}
        });
        expect(accepted).toBe(0);
        expect(out.join("\n")).toContain("updated");
        const copied = JSON.parse(await readFile(path.join(work, ".feng", "hatch", "xiaoshuo-runtime.json"), "utf8"));
        expect(copied.version).toBe("1.0.1");
        const receipt = JSON.parse(await readFile(path.join(work, ".feng", "runtime", "package-install.json"), "utf8"));
        expect(receipt.status).toBe("updated");
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    });
  });

  it("install-runtime can update from the recorded source without repeating --from", async () => {
    await withRoot(async (agent) => {
      const work = await mkdtemp(path.join(tmpdir(), "feng-install-work-"));
      const feng = await mkdtemp(path.join(tmpdir(), "feng-install-feng-"));
      try {
        await mkdir(path.join(agent, ".feng", "hatch"), { recursive: true });
        await writeFile(path.join(agent, ".feng", "hatch", "xiaoshuo-runtime.json"), JSON.stringify(runtimePackage({ version: "1.0.0" })), "utf8");
        const first = await runCli({
          argv: ["install-runtime", "--from", agent, "--feng-dir", feng],
          workspaceRoot: work,
          processEnv: env,
          stdout: () => {},
          stderr: () => {}
        });
        expect(first).toBe(0);

        await writeFile(path.join(agent, ".feng", "hatch", "xiaoshuo-runtime.json"), JSON.stringify(runtimePackage({ version: "1.0.1" })), "utf8");
        const out: string[] = [];
        const updated = await runCli({
          argv: ["install-runtime", "--accept-package-update"],
          workspaceRoot: work,
          processEnv: env,
          stdout: (t) => out.push(t),
          stderr: () => {}
        });
        expect(updated).toBe(0);
        expect(out.join("\n")).toContain("[install-runtime] xiaoshuo@1.0.1 updated");
        expect(out.join("\n")).toContain("package lock updated");
        expect(out.join("\n")).toContain(`source: ${agent}`);
        const copied = JSON.parse(await readFile(path.join(work, ".feng", "hatch", "xiaoshuo-runtime.json"), "utf8"));
        expect(copied.version).toBe("1.0.1");
        const receipt = JSON.parse(await readFile(path.join(work, ".feng", "runtime", "package-install.json"), "utf8"));
        expect(receipt.sourceWorkspaceRoot).toBe(agent);
        expect(receipt.systemWorkspaceRoot).toBe(feng);
        expect(receipt.status).toBe("updated");
        const lock = JSON.parse(await readFile(path.join(work, ".feng", "runtime", "package-lock.json"), "utf8"));
        expect(lock.version).toBe("1.0.1");
        expect(lock.contentHash).toEqual(receipt.contentHash);

        await writeFile(path.join(work, ".feng", "runtime", "project.json"), JSON.stringify({ premise: "李白重生", title: "李白重生了" }), "utf8");
        const runOut: string[] = [];
        const runCode = await runCli({
          argv: ["run"],
          workspaceRoot: work,
          processEnv: env,
          fetchImpl: fetchFor(() => `${"正文".repeat(50)}\n===OUTLINE===\n梗概`),
          stdout: (t) => runOut.push(t),
          stderr: () => {}
        });
        expect(runCode).toBe(0);
        expect(runOut.join("\n")).toContain("[run] package=xiaoshuo@1.0.1");
        expect(runOut.join("\n")).toContain("package lock matched");
      } finally {
        await rm(work, { recursive: true, force: true });
        await rm(feng, { recursive: true, force: true });
      }
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

  it("refuses silent locked-package drift unless the operator accepts the update", async () => {
    await withRoot(async (root) => {
      const dir = path.join(root, ".feng", "hatch");
      await mkdir(dir, { recursive: true });
      await mkdir(path.join(root, ".feng", "runtime"), { recursive: true });
      await writeFile(path.join(root, ".feng", "runtime", "project.json"), JSON.stringify({ premise: "p", title: "t" }), "utf8");
      const packageOf = (version: string, prompt: string) => ({
        schemaVersion: "1.0.0", packageId: "pkg-x", name: "xiaoshuo", kind: "serialized_authoring_agent", version,
        locked: true, runEntry: "feng run",
        targetWorld: { description: "d", inputKinds: ["premise"], outputKinds: ["chapter_text"], actionBoundary: [], failureHandling: [], dialogueAllowed: false },
        contextPolicy: [], writingStrategy: { systemPrompt: prompt, stylePrinciples: [], constraints: [] },
        qualityRules: [{ kind: "length", minChars: 1, maxChars: 100000 }], feedbackRouting: [],
        validation: { readiness: "ready", grownInProject: "/x", evidenceSummary: "", checkedAt: "t" },
        provenance: { model: "m", provider: "deepseek", hatchedAt: "t" }
      });
      await writeFile(path.join(dir, "xiaoshuo-runtime.json"), JSON.stringify(packageOf("1.0.0", "old")), "utf8");

      const out: string[] = [];
      const first = await runCli({
        argv: ["run"],
        workspaceRoot: root, processEnv: env,
        fetchImpl: fetchFor(() => `${"正文".repeat(50)}\n===OUTLINE===\n梗概`),
        stdout: (t) => out.push(t), stderr: () => {}
      });
      expect(first).toBe(0);
      expect(out.join("\n")).toContain("package lock created");
      const lock = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "package-lock.json"), "utf8"));
      expect(lock.version).toBe("1.0.0");

      await writeFile(path.join(dir, "xiaoshuo-runtime.json"), JSON.stringify(packageOf("1.0.1", "new")), "utf8");
      const errors: string[] = [];
      const refused = await runCli({
        argv: ["run"],
        workspaceRoot: root, processEnv: env,
        fetchImpl: fetchFor(() => `${"正文".repeat(50)}\n===OUTLINE===\n梗概`),
        stdout: () => {}, stderr: (t) => errors.push(t)
      });
      expect(refused).toBe(1);
      expect(errors.join("\n")).toContain("production_lock_violation");
      expect(errors.join("\n")).toContain("--accept-package-update");

      const acceptedOut: string[] = [];
      const accepted = await runCli({
        argv: ["run", "--accept-package-update"],
        workspaceRoot: root, processEnv: env,
        fetchImpl: fetchFor(() => `${"正文".repeat(50)}\n===OUTLINE===\n梗概`),
        stdout: (t) => acceptedOut.push(t), stderr: () => {}
      });
      expect(accepted).toBe(0);
      expect(acceptedOut.join("\n")).toContain("package lock updated");
      const updated = JSON.parse(await readFile(path.join(root, ".feng", "runtime", "package-lock.json"), "utf8"));
      expect(updated.version).toBe("1.0.1");
    });
  });

  it("run --debug-report writes a summary-only runtime debug report", async () => {
    await withRoot(async (root) => {
      const dir = path.join(root, ".feng", "hatch");
      await mkdir(dir, { recursive: true });
      await mkdir(path.join(root, ".feng", "runtime"), { recursive: true });
      await writeFile(path.join(root, ".feng", "runtime", "project.json"), JSON.stringify({ premise: "p", title: "t" }), "utf8");
      await writeFile(path.join(dir, "xiaoshuo-runtime.json"), JSON.stringify({
        schemaVersion: "1.0.0", packageId: "pkg-x", name: "xiaoshuo", kind: "serialized_authoring_agent", version: "1.0.0",
        locked: true, runEntry: "feng run",
        targetWorld: { description: "d", inputKinds: ["premise"], outputKinds: ["chapter_text"], actionBoundary: [], failureHandling: [], dialogueAllowed: true },
        contextPolicy: [], writingStrategy: { systemPrompt: "debug package", stylePrinciples: [], constraints: [] },
        qualityRules: [{ kind: "length", minChars: 1, maxChars: 100000 }], feedbackRouting: [],
        validation: { readiness: "ready", grownInProject: "/x", evidenceSummary: "", checkedAt: "t" },
        provenance: { model: "m", provider: "deepseek", hatchedAt: "t" }
      }), "utf8");
      const out: string[] = [];
      const code = await runCli({
        argv: ["run", "--debug-report"],
        workspaceRoot: root, processEnv: env,
        fetchImpl: fetchFor(() => `李白使用手机支付。${"正文".repeat(50)}\n===OUTLINE===\n梗概`),
        stdout: (t) => out.push(t), stderr: () => {}
      });
      expect(code).toBe(0);
      expect(out.join("\n")).toContain("debug report: .feng/runtime/debug-reports/latest.json");
      const reportText = await readFile(path.join(root, ".feng", "runtime", "debug-reports", "latest.json"), "utf8");
      const report = JSON.parse(reportText);
      expect(report.kind).toBe("runtime_debug_report");
      expect(report.rawContentIncluded).toBe(false);
      expect(report.privacyBoundary).toBe("artifact_refs_and_summaries_only");
      expect(report.package.version).toBe("1.0.0");
      expect(report.package.contentHash.value.length).toBeGreaterThan(20);
      expect(report.chapters[0].messageListRef).toContain("message-list.json");
      expect(report.llmUsage.calls).toBeGreaterThan(0);
      expect(report.chapters[0].llmUsage.calls).toBeGreaterThan(0);
      expect(report.feedbackCandidates.some((candidate: { issueKind: string; source: string }) =>
        candidate.issueKind === "runtime_capability" && candidate.source === "debug_report"
      )).toBe(true);
      expect(reportText).not.toContain("李白使用手机支付");
    });
  });

  it("run --semantic-eval --debug-report exposes failed no-missing-topic gates from generated evidence", async () => {
    await withRoot(async (root) => {
      const dir = path.join(root, ".feng", "hatch");
      await mkdir(dir, { recursive: true });
      await mkdir(path.join(root, ".feng", "runtime"), { recursive: true });
      await writeFile(path.join(root, ".feng", "runtime", "project.json"), JSON.stringify({
        premise: "李白重生现代成都",
        title: "李白重生了",
        chapterGoals: ["写出李白第一次适应手机支付"]
      }), "utf8");
      await writeFile(path.join(dir, "xiaoshuo-runtime.json"), JSON.stringify({
        schemaVersion: "1.0.0", packageId: "pkg-x", name: "xiaoshuo", kind: "serialized_authoring_agent", version: "1.0.0",
        locked: true, runEntry: "feng run",
        targetWorld: { description: "d", inputKinds: ["premise", "title", "chapter_goal"], outputKinds: ["chapter_text", "updated_outline"], actionBoundary: [], failureHandling: [], dialogueAllowed: false },
        contextPolicy: [], writingStrategy: { systemPrompt: "debug package", stylePrinciples: [], constraints: [] },
        qualityRules: [{ kind: "length", minChars: 1, maxChars: 100000 }], feedbackRouting: [{ issueKind: "goal_coverage", layer: "capability", reason: "目标覆盖失败回流 agent 能力" }],
        validation: { readiness: "ready", grownInProject: "/x", evidenceSummary: "", checkedAt: "t" },
        provenance: { model: "m", provider: "deepseek", hatchedAt: "t" }
      }), "utf8");
      const out: string[] = [];
      const code = await runCli({
        argv: ["run", "--semantic-eval", "--debug-report"],
        workspaceRoot: root, processEnv: env,
        fetchImpl: withMissingGoalJudge(fetchFor(() => `李白在现代街头观察车流。${"正文".repeat(80)}\n===OUTLINE===\n第1章：李白观察现代城市`)),
        stdout: (t) => out.push(t), stderr: () => {}
      });
      expect(code).toBe(0);
      expect(out.join("\n")).toContain("debug report: .feng/runtime/debug-reports/latest.json");
      const reportText = await readFile(path.join(root, ".feng", "runtime", "debug-reports", "latest.json"), "utf8");
      const report = JSON.parse(reportText);
      expect(report.chapters[0].qualityGateBlockingCount).toBeGreaterThan(0);
      expect(report.chapters[0].qualityGateCandidateCount).toBeGreaterThan(0);
      expect(report.chapters[0].goalCoverageRef).toContain("goal-coverage-eval.json");
      expect(report.chapters[0].goalCoverageCovered).toBe(false);
      expect(report.feedbackCandidates.some((candidate: { issueKind: string; gateId?: string; qualityGateStatus?: string; source: string }) =>
        candidate.source === "debug_report" &&
        candidate.issueKind === "goal_coverage" &&
        candidate.gateId === "gate-chapter-goal-coverage" &&
        candidate.qualityGateStatus === "failed"
      )).toBe(true);
      expect(reportText).not.toContain("李白在现代街头观察车流");
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

  it("route-feedback defaults to the current workspace when --target is omitted", async () => {
    await withRoot(async (root) => {
      const out: string[] = [];
      const code = await runCli({ argv: ["route-feedback"], workspaceRoot: root, processEnv: env, fetchImpl: fetchFor(() => "x"), stdout: (t) => out.push(t), stderr: () => {} });
      expect(code).toBe(0);
      expect(out.join("\n")).toContain("[route-feedback] total=0");
    });
  });

  it("resolve-system-feedback writes an explicit feng-level resolution", async () => {
    await withRoot(async (root) => {
      await mkdir(path.join(root, ".feng", "system"), { recursive: true });
      await writeFile(path.join(root, ".feng", "system", "runtime-capability-evidence.json"), JSON.stringify({ implemented: true }), "utf8");
      const out: string[] = [];
      const code = await runCli({
        argv: ["resolve-system-feedback", "--issue-kind", "runtime_capability", "--reason", "kernel support implemented", "--evidence", ".feng/system/runtime-capability-evidence.json"],
        workspaceRoot: root, processEnv: env, stdout: (t) => out.push(t), stderr: () => {}
      });
      expect(code).toBe(0);
      expect(out.join("\n")).toContain("resolve-system-feedback");
      const resolution = JSON.parse(await readFile(path.join(root, ".feng", "grow-inbox", "system-feedback-resolution.json"), "utf8"));
      expect(resolution.kind).toBe("system_feedback_resolution");
      expect(resolution.decisions[0].issueKind).toBe("runtime_capability");
      expect(resolution.decisions[0].decision).toBe("resolved");
      expect(resolution.decisions[0].evidenceRefs).toEqual([".feng/system/runtime-capability-evidence.json"]);
    });
  });

  it("resolve-system-feedback refuses resolved decisions without evidence", async () => {
    await withRoot(async (root) => {
      const errors: string[] = [];
      const code = await runCli({
        argv: ["resolve-system-feedback", "--issue-kind", "runtime_capability", "--reason", "kernel support implemented"],
        workspaceRoot: root, processEnv: env, stdout: () => {}, stderr: (t) => errors.push(t)
      });
      expect(code).toBe(1);
      expect(errors.join("\n")).toContain("requires at least one --evidence file");
    });
  });

  it("review-work-gate records local evidence and clears a no-missing-topic gate", async () => {
    await withRoot(async (root) => {
      const dir = path.join(root, ".feng", "runtime", "chapters", "chapter-01");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "quality-gates.json"), JSON.stringify({
        schemaVersion: "1.0.0",
        kind: "work_project_quality_gate_set",
        generatedAt: "t",
        goal: "写出李白第一次适应手机支付",
        packageName: "xiaoshuo",
        packageVersion: "1.0.0",
        sampleRoundCount: 1,
        readiness: "pass",
        gates: [{
          gateId: "gate-chapter-goal-coverage",
          layer: "work",
          title: "本章目标不漏题",
          sourceRequirement: "写出李白第一次适应手机支付",
          evidenceRequired: "author review",
          status: "waiting_evidence",
          issueKinds: [],
          notes: []
        }],
        coverage: [{
          requirement: "chapter_goal:写出李白第一次适应手机支付",
          source: "work_project",
          status: "waiting_evidence",
          mappedGateIds: ["gate-chapter-goal-coverage"],
          notes: []
        }],
        summary: { totalGates: 1, passed: 0, failed: 0, waitingEvidence: 1, needsHumanJudgment: 0, uncoveredRequirements: 0, blockingCount: 1 }
      }), "utf8");
      await writeFile(path.join(dir, "trace.json"), JSON.stringify({
        chapterNumber: 1,
        qualityGateRef: ".feng/runtime/chapters/chapter-01/quality-gates.json",
        qualityGateSummary: "quality gates 0/1 passed; blocking=1; coverage_uncovered=0"
      }), "utf8");

      const out: string[] = [];
      const code = await runCli({
        argv: ["review-work-gate", "--chapter", "1", "--gate", "gate-chapter-goal-coverage", "--decision", "passed", "--reason", "章节已覆盖手机支付目标"],
        workspaceRoot: root, processEnv: env, stdout: (t) => out.push(t), stderr: () => {}
      });
      expect(code).toBe(0);
      expect(out.join("\n")).toContain("blocking=0");
      const gates = JSON.parse(await readFile(path.join(dir, "quality-gates.json"), "utf8"));
      expect(gates.gates[0].status).toBe("passed");
      expect(gates.coverage[0].status).toBe("covered");
      expect(gates.summary.blockingCount).toBe(0);
      const review = JSON.parse(await readFile(path.join(dir, "gate-review.json"), "utf8"));
      expect(review.gateId).toBe("gate-chapter-goal-coverage");
      expect(review.decision).toBe("passed");
      const trace = JSON.parse(await readFile(path.join(dir, "trace.json"), "utf8"));
      expect(trace.qualityGateSummary).toContain("blocking=0");
      expect(trace.qualityGateReviewRef).toBe(".feng/runtime/chapters/chapter-01/gate-review.json");
      expect(trace.qualityGateReviewedDecision).toBe("passed");

      const routeOut: string[] = [];
      const routed = await runCli({
        argv: ["route-feedback", "--target", root],
        workspaceRoot: root, processEnv: env, stdout: (t) => routeOut.push(t), stderr: () => {}
      });
      expect(routed).toBe(0);
      expect(routeOut.join("\n")).toContain("total=0");
    });
  });

  it("author-feedback records a local task, feedback candidate, gate, and trace", async () => {
    await withRoot(async (root) => {
      await mkdir(path.join(root, ".feng", "runtime"), { recursive: true });
      await writeFile(path.join(root, ".feng", "runtime", "project.json"), JSON.stringify({ premise: "李白重生", title: "李白重生了" }), "utf8");
      const out: string[] = [];
      const code = await runCli({
        argv: [
          "author-feedback",
          "--chapter", "1",
          "--text", "这里没有写出手机支付的尴尬冲突",
          "--issue-kind", "semantic_plot",
          "--layer", "capability",
          "--action", "下一章补写具体冲突"
        ],
        workspaceRoot: root,
        processEnv: env,
        stdout: (t) => out.push(t),
        stderr: () => {}
      });
      expect(code).toBe(0);
      expect(out.join("\n")).toContain("[author-feedback]");
      const dir = path.join(root, ".feng", "runtime", "chapters", "chapter-01");
      const authorFeedback = JSON.parse(await readFile(path.join(dir, "author-feedback.json"), "utf8"));
      expect(authorFeedback.feedback[0].content).toContain("手机支付");
      expect(authorFeedback.feedback[0].status).toBe("open");
      const feedback = JSON.parse(await readFile(path.join(dir, "feedback.json"), "utf8"));
      expect(feedback.candidates[0].source).toBe("author_feedback");
      expect(feedback.byLayer.capability).toBe(1);
      const gates = JSON.parse(await readFile(path.join(dir, "quality-gates.json"), "utf8"));
      expect(gates.gates[0].status).toBe("waiting_evidence");
      expect(gates.summary.blockingCount).toBe(1);
      const trace = JSON.parse(await readFile(path.join(dir, "trace.json"), "utf8"));
      expect(trace.authorFeedbackRefs[0]).toContain("author-feedback-ch01-01");

      const reviewOut: string[] = [];
      const reviewed = await runCli({
        argv: ["review-work-gate", "--chapter", "1", "--gate", authorFeedback.feedback[0].gateId, "--decision", "passed", "--reason", "作者确认已补写具体冲突"],
        workspaceRoot: root,
        processEnv: env,
        stdout: (t) => reviewOut.push(t),
        stderr: () => {}
      });
      expect(reviewed).toBe(0);
      expect(reviewOut.join("\n")).toContain("author feedback:");
      const resolved = JSON.parse(await readFile(path.join(dir, "author-feedback.json"), "utf8"));
      expect(resolved.feedback[0].status).toBe("resolved");
      expect(resolved.feedback[0].resolutionReason).toBe("作者确认已补写具体冲突");
      expect(resolved.feedback[0].resolutionRef).toBe(".feng/runtime/chapters/chapter-01/gate-review.json");
      expect(resolved.feedback[0].lastReviewDecision).toBe("passed");
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
        expect(out.join("\n")).toContain("capability digest: .feng/grow-inbox/capability-feedback.json");
      } finally {
        await rm(agent, { recursive: true, force: true });
      }
    });
  });

  it("route-feedback infers the agent project from the installed runtime receipt", async () => {
    await withRoot(async (agent) => {
      const work = await mkdtemp(path.join(tmpdir(), "feng-rf-cli-work-"));
      try {
        await mkdir(path.join(agent, ".feng", "hatch"), { recursive: true });
        await writeFile(path.join(agent, ".feng", "hatch", "xiaoshuo-runtime.json"), JSON.stringify(runtimePackage()), "utf8");
        const installed = await runCli({
          argv: ["install-runtime", "--from", agent],
          workspaceRoot: work,
          processEnv: env,
          stdout: () => {},
          stderr: () => {}
        });
        expect(installed).toBe(0);

        const dir = path.join(work, ".feng", "runtime", "chapters", "chapter-01");
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, "feedback.json"), JSON.stringify({ candidates: [
          { issueKind: "semantic_plot", layer: "capability", severity: "warning", detail: "情节没有推进", routingReason: "回流", chapterNumber: 1 }
        ] }), "utf8");

        const out: string[] = [];
        const code = await runCli({
          argv: ["route-feedback"],
          workspaceRoot: work,
          processEnv: env,
          stdout: (t) => out.push(t),
          stderr: () => {}
        });
        expect(code).toBe(0);
        expect(out.join("\n")).toContain("capability->agent=1");
        expect(out.join("\n")).toContain(`inferred agent: ${agent}`);
        const digest = JSON.parse(await readFile(path.join(agent, ".feng", "grow-inbox", "capability-feedback.json"), "utf8"));
        expect(digest.issueKinds).toEqual(["semantic_plot"]);
        expect(digest.details[0].detail).toBe("情节没有推进");
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    });
  });

  it("route-feedback falls back to runtime package grownInProject when install receipt is absent", async () => {
    await withRoot(async (agent) => {
      const work = await mkdtemp(path.join(tmpdir(), "feng-rf-cli-work-"));
      try {
        await mkdir(path.join(work, ".feng", "hatch"), { recursive: true });
        await writeFile(path.join(work, ".feng", "hatch", "xiaoshuo-runtime.json"), JSON.stringify(runtimePackage({ grownInProject: agent })), "utf8");
        const dir = path.join(work, ".feng", "runtime", "chapters", "chapter-01");
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, "feedback.json"), JSON.stringify({ candidates: [
          { issueKind: "semantic_character", layer: "capability", severity: "warning", detail: "人物动机不稳定", routingReason: "回流", chapterNumber: 1 }
        ] }), "utf8");

        const out: string[] = [];
        const code = await runCli({
          argv: ["route-feedback"],
          workspaceRoot: work,
          processEnv: env,
          stdout: (t) => out.push(t),
          stderr: () => {}
        });
        expect(code).toBe(0);
        expect(out.join("\n")).toContain("capability->agent=1");
        expect(out.join("\n")).toContain(`inferred agent: ${agent}`);
        const digest = JSON.parse(await readFile(path.join(agent, ".feng", "grow-inbox", "capability-feedback.json"), "utf8"));
        expect(digest.issueKinds).toEqual(["semantic_character"]);
        expect(digest.details[0].detail).toBe("人物动机不稳定");
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    });
  });

  it("route-feedback infers the feng project from the installed runtime receipt for system feedback", async () => {
    await withRoot(async (agent) => {
      const work = await mkdtemp(path.join(tmpdir(), "feng-rf-cli-work-"));
      const feng = await mkdtemp(path.join(tmpdir(), "feng-rf-cli-feng-"));
      try {
        await mkdir(path.join(agent, ".feng", "hatch"), { recursive: true });
        await writeFile(path.join(agent, ".feng", "hatch", "xiaoshuo-runtime.json"), JSON.stringify(runtimePackage()), "utf8");
        const installed = await runCli({
          argv: ["install-runtime", "--from", agent, "--feng-dir", feng],
          workspaceRoot: work,
          processEnv: env,
          stdout: () => {},
          stderr: () => {}
        });
        expect(installed).toBe(0);
        const receipt = JSON.parse(await readFile(path.join(work, ".feng", "runtime", "package-install.json"), "utf8"));
        expect(receipt.systemWorkspaceRoot).toBe(feng);

        const dir = path.join(work, ".feng", "runtime", "chapters", "chapter-01");
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, "feedback.json"), JSON.stringify({ candidates: [
          { issueKind: "runtime_capability", layer: "system", severity: "warning", detail: "runtime kernel 不支持某输入", routingReason: "系统能力缺口", chapterNumber: 1 }
        ] }), "utf8");

        const out: string[] = [];
        const code = await runCli({
          argv: ["route-feedback"],
          workspaceRoot: work,
          processEnv: env,
          stdout: (t) => out.push(t),
          stderr: () => {}
        });
        expect(code).toBe(0);
        expect(out.join("\n")).toContain("system->feng=1");
        expect(out.join("\n")).toContain(`inferred feng: ${feng}`);
        const digest = JSON.parse(await readFile(path.join(feng, ".feng", "grow-inbox", "system-feedback.json"), "utf8"));
        expect(digest.issueKinds).toEqual(["runtime_capability"]);
        expect(digest.details[0].detail).toContain("runtime kernel");
      } finally {
        await rm(work, { recursive: true, force: true });
        await rm(feng, { recursive: true, force: true });
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
      const code = await runCli({ argv: ["grow-agent", "--loop", "--goal", "成长小说 agent", "--rounds", "2", "--sample-chapters", "2"], workspaceRoot: root, processEnv: env, fetchImpl: withJudges(loopFetch), stdout: (t) => out.push(t), stderr: () => {} });
      expect(code).toBe(0);
      const joined = out.join("\n");
      expect(joined).toContain("[grow-agent --loop]");
      expect(joined).toContain("round 1");
      expect(joined).toContain("improved=true");
    });
  });
});

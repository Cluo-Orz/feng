import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFengHost, superviseNovel, detectIssues, runCli } from "../../src/host/index.js";
import type { NovelState } from "../../src/host/index.js";

const provider = { provider: "deepseek", apiKey: "test-key", baseUrl: "https://api.deepseek.com", model: "m", maxTokens: 256, reasoningModel: true };

async function withRoots(body: (supervisor: string, target: string) => Promise<void>): Promise<void> {
  const supervisor = await mkdtemp(path.join(tmpdir(), "feng-sup-"));
  const target = await mkdtemp(path.join(tmpdir(), "feng-tgt-"));
  try {
    await body(supervisor, target);
  } finally {
    await rm(supervisor, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
}

async function seedTargetState(target: string, state: NovelState): Promise<void> {
  const dir = path.join(target, ".feng", "xiaoshuo");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "novel-state.json"), JSON.stringify(state), "utf8");
}

describe("supervisor detectIssues", () => {
  it("flags a not-started target", () => {
    expect(detectIssues(undefined, 800)[0]?.kind).toBe("not_started");
    expect(detectIssues({ premise: "p", title: "t", chapters: [] }, 800)[0]?.kind).toBe("not_started");
  });

  it("flags short chapters, logged self-repairs and continuity gaps", () => {
    const state: NovelState = {
      premise: "p", title: "t",
      chapters: [
        { number: 1, outline: "o1", path: "c1", chars: 200 },
        { number: 3, outline: "o3", path: "c3", chars: 1200, issues: ["第3章第1稿仅100字"] }
      ]
    };
    const issues = detectIssues(state, 800);
    expect(issues.some((i) => i.kind === "too_short" && i.chapter === 1)).toBe(true);
    expect(issues.some((i) => i.kind === "self_repair_logged" && i.chapter === 3)).toBe(true);
    expect(issues.some((i) => i.kind === "continuity_gap" && i.chapter === 3)).toBe(true);
  });

  it("returns no issues for a healthy novel", () => {
    const state: NovelState = {
      premise: "p", title: "t",
      chapters: [
        { number: 1, outline: "o1", path: "c1", chars: 1200 },
        { number: 2, outline: "o2", path: "c2", chars: 1300 }
      ]
    };
    expect(detectIssues(state, 800)).toHaveLength(0);
  });
});

describe("superviseNovel", () => {
  it("collects inner-feng issues through Admission as feedback candidates", async () => {
    await withRoots(async (supervisor, target) => {
      await seedTargetState(target, { premise: "p", title: "李白重生了", chapters: [{ number: 1, outline: "o", path: "c1", chars: 100 }] });
      const host = await createFengHost({ config: { workspaceRoot: supervisor, provider } });
      const report = await superviseNovel(host, { targetRoot: target, minChars: 800 });
      expect(report.ok).toBe(true);
      if (!report.ok) throw new Error(report.error.message);
      expect(report.value.chaptersFound).toBe(1);
      expect(report.value.issues.length).toBeGreaterThanOrEqual(1);
      expect(report.value.growUnitRef).toBeDefined();
      expect(report.value.inboxItemIds.length).toBeGreaterThanOrEqual(1);
      expect(report.value.feedbackCandidateCount).toBeGreaterThanOrEqual(1);
    });
  });

  it("reports a not-started target with no admission churn", async () => {
    await withRoots(async (supervisor, target) => {
      const host = await createFengHost({ config: { workspaceRoot: supervisor, provider } });
      const report = await superviseNovel(host, { targetRoot: target });
      expect(report.ok).toBe(true);
      if (report.ok) {
        expect(report.value.issues[0]?.kind).toBe("not_started");
        expect(report.value.growUnitRef).toBeDefined();
      }
    });
  });
});

describe("runCli supervise", () => {
  it("requires a --target", async () => {
    await withRoots(async (supervisor) => {
      const errors: string[] = [];
      const code = await runCli({
        argv: ["supervise"],
        workspaceRoot: supervisor,
        processEnv: { DEEPSEEK_API_KEY: "k", MODEL: "m" },
        stdout: () => {},
        stderr: (t) => errors.push(t)
      });
      expect(code).toBe(2);
      expect(errors.join(" ")).toContain("--target");
    });
  });

  it("reports issues for a seeded target", async () => {
    await withRoots(async (supervisor, target) => {
      await seedTargetState(target, { premise: "p", title: "t", chapters: [{ number: 1, outline: "o", path: "c1", chars: 100 }] });
      const out: string[] = [];
      const code = await runCli({
        argv: ["supervise", "--target", target, "--min-chars", "800"],
        workspaceRoot: supervisor,
        processEnv: { DEEPSEEK_API_KEY: "k", MODEL: "m" },
        stdout: (t) => out.push(t),
        stderr: () => {}
      });
      expect(code).toBe(0);
      expect(out.join("\n")).toContain("[supervise]");
      expect(out.join("\n")).toContain("too_short");
    });
  });
});

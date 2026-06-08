import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFengHost, routeProjectFeedback } from "../../src/host/index.js";

const provider = { provider: "deepseek", apiKey: "k", baseUrl: "https://api.deepseek.com", model: "m", maxTokens: 256, reasoningModel: true };

async function withRoots(body: (work: string, agent: string, feng: string) => Promise<void>): Promise<void> {
  const work = await mkdtemp(path.join(tmpdir(), "feng-rf-work-"));
  const agent = await mkdtemp(path.join(tmpdir(), "feng-rf-agent-"));
  const feng = await mkdtemp(path.join(tmpdir(), "feng-rf-feng-"));
  try {
    await body(work, agent, feng);
  } finally {
    for (const d of [work, agent, feng]) await rm(d, { recursive: true, force: true });
  }
}

async function seedFeedback(root: string, chapter: number, candidates: unknown[]): Promise<void> {
  const dir = path.join(root, ".feng", "runtime", "chapters", `chapter-0${chapter}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "feedback.json"), JSON.stringify({ candidates, byLayer: {} }), "utf8");
}

describe("routeProjectFeedback", () => {
  it("keeps work facts local and absorbs capability/system upstream", async () => {
    await withRoots(async (work, agent, feng) => {
      await seedFeedback(work, 1, [
        { issueKind: "length", layer: "work", severity: "warning", detail: "字数", routingReason: "本地", chapterNumber: 1 },
        { issueKind: "character_continuation", layer: "capability", severity: "warning", detail: "人物", routingReason: "回流", chapterNumber: 1 },
        { issueKind: "artifact_presence", layer: "system", severity: "error", detail: "trace缺失", routingReason: "feng", chapterNumber: 1 }
      ]);
      const workHost = await createFengHost({ config: { workspaceRoot: work, provider } });
      const agentHost = await createFengHost({ config: { workspaceRoot: agent, provider } });
      const fengHost = await createFengHost({ config: { workspaceRoot: feng, provider } });
      const result = await routeProjectFeedback({ workHost, agentHost, fengHost });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.totalCandidates).toBe(3);
      expect(result.value.keptLocal).toBe(1);
      expect(result.value.absorbedToAgent).toBe(1);
      expect(result.value.absorbedToFeng).toBe(1);
      expect(result.value.byLayer).toEqual({ work: 1, capability: 1, system: 1 });
      // capability digest is written file-native into the agent workspace
      const digest = JSON.parse(await readFile(path.join(agent, ".feng", "grow-inbox", "capability-feedback.json"), "utf8"));
      expect(digest.issueKinds).toContain("character_continuation");
      expect(digest.count).toBe(1);
    });
  });

  it("returns zero when there are no chapter feedback files", async () => {
    await withRoots(async (work) => {
      const workHost = await createFengHost({ config: { workspaceRoot: work, provider } });
      const result = await routeProjectFeedback({ workHost });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.totalCandidates).toBe(0);
    });
  });

  it("does not push work facts upstream when only work issues exist", async () => {
    await withRoots(async (work, agent) => {
      await seedFeedback(work, 1, [{ issueKind: "length", layer: "work", severity: "warning", detail: "字数", routingReason: "本地", chapterNumber: 1 }]);
      const workHost = await createFengHost({ config: { workspaceRoot: work, provider } });
      const agentHost = await createFengHost({ config: { workspaceRoot: agent, provider } });
      const result = await routeProjectFeedback({ workHost, agentHost });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.absorbedToAgent).toBe(0);
    });
  });
});

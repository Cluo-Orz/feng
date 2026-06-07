import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFengHost, runCli } from "../../src/host/index.js";
import { makeLLMRequestId } from "../../src/llm-gateway/index.js";
import { makePolicyRequestId } from "../../src/policy-boundary/index.js";
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
  const root = await mkdtemp(path.join(tmpdir(), "feng-host-test-"));
  try {
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const okFetch: FetchLike = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    id: "resp-1",
    model: "deepseek-v4-pro",
    choices: [{ message: { content: "pong", reasoning_content: "thinking" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 }
  }),
  text: async () => ""
});

describe("feng host", () => {
  it("wires every module and runs a file-native CLI command", async () => {
    await withRoot(async (root) => {
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: okFetch });
      const created = await host.cli.run(["grow", "create", "--title", "Novel", "--goal", "write", "--target", "xiaoshuo"]);
      expect(created.ok).toBe(true);
      if (created.ok) expect(created.value.exitStatus).toBe("succeeded");
      const list = await host.cli.run(["grow", "list"]);
      expect(list.ok).toBe(true);
      if (list.ok) expect(list.value.data?.["total"]).toBe(1);
    });
  });

  it("performs a gateway round-trip through the wired adapter", async () => {
    await withRoot(async (root) => {
      const host = await createFengHost({ config: { workspaceRoot: root, provider }, fetchImpl: okFetch });
      const now = new Date().toISOString();
      const source = { kind: "system" as const, origin: "test", userProvided: false, receivedAt: now, privacyLevel: "workspace_private" as const };
      const decision = await host.policy.evaluateAction({
        requestId: makePolicyRequestId("host-net"),
        capability: "network.request",
        requestedByModule: "llm-gateway",
        workspace: host.workspace.id,
        resourceSummary: "provider:deepseek",
        operation: "send",
        reason: "test",
        source
      }, {
        caller: "llm-gateway",
        environment: { hostSandboxAvailable: false, networkAvailable: true, externalEnforcementAvailable: false, secretStoreAvailable: false },
        rules: [{ capability: "network.request", resource: "*", verdict: "allow" }]
      });
      if (!decision.ok) throw new Error(decision.error.message);
      const result = await host.llmGateway.sendLLMRequest({
        requestId: makeLLMRequestId("host-req-1"),
        providerNeutralMessages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
        modelSelection: { provider: "deepseek", model: "deepseek-v4-pro" },
        requiredCapabilities: {},
        streaming: false,
        policyDecisionId: decision.value.policyDecisionId,
        source,
        version: { schemaVersion: "1.0.0" },
        audit: { createdAt: now, createdBy: "test", reason: "round trip" }
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.finishReason).toBe("stop");
        expect(result.value.contentBlocks.some((b) => b.type === "text")).toBe(true);
      }
    });
  });

  it("runCli returns a config error code when no api key is configured", async () => {
    await withRoot(async (root) => {
      const errors: string[] = [];
      const code = await runCli({
        argv: ["grow", "list"],
        workspaceRoot: root,
        processEnv: {},
        stdout: () => {},
        stderr: (t) => errors.push(t)
      });
      expect(code).toBe(78);
      expect(errors.join(" ")).toContain("config error");
    });
  });

  it("runCli runs an offline command and prints rendered output", async () => {
    await withRoot(async (root) => {
      const out: string[] = [];
      const code = await runCli({
        argv: ["grow", "list"],
        workspaceRoot: root,
        processEnv: { DEEPSEEK_API_KEY: "k", MODEL: "deepseek-v4-pro" },
        stdout: (t) => out.push(t),
        stderr: () => {}
      });
      expect(code).toBe(0);
      expect(out.join("\n")).toContain("grow unit");
    });
  });
});

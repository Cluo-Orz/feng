import { describe, expect, it } from "vitest";
import { makeToolExecutionId } from "../../src/tool-runtime/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import {
  echoImplementation,
  implementationCalls,
  makeToolRuntimeFixture,
  policyContext,
  readJsonArtifact,
  registerEchoTool,
  toolRequest
} from "./helpers.js";
import type { ToolExecutionReceipt, ToolImplementation, ToolSettlement } from "../../src/tool-runtime/index.js";

describe("Tool Runtime execution flow", () => {
  it("executes an active tool and archives result, receipt, and settlement artifacts", async () => {
    await withWorkspace(async (workspace) => {
      const implementation = echoImplementation();
      const fixture = makeToolRuntimeFixture(workspace, [implementation]);
      const tool = await fixture.runtime.registerTool(registerEchoTool(fixture));
      expect(tool.ok).toBe(true);
      if (!tool.ok) throw new Error(tool.error.message);

      const settlement = await fixture.runtime.executeTool(
        toolRequest(fixture, tool.value, { correlationId: "corr-success" }),
        { policyContext: policyContext("allow") }
      );
      expect(settlement.ok).toBe(true);
      if (!settlement.ok) throw new Error(settlement.error.message);
      expect(settlement.value.status).toBe("settled_success");
      expect(settlement.value.resultPreview).toContain("echo:hello");
      expect(implementationCalls(implementation)).toBe(1);

      const resultRecord = await fixture.artifacts.resolveArtifact(settlement.value.resultArtifactRef!);
      expect(resultRecord.ok).toBe(true);
      if (!resultRecord.ok) throw new Error(resultRecord.error.message);
      expect(resultRecord.value.kind).toBe("tool_result");

      const receipt = await fixture.runtime.readToolExecutionReceipt(settlement.value.executionReceiptRef!);
      expect(receipt.ok).toBe(true);
      if (!receipt.ok) throw new Error(receipt.error.message);
      expect(receipt.value.status).toBe("succeeded");
      expect(receipt.value.outputArtifactRef?.kind).toBe("artifact");

      const storedSettlement = await fixture.runtime.readToolSettlement(settlement.value.settlementRef!);
      expect(storedSettlement.ok).toBe(true);
      if (!storedSettlement.ok) throw new Error(storedSettlement.error.message);
      expect(storedSettlement.value.visibleToModelSummary).toContain("echo:hello");
    });
  });

  it("redacts archived output when policy requires redaction", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeToolRuntimeFixture(workspace);
      const tool = await fixture.runtime.registerTool(registerEchoTool(fixture));
      expect(tool.ok).toBe(true);
      if (!tool.ok) throw new Error(tool.error.message);

      const settlement = await fixture.runtime.executeTool(
        toolRequest(fixture, tool.value),
        { policyContext: policyContext("allow_with_redaction") }
      );
      expect(settlement.ok).toBe(true);
      if (!settlement.ok) throw new Error(settlement.error.message);
      expect(settlement.value.resultPreview).toContain("redacted");
      const result = await readJsonArtifact<Record<string, unknown>>(fixture, settlement.value.resultArtifactRef!);
      expect(result["stdout"]).toBe("[redacted by policy]");
    });
  });

  it("turns output schema mismatches into failed receipts", async () => {
    await withWorkspace(async (workspace) => {
      const badOutput: ToolImplementation = {
        implementationId: "echo",
        execute: () => ({ structuredOutput: { wrong: true } })
      };
      const fixture = makeToolRuntimeFixture(workspace, [badOutput]);
      const tool = await fixture.runtime.registerTool(registerEchoTool(fixture));
      expect(tool.ok).toBe(true);
      if (!tool.ok) throw new Error(tool.error.message);

      const settlement = await fixture.runtime.executeTool(
        toolRequest(fixture, tool.value),
        { policyContext: policyContext("allow") }
      );
      expect(settlement.ok).toBe(true);
      if (!settlement.ok) throw new Error(settlement.error.message);
      expect(settlement.value.status).toBe("settled_failure");
      expect(settlement.value.error?.code).toBe("output_invalid");
    });
  });

  it("settles long running tools as timed out", async () => {
    await withWorkspace(async (workspace) => {
      const slow: ToolImplementation = {
        implementationId: "echo",
        execute: () => new Promise((resolve) => setTimeout(() => resolve({ stdout: "late" }), 100))
      };
      const fixture = makeToolRuntimeFixture(workspace, [slow]);
      const tool = await fixture.runtime.registerTool(registerEchoTool(fixture));
      expect(tool.ok).toBe(true);
      if (!tool.ok) throw new Error(tool.error.message);

      const settlement = await fixture.runtime.executeTool(
        toolRequest(fixture, tool.value),
        { policyContext: policyContext("allow"), timeoutMs: 5 }
      );
      expect(settlement.ok).toBe(true);
      if (!settlement.ok) throw new Error(settlement.error.message);
      expect(settlement.value.status).toBe("timed_out");
      expect(settlement.value.error?.code).toBe("timeout");
    });
  });

  it("cancels an in-flight execution and leaves final settlement to the execution flow", async () => {
    await withWorkspace(async (workspace) => {
      let started!: () => void;
      const startedPromise = new Promise<void>((resolve) => { started = resolve; });
      const waiting: ToolImplementation = {
        implementationId: "echo",
        execute: ({ signal }) => new Promise((resolve, reject) => {
          started();
          signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
          setTimeout(() => resolve({ stdout: "done" }), 200);
        })
      };
      const fixture = makeToolRuntimeFixture(workspace, [waiting]);
      const tool = await fixture.runtime.registerTool(registerEchoTool(fixture));
      expect(tool.ok).toBe(true);
      if (!tool.ok) throw new Error(tool.error.message);
      const executionId = makeToolExecutionId("tool-execution-cancel-test");

      const running = fixture.runtime.executeTool(
        toolRequest(fixture, tool.value),
        { policyContext: policyContext("allow"), executionId, timeoutMs: 200 }
      );
      await startedPromise;
      const cancelled = await fixture.runtime.cancelToolExecution(executionId, "unit test cancel");
      expect(cancelled.ok).toBe(true);
      const settlement = await running;
      expect(settlement.ok).toBe(true);
      if (!settlement.ok) throw new Error(settlement.error.message);
      expect(settlement.value.status).toBe("cancelled");
    });
  });

  it("rejects concurrent execution when the tool is already active", async () => {
    await withWorkspace(async (workspace) => {
      let release!: () => void;
      let started!: () => void;
      const startedPromise = new Promise<void>((resolve) => { started = resolve; });
      const blocking: ToolImplementation = {
        implementationId: "echo",
        execute: () => new Promise((resolve) => {
          started();
          release = () => resolve({ stdout: "first", structuredOutput: { echoed: "first" } });
        })
      };
      const fixture = makeToolRuntimeFixture(workspace, [blocking]);
      const tool = await fixture.runtime.registerTool(registerEchoTool(fixture));
      expect(tool.ok).toBe(true);
      if (!tool.ok) throw new Error(tool.error.message);

      const first = fixture.runtime.executeTool(
        toolRequest(fixture, tool.value),
        { policyContext: policyContext("allow"), timeoutMs: 500 }
      );
      await startedPromise;
      const second = await fixture.runtime.executeTool(
        toolRequest(fixture, tool.value),
        { policyContext: policyContext("allow"), timeoutMs: 500 }
      );
      release();
      expect(second.ok).toBe(true);
      if (!second.ok) throw new Error(second.error.message);
      expect(second.value.status).toBe("unavailable");
      const firstSettlement = await first;
      expect(firstSettlement.ok).toBe(true);
    });
  });

  it("settles unavailable when implementation is missing or declared as none", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeToolRuntimeFixture(workspace, []);
      const missing = await fixture.runtime.registerTool(registerEchoTool(fixture, {
        implementation: { kind: "host_function", implementationId: "missing" }
      }));
      expect(missing.ok).toBe(true);
      if (!missing.ok) throw new Error(missing.error.message);
      const missingSettlement = await fixture.runtime.executeTool(
        toolRequest(fixture, missing.value),
        { policyContext: policyContext("allow") }
      );
      expect(missingSettlement.ok).toBe(true);
      if (!missingSettlement.ok) throw new Error(missingSettlement.error.message);
      expect(missingSettlement.value.status).toBe("unavailable");

      const none = await fixture.runtime.registerTool(registerEchoTool(fixture, {
        name: "none",
        implementation: { kind: "none", implementationId: "none" }
      }));
      expect(none.ok).toBe(true);
      if (!none.ok) throw new Error(none.error.message);
      const noneSettlement = await fixture.runtime.executeTool(
        toolRequest(fixture, none.value),
        { policyContext: policyContext("allow") }
      );
      expect(noneSettlement.ok).toBe(true);
      if (!noneSettlement.ok) throw new Error(noneSettlement.error.message);
      expect(noneSettlement.value.status).toBe("unavailable");
    });
  });

  it("queues concurrent execution when queueWhenBusy is enabled", async () => {
    await withWorkspace(async (workspace) => {
      let release!: () => void;
      let firstStarted!: () => void;
      const firstStartedPromise = new Promise<void>((resolve) => { firstStarted = resolve; });
      let calls = 0;
      const queued: ToolImplementation = {
        implementationId: "echo",
        execute: () => {
          calls += 1;
          if (calls === 1) {
            firstStarted();
            return new Promise((resolve) => {
              release = () => resolve({ stdout: "first", structuredOutput: { echoed: "first" } });
            });
          }
          return { stdout: "second", structuredOutput: { echoed: "second" } };
        }
      };
      const fixture = makeToolRuntimeFixture(workspace, [queued]);
      const tool = await fixture.runtime.registerTool(registerEchoTool(fixture, {
        concurrency: { maxConcurrentPerTool: 1, queueWhenBusy: true }
      }));
      expect(tool.ok).toBe(true);
      if (!tool.ok) throw new Error(tool.error.message);

      const first = fixture.runtime.executeTool(
        toolRequest(fixture, tool.value),
        { policyContext: policyContext("allow"), timeoutMs: 300 }
      );
      await firstStartedPromise;
      const second = fixture.runtime.executeTool(
        toolRequest(fixture, tool.value),
        { policyContext: policyContext("allow"), timeoutMs: 300 }
      );
      release();
      const secondSettlement = await second;
      expect(secondSettlement.ok).toBe(true);
      if (!secondSettlement.ok) throw new Error(secondSettlement.error.message);
      expect(secondSettlement.value.status).toBe("settled_success");
      expect((await first).ok).toBe(true);
    });
  });

  it("times out while waiting for a queued concurrency slot", async () => {
    await withWorkspace(async (workspace) => {
      let started!: () => void;
      const startedPromise = new Promise<void>((resolve) => { started = resolve; });
      let release!: () => void;
      const releasePromise = new Promise<void>((resolve) => { release = resolve; });
      const blocking: ToolImplementation = {
        implementationId: "echo",
        execute: async () => {
          started();
          await releasePromise;
          return { stdout: "late", structuredOutput: { echoed: "late" } };
        }
      };
      const fixture = makeToolRuntimeFixture(workspace, [blocking]);
      const tool = await fixture.runtime.registerTool(registerEchoTool(fixture, {
        concurrency: { maxConcurrentPerTool: 1, queueWhenBusy: true },
        timeout: { defaultMs: 1_000, maxMs: 1_000 }
      }));
      expect(tool.ok).toBe(true);
      if (!tool.ok) throw new Error(tool.error.message);

      const first = fixture.runtime.executeTool(
        toolRequest(fixture, tool.value),
        { policyContext: policyContext("allow"), timeoutMs: 1_000 }
      );
      await startedPromise;
      const second = await fixture.runtime.executeTool(
        toolRequest(fixture, tool.value),
        { policyContext: policyContext("allow"), timeoutMs: 20 }
      );
      expect(second.ok).toBe(true);
      if (!second.ok) throw new Error(second.error.message);
      expect(second.value.status).toBe("unavailable");
      expect(second.value.error?.code).toBe("timeout");
      release();
      await first;
    });
  });

  it("materializes settlement artifacts as normal JSON", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeToolRuntimeFixture(workspace);
      const tool = await fixture.runtime.registerTool(registerEchoTool(fixture));
      expect(tool.ok).toBe(true);
      if (!tool.ok) throw new Error(tool.error.message);

      const settlement = await fixture.runtime.executeTool(
        toolRequest(fixture, tool.value),
        { policyContext: policyContext("allow") }
      );
      expect(settlement.ok).toBe(true);
      if (!settlement.ok) throw new Error(settlement.error.message);
      const stored = await readJsonArtifact<ToolSettlement>(fixture, settlement.value.settlementRef!);
      expect(stored.toolCallId).toBe(settlement.value.toolCallId);
      const receipt = await readJsonArtifact<ToolExecutionReceipt>(fixture, settlement.value.executionReceiptRef!);
      expect(receipt.status).toBe("succeeded");
    });
  });
});

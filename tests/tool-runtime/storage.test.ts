import { describe, expect, it } from "vitest";
import { makeArtifactId, makeRef, makeToolId, type ArtifactRef, type ToolRef } from "../../src/domain/index.js";
import { ok } from "../../src/domain/result.js";
import {
  makeToolExecutionId,
  makeToolInputValidationId,
  makeToolSettlementId,
  ToolRuntimeStorage,
  toolExecutionReceiptPath,
  toolRecordPath,
  toolSettlementPath,
  toolValidationPath
} from "../../src/tool-runtime/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import {
  makeToolRuntimeFixture,
  registerEchoTool
} from "./helpers.js";

describe("Tool Runtime storage", () => {
  it("returns domain errors for missing records", async () => {
    await withWorkspace(async (workspace) => {
      const storage = new ToolRuntimeStorage(workspace.store, workspace.workspace);
      const toolRef = makeRef("tool", makeToolId("missing-tool")) as ToolRef;
      expect((await storage.readTool(toolRef)).ok).toBe(false);
      expect((await storage.readValidation(makeToolInputValidationId("missing-validation"))).ok).toBe(false);
      expect((await storage.readExecutionReceipt(makeToolExecutionId("missing-execution"))).ok).toBe(false);
      expect((await storage.readSettlement(makeToolSettlementId("missing-settlement"))).ok).toBe(false);
    });
  });

  it("reports schema-incompatible storage JSON", async () => {
    await withWorkspace(async (workspace) => {
      const storage = new ToolRuntimeStorage(workspace.store, workspace.workspace);
      const toolId = makeToolId("bad-tool");
      const toolRef = makeRef("tool", toolId) as ToolRef;
      await workspace.store.writeTextAtomic(workspace.workspace, toolRecordPath(toolId), "{bad", {
        reason: "bad tool json",
        createParents: true
      });
      await workspace.store.writeTextAtomic(workspace.workspace, toolValidationPath(makeToolInputValidationId("bad-validation")), "{bad", {
        reason: "bad validation json",
        createParents: true
      });
      await workspace.store.writeTextAtomic(workspace.workspace, toolExecutionReceiptPath(makeToolExecutionId("bad-execution")), "{bad", {
        reason: "bad execution json",
        createParents: true
      });
      await workspace.store.writeTextAtomic(workspace.workspace, toolSettlementPath(makeToolSettlementId("bad-settlement")), "{bad", {
        reason: "bad settlement json",
        createParents: true
      });

      expect((await storage.readTool(toolRef)).ok).toBe(false);
      expect((await storage.readValidation(makeToolInputValidationId("bad-validation"))).ok).toBe(false);
      expect((await storage.readExecutionReceipt(makeToolExecutionId("bad-execution"))).ok).toBe(false);
      expect((await storage.readSettlement(makeToolSettlementId("bad-settlement"))).ok).toBe(false);
    });
  });

  it("keeps tool index idempotent and skips missing indexed records", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeToolRuntimeFixture(workspace);
      const tool = await fixture.runtime.registerTool(registerEchoTool(fixture));
      expect(tool.ok).toBe(true);
      if (!tool.ok) throw new Error(tool.error.message);
      const storage = new ToolRuntimeStorage(workspace.store, workspace.workspace);
      const duplicate = await storage.addToolToIndex(tool.value);
      expect(duplicate.ok).toBe(true);
      const missing = makeRef("tool", makeToolId("missing-indexed-tool")) as ToolRef;
      const indexed = await storage.addToolToIndex(missing);
      expect(indexed.ok).toBe(true);
      const all = await storage.readAllTools();
      expect(all.ok).toBe(true);
      if (!all.ok) throw new Error(all.error.message);
      expect(all.value.map((record) => record.toolRef.id)).toEqual([tool.value.id]);
    });
  });

  it("reads artifact JSON through injected materializers", async () => {
    await withWorkspace(async (workspace) => {
      const storage = new ToolRuntimeStorage(workspace.store, workspace.workspace);
      const artifactRef = makeRef("artifact", makeArtifactId("artifact-1")) as ArtifactRef;
      const parsed = await storage.readArtifactJson<{ readonly ok: true }>(artifactRef, async () => ok('{"ok":true}'));
      expect(parsed.ok).toBe(true);
      const invalid = await storage.readArtifactJson(artifactRef, async () => ok("{bad"));
      expect(invalid.ok).toBe(false);
      const failed = await storage.readArtifactJson(artifactRef, async () => ({
        ok: false,
        error: {
          code: "not_found",
          message: "missing",
          module: "test",
          severity: "error",
          retryable: false
        }
      }));
      expect(failed.ok).toBe(false);
    });
  });
});

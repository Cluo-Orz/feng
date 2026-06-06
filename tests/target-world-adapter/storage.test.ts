import { describe, expect, test } from "vitest";
import {
  adapterIndexPath,
  adapterPath,
  makeTargetWorldAdapterId,
  parseJson,
  targetWorldAdapterRef,
  TargetWorldAdapterStorage,
  type TargetWorldAdapterDefinition
} from "../../src/target-world-adapter/index.js";
import { makeTargetWorldId, makeRef } from "../../src/domain/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import { audit, source, version } from "./helpers.js";

describe("Target World Adapter storage", () => {
  test("surfaces invalid indexes and tolerates missing indexed adapters", async () => {
    await withWorkspace(async (workspace) => {
      const storage = new TargetWorldAdapterStorage(workspace.store, workspace.workspace);
      const invalidIndex = await workspace.store.writeTextAtomic(workspace.workspace, adapterIndexPath, "{", {
        reason: "invalid adapter index",
        createParents: true
      });
      expect(invalidIndex.ok).toBe(true);
      const invalidRead = await storage.readAllAdapters();
      expect(invalidRead.ok).toBe(false);
      if (!invalidRead.ok) expect(invalidRead.error.code).toBe("schema_incompatible");

      const missingRef = targetWorldAdapterRef(makeTargetWorldAdapterId("target-adapter-missing"));
      const missingIndex = await workspace.store.writeTextAtomic(workspace.workspace, adapterIndexPath, JSON.stringify({ refs: [missingRef] }), {
        reason: "missing adapter index",
        createParents: true
      });
      expect(missingIndex.ok).toBe(true);
      const missingRead = await storage.readAllAdapters();
      expect(missingRead.ok).toBe(true);
      if (missingRead.ok) expect(missingRead.value).toHaveLength(0);

      const badRef = targetWorldAdapterRef(makeTargetWorldAdapterId("target-adapter-bad"));
      await workspace.store.writeTextAtomic(workspace.workspace, adapterIndexPath, JSON.stringify({ refs: [badRef] }), {
        reason: "bad adapter index",
        createParents: true
      });
      await workspace.store.writeTextAtomic(workspace.workspace, adapterPath(badRef.id), "{", {
        reason: "bad adapter record",
        createParents: true
      });
      const badRead = await storage.readAllAdapters();
      expect(badRead.ok).toBe(false);
      if (!badRead.ok) expect(badRead.error.code).toBe("schema_incompatible");
      expect(parseJson("{", "bad").ok).toBe(false);

      await workspace.store.writeTextAtomic(workspace.workspace, adapterIndexPath, "{", {
        reason: "corrupt adapter index",
        createParents: true
      });
      const add = await storage.addAdapter(targetWorldAdapterRef(makeTargetWorldAdapterId("target-adapter-add")));
      expect(add.ok).toBe(false);
      if (!add.ok) expect(add.error.code).toBe("schema_incompatible");
    });
  });

  test("deduplicates adapter index refs", async () => {
    await withWorkspace(async (workspace) => {
      const storage = new TargetWorldAdapterStorage(workspace.store, workspace.workspace);
      const fixture = { workspace: workspace.workspace } as Parameters<typeof source>[0];
      const ref = targetWorldAdapterRef(makeTargetWorldAdapterId("target-adapter-duplicate"));
      const record: TargetWorldAdapterDefinition = {
        adapterId: ref.id,
        adapterRef: ref,
        targetWorldRef: makeRef("target_world", makeTargetWorldId("target-world-storage")),
        name: "Storage Adapter",
        supportedRuntimeKernelTypes: ["non_llm_runtime"],
        supportedInputKinds: ["tick_state"],
        supportedOutputKinds: ["action_event"],
        supportedActionKinds: ["move"],
        supportedValidationKinds: ["scenario_check"],
        hostIntegrationSummary: "local",
        lifecycle: "registered",
        compatibility: "ok",
        policyBoundarySummary: "policy",
        source: source(fixture, "system"),
        version,
        audit: audit("storage adapter"),
        createdAt: "2026-06-06T00:00:00.000Z",
        updatedAt: "2026-06-06T00:00:00.000Z",
        recordVersion: 1
      };
      expect((await storage.writeAdapter(record, "write adapter")).ok).toBe(true);
      expect((await storage.addAdapter(ref)).ok).toBe(true);
      expect((await storage.addAdapter(ref)).ok).toBe(true);
      const records = await storage.readAllAdapters();
      expect(records.ok).toBe(true);
      if (records.ok) expect(records.value).toHaveLength(1);
    });
  });
});

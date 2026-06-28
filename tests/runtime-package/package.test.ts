import { describe, expect, it } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import {
  loadPackage,
  loadPackageWithMetadata,
  savePackage,
  ensureRuntimePackageLock,
  routingLayerFor,
  defaultFeedbackRouting,
  defaultContextPolicy,
  defaultNovelTargetWorld,
  defaultQualityRules,
  defaultStoryModel,
  defaultHarness,
  defaultCoveragePolicy,
  PACKAGE_PATH,
  RUNTIME_PACKAGE_LOCK_PATH,
  PACKAGE_SCHEMA_VERSION,
  type AuthoringRuntimePackage
} from "../../src/runtime-package/index.js";

function pkg(): AuthoringRuntimePackage {
  return {
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    packageId: "pkg-1",
    name: "xiaoshuo",
    kind: "serialized_authoring_agent",
    version: "1.0.0",
    locked: true,
    runEntry: "feng run",
    targetWorld: defaultNovelTargetWorld,
    contextPolicy: defaultContextPolicy,
    writingStrategy: { systemPrompt: "写作 agent", stylePrinciples: [], constraints: [] },
    storyModel: defaultStoryModel,
    harness: defaultHarness,
    coveragePolicy: defaultCoveragePolicy,
    qualityRules: defaultQualityRules,
    feedbackRouting: defaultFeedbackRouting,
    validation: { readiness: "ready", grownInProject: "/x", evidenceSummary: "ok", checkedAt: "t" },
    provenance: { model: "m", provider: "deepseek", hatchedAt: "t" }
  };
}

describe("runtime package defaults", () => {
  it("routes known and unknown issue kinds", () => {
    expect(routingLayerFor(defaultFeedbackRouting, "length").layer).toBe("work");
    expect(routingLayerFor(defaultFeedbackRouting, "character_continuation").layer).toBe("capability");
    expect(routingLayerFor(defaultFeedbackRouting, "artifact_presence").layer).toBe("system");
    expect(routingLayerFor(defaultFeedbackRouting, "???").layer).toBe("work");
  });
});

describe("runtime package storage", () => {
  it("saves and loads a package at the copyable path", async () => {
    await withWorkspace(async (ws) => {
      const saved = await savePackage(ws.store, ws.workspace, pkg());
      expect(saved.ok).toBe(true);
      if (saved.ok) expect(saved.value).toBe(PACKAGE_PATH);
      const loaded = await loadPackage(ws.store, ws.workspace);
      expect(loaded.ok).toBe(true);
      if (loaded.ok) expect(loaded.value.writingStrategy.systemPrompt).toBe("写作 agent");
    });
  });

  it("writes a runtime package lock and blocks silent package drift", async () => {
    await withWorkspace(async (ws) => {
      await savePackage(ws.store, ws.workspace, pkg());
      const loaded = await loadPackageWithMetadata(ws.store, ws.workspace);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) throw new Error(loaded.error.message);
      const created = await ensureRuntimePackageLock(ws.store, ws.workspace, loaded.value, { acceptUpdate: false, reason: "first run" });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error(created.error.message);
      expect(created.value.status).toBe("created");
      expect(created.value.lockPath).toBe(RUNTIME_PACKAGE_LOCK_PATH);
      const matched = await ensureRuntimePackageLock(ws.store, ws.workspace, loaded.value, { acceptUpdate: false, reason: "same run" });
      expect(matched.ok).toBe(true);
      if (matched.ok) expect(matched.value.status).toBe("matched");

      const changed = { ...pkg(), version: "1.0.1", writingStrategy: { ...pkg().writingStrategy, systemPrompt: "新包" } };
      await savePackage(ws.store, ws.workspace, changed);
      const changedLoaded = await loadPackageWithMetadata(ws.store, ws.workspace);
      expect(changedLoaded.ok).toBe(true);
      if (!changedLoaded.ok) throw new Error(changedLoaded.error.message);
      const refused = await ensureRuntimePackageLock(ws.store, ws.workspace, changedLoaded.value, { acceptUpdate: false, reason: "silent drift" });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe("production_lock_violation");
      const accepted = await ensureRuntimePackageLock(ws.store, ws.workspace, changedLoaded.value, { acceptUpdate: true, reason: "accepted update" });
      expect(accepted.ok).toBe(true);
      if (accepted.ok) expect(accepted.value.status).toBe("updated");
    });
  });

  it("reports package_unavailable when none exists", async () => {
    await withWorkspace(async (ws) => {
      const loaded = await loadPackage(ws.store, ws.workspace);
      expect(loaded.ok).toBe(false);
      if (!loaded.ok) expect(loaded.error.code).toBe("package_unavailable");
    });
  });

  it("normalizes a legacy package that predates coveragePolicy", async () => {
    await withWorkspace(async (ws) => {
      const legacy = { ...pkg() } as Record<string, unknown>;
      delete legacy.coveragePolicy;
      await ws.store.writeTextAtomic(ws.workspace, PACKAGE_PATH, JSON.stringify(legacy), { reason: "legacy package", createParents: true });
      const loaded = await loadPackage(ws.store, ws.workspace);
      expect(loaded.ok).toBe(true);
      if (loaded.ok) {
        expect(loaded.value.coveragePolicy.noMissingTopic.gateId).toBe("gate-chapter-goal-coverage");
        expect(loaded.value.coveragePolicy.noMissingTopic.promptOnlyAllowed).toBe(false);
      }
    });
  });

  it("rejects a corrupt or incomplete package", async () => {
    await withWorkspace(async (ws) => {
      await ws.store.writeTextAtomic(ws.workspace, PACKAGE_PATH, "{bad", { reason: "corrupt", createParents: true });
      const loaded = await loadPackage(ws.store, ws.workspace);
      expect(loaded.ok).toBe(false);
      if (!loaded.ok) expect(loaded.error.code).toBe("schema_incompatible");

      await ws.store.writeTextAtomic(ws.workspace, PACKAGE_PATH, JSON.stringify({ kind: "wrong" }), { reason: "incomplete", createParents: true });
      const loaded2 = await loadPackage(ws.store, ws.workspace);
      expect(loaded2.ok).toBe(false);
      if (!loaded2.ok) expect(loaded2.error.code).toBe("schema_incompatible");
    });
  });
});

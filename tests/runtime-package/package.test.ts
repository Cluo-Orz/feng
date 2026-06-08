import { describe, expect, it } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import {
  loadPackage,
  savePackage,
  routingLayerFor,
  defaultFeedbackRouting,
  defaultContextPolicy,
  defaultNovelTargetWorld,
  defaultQualityRules,
  defaultStoryModel,
  defaultHarness,
  PACKAGE_PATH,
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

  it("reports package_unavailable when none exists", async () => {
    await withWorkspace(async (ws) => {
      const loaded = await loadPackage(ws.store, ws.workspace);
      expect(loaded.ok).toBe(false);
      if (!loaded.ok) expect(loaded.error.code).toBe("package_unavailable");
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

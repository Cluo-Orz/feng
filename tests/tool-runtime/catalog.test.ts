import { describe, expect, it } from "vitest";
import { withWorkspace } from "../file-store/helpers.js";
import {
  audit,
  makeToolRuntimeFixture,
  readJsonArtifact,
  registerEchoTool,
  source
} from "./helpers.js";
import type { ToolSurfaceSummary } from "../../src/tool-runtime/index.js";

describe("Tool Runtime catalog and surface", () => {
  it("registers tools as file-native records without making every lifecycle visible", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeToolRuntimeFixture(workspace);
      const active = await fixture.runtime.registerTool(registerEchoTool(fixture));
      expect(active.ok).toBe(true);
      if (!active.ok) throw new Error(active.error.message);

      const disabled = await fixture.runtime.registerTool(registerEchoTool(fixture, {
        name: "draft-echo",
        lifecycle: "registered",
        implementation: { kind: "host_function", implementationId: "echo" }
      }));
      expect(disabled.ok).toBe(true);

      const listed = await fixture.runtime.listTools({ includeUnavailable: true });
      expect(listed.ok).toBe(true);
      if (!listed.ok) throw new Error(listed.error.message);
      expect(listed.value.total).toBe(2);

      const surface = await fixture.runtime.describeToolSurface(
        {},
        source(fixture),
        audit("describe surface")
      );
      expect(surface.ok).toBe(true);
      if (!surface.ok) throw new Error(surface.error.message);
      expect(surface.value.surface.entries.map((entry) => entry.name)).toEqual(["echo"]);
      expect(JSON.stringify(surface.value.surface)).not.toContain("implementationId");

      const materialized = await readJsonArtifact<ToolSurfaceSummary>(fixture, surface.value.surfaceRef);
      expect(materialized.entries).toHaveLength(1);
      expect(materialized.entries[0]?.declaredCapabilities).toEqual(["file.read"]);
      const explained = await fixture.runtime.explainToolSurface(surface.value.surfaceRef);
      expect(explained.ok).toBe(true);
    });
  });

  it("updates lifecycle explicitly before a registered tool becomes visible", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeToolRuntimeFixture(workspace);
      const registered = await fixture.runtime.registerTool(registerEchoTool(fixture, {
        lifecycle: "registered"
      }));
      expect(registered.ok).toBe(true);
      if (!registered.ok) throw new Error(registered.error.message);

      const emptySurface = await fixture.runtime.describeToolSurface({}, source(fixture), audit("surface"));
      expect(emptySurface.ok).toBe(true);
      if (!emptySurface.ok) throw new Error(emptySurface.error.message);
      expect(emptySurface.value.surface.entries).toHaveLength(0);

      const changed = await fixture.runtime.updateToolLifecycle(registered.value, "active", "activate for test");
      expect(changed.ok).toBe(true);
      const activeSurface = await fixture.runtime.describeToolSurface({}, source(fixture), audit("surface"));
      expect(activeSurface.ok).toBe(true);
      if (!activeSurface.ok) throw new Error(activeSurface.error.message);
      expect(activeSurface.value.surface.entries[0]?.toolRef.id).toBe(registered.value.id);
    });
  });

  it("discovers tool manifest summaries and records ignored manifests", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeToolRuntimeFixture(workspace);
      const registered = await fixture.runtime.registerTool(registerEchoTool(fixture));
      expect(registered.ok).toBe(true);
      if (!registered.ok) throw new Error(registered.error.message);
      const record = await fixture.runtime.getTool(registered.value);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);

      await fixture.store.writeTextAtomic(fixture.workspace, "manifests/good.tool.json", JSON.stringify(record.value), {
        reason: "write manifest",
        createParents: true
      });
      await fixture.store.writeTextAtomic(fixture.workspace, "manifests/bad.tool.json", "{bad json", {
        reason: "write invalid manifest",
        createParents: true
      });
      await fixture.store.writeTextAtomic(fixture.workspace, "manifests/missing.tool.json", JSON.stringify({ name: "x" }), {
        reason: "write incomplete manifest",
        createParents: true
      });
      await fixture.store.writeTextAtomic(fixture.workspace, "manifests/readme.txt", "ignore", {
        reason: "write ignored file",
        createParents: true
      });

      const report = await fixture.runtime.discoverTools({ searchPaths: ["manifests"] });
      expect(report.ok).toBe(true);
      if (!report.ok) throw new Error(report.error.message);
      expect(report.value.discovered).toHaveLength(1);
      expect(report.value.discovered[0]?.name).toBe("echo");
      expect(report.value.ignored).toHaveLength(2);

      const missing = await fixture.runtime.discoverTools({ searchPaths: ["missing-dir"] });
      expect(missing.ok).toBe(true);
      if (!missing.ok) throw new Error(missing.error.message);
      expect(missing.value.ignored[0]).toContain("path does not exist");
    });
  });

  it("rejects invalid registration and illegal lifecycle transitions", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeToolRuntimeFixture(workspace);
      const blank = await fixture.runtime.registerTool(registerEchoTool(fixture, { name: "" }));
      expect(blank.ok).toBe(false);
      const badSchema = await fixture.runtime.registerTool(registerEchoTool(fixture, {
        inputSchema: { type: "string" }
      }));
      expect(badSchema.ok).toBe(false);

      const registered = await fixture.runtime.registerTool(registerEchoTool(fixture, { lifecycle: "retracted" }));
      expect(registered.ok).toBe(true);
      if (!registered.ok) throw new Error(registered.error.message);
      const changed = await fixture.runtime.updateToolLifecycle(registered.value, "active", "cannot revive");
      expect(changed.ok).toBe(false);
    });
  });
});

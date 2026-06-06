import { describe, expect, test } from "vitest";
import {
  appendTargetWorldEvent,
  createTargetWorldRuntime,
  makeTargetActionRequestId,
  registerTargetArtifact,
  targetActionRequestRef
} from "../../src/target-world-adapter/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import { audit, makeTargetFixture, source } from "./helpers.js";

describe("Target World Adapter runtime helpers", () => {
  test("writes workspace-level events and custom target artifacts", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeTargetFixture(workspace);
      const runtime = createTargetWorldRuntime({
        workspace: fixture.workspace,
        store: fixture.store,
        ledger: fixture.ledger,
        artifactRegistry: fixture.artifacts,
        policyBoundary: fixture.policy,
        runtimeContractRegistry: fixture.contracts,
        hatchBuilder: fixture.hatch,
        evidenceReadiness: fixture.evidence,
        producer: "target-test"
      });
      const event = await appendTargetWorldEvent({
        runtime,
        eventType: "target_world_runtime_test",
        body: { ok: true },
        source: source(fixture, "system"),
        audit: audit("runtime event"),
        correlationId: "runtime-correlation"
      });
      expect(event.ok).toBe(true);
      const artifact = await registerTargetArtifact({
        runtime,
        kind: "summary",
        content: { summary: "custom" },
        mediaType: "application/vnd.feng.target-summary+json",
        privacyClass: "public",
        retentionClass: "archive",
        source: source(fixture, "system"),
        audit: audit("runtime artifact")
      });
      expect(artifact.ok).toBe(true);
      if (!artifact.ok) throw new Error(artifact.error.message);
      const record = await fixture.artifacts.resolveArtifact(artifact.value);
      expect(record.ok).toBe(true);
      if (record.ok) {
        expect(record.value.mediaType).toBe("application/vnd.feng.target-summary+json");
        expect(record.value.retentionClass).toBe("archive");
      }
    });
  });

  test("surfaces missing target action records", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeTargetFixture(workspace);
      const missing = await fixture.target.dispatchTargetAction(
        targetActionRequestRef(makeTargetActionRequestId("target-action-missing")),
        "dispatch missing"
      );
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.error.code).toBe("not_found");
    });
  });
});

import { describe, expect, test } from "vitest";
import type { ArtifactRef } from "../../src/domain/index.js";
import { artifactRecordPath } from "../../src/artifact-registry/paths.js";
import { withWorkspace } from "../file-store/helpers.js";
import {
  allowHatchPublish,
  audit,
  hatchInput,
  lockedContractSetup,
  makeHatchFixture,
  policy,
  registerTextArtifact,
  source,
  version
} from "./helpers.js";

describe("Hatch Builder resource selection", () => {
  test("excludes raw message lists and secret resources before package build", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeHatchFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);

      const rawMessageList = await fixture.artifacts.registerArtifact({
        kind: "compiled_message_list",
        content: "raw grow prompt",
        mediaType: "text/plain",
        encoding: "utf8",
        source: source(fixture, "system"),
        version,
        audit: audit("raw message list"),
        privacyClass: "workspace_private",
        retentionClass: "attempt_scoped",
        producerModule: "context-message-compiler"
      });
      expect(rawMessageList.ok).toBe(true);
      if (!rawMessageList.ok) throw new Error(rawMessageList.error.message);
      const secret = await registerTextArtifact(fixture, {
        content: "secret_value=abc",
        privacy: "workspace_private"
      });
      expect(secret.ok).toBe(true);
      if (!secret.ok) throw new Error(secret.error.message);

      const request = await fixture.hatch.requestHatch(hatchInput(fixture, setup.value, {
        resourceCandidates: [
          { artifactRef: rawMessageList.value, role: "runtime_entry", required: false },
          { artifactRef: secret.value, role: "configuration_template", required: true }
        ]
      }));
      expect(request.ok).toBe(true);
      if (!request.ok) throw new Error(request.error.message);
      const plan = await fixture.hatch.buildHatchPlan(request.value, allowHatchPublish());
      expect(plan.ok).toBe(true);
      if (!plan.ok) throw new Error(plan.error.message);
      const reasons = plan.value.excludedResources.map((item) => item.reason);
      expect(reasons).toContain("raw_message_list");
      expect(reasons).toContain("contains_secret");

      const secretExclusion = plan.value.excludedResources.find((item) => item.reason === "contains_secret");
      expect(secretExclusion).toBeDefined();
      if (secretExclusion !== undefined) {
        const explanation = await fixture.hatch.explainResourceExclusion(secretExclusion.exclusionRef);
        expect(explanation.ok).toBe(true);
        if (explanation.ok) expect(explanation.value.facts.join("\n")).toContain("required=true");
      }
      const packageRef = await fixture.hatch.buildHatchPackage(plan.value.hatchBuildPlanRef);
      expect(packageRef.ok).toBe(false);
      if (!packageRef.ok) expect(packageRef.error.code).toBe("secret_detected");
    });
  });

  test("requires explicit policy for external export of user content", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeHatchFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const userContent = await registerTextArtifact(fixture, {
        content: "user supplied lore",
        privacy: "contains_user_content"
      });
      expect(userContent.ok).toBe(true);
      if (!userContent.ok) throw new Error(userContent.error.message);
      const request = await fixture.hatch.requestHatch(hatchInput(fixture, setup.value, {
        publishMode: "external_export",
        resourceCandidates: [{ artifactRef: userContent.value, role: "source_material_snapshot", required: false }]
      }));
      expect(request.ok).toBe(true);
      if (!request.ok) throw new Error(request.error.message);
      const plan = await fixture.hatch.buildHatchPlan(request.value, allowHatchPublish());
      expect(plan.ok).toBe(true);
      if (plan.ok) expect(plan.value.excludedResources.map((item) => item.reason)).toContain("policy_blocked");
    });
  });

  test("includes user content for external export when artifact export policy allows it", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeHatchFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const userContent = await registerTextArtifact(fixture, {
        content: "approved user lore",
        privacy: "contains_user_content"
      });
      expect(userContent.ok).toBe(true);
      if (!userContent.ok) throw new Error(userContent.error.message);
      const request = await fixture.hatch.requestHatch(hatchInput(fixture, setup.value, {
        publishMode: "external_export",
        resourceCandidates: [{ artifactRef: userContent.value, role: "source_material_snapshot", required: false }]
      }));
      expect(request.ok).toBe(true);
      if (!request.ok) throw new Error(request.error.message);
      const plan = await fixture.hatch.buildHatchPlan(request.value, policy([
        { capability: "hatch.publish", resource: "*", verdict: "allow" },
        { capability: "artifact.export", resource: "*", verdict: "allow" }
      ]));
      expect(plan.ok).toBe(true);
      if (plan.ok) {
        expect(plan.value.includedResources.some((item) => item.artifactRef.id === userContent.value.id)).toBe(true);
        expect(plan.value.policyDecisionRefs.length).toBeGreaterThan(1);
        const packageRef = await fixture.hatch.buildHatchPackage(plan.value.hatchBuildPlanRef);
        expect(packageRef.ok).toBe(true);
        if (!packageRef.ok) throw new Error(packageRef.error.message);
        const record = await fixture.hatch.getHatchPackage(packageRef.value);
        expect(record.ok).toBe(true);
        if (!record.ok) throw new Error(record.error.message);
        const artifact = await fixture.artifacts.resolveArtifact(record.value.artifactRef);
        expect(artifact.ok).toBe(true);
        if (artifact.ok) expect(artifact.value.privacyClass).toBe("contains_user_content");
      }
    });
  });

  test("maps required exclusions to blocking package build errors", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeHatchFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const retracted = await registerTextArtifact(fixture, { content: "retracted" });
      const archived = await registerTextArtifact(fixture, { content: "archived" });
      const userContent = await registerTextArtifact(fixture, {
        content: "private lore",
        privacy: "contains_user_content"
      });
      expect(retracted.ok && archived.ok && userContent.ok).toBe(true);
      if (!retracted.ok || !archived.ok || !userContent.ok) throw new Error("artifact setup failed");
      await fixture.artifacts.retractArtifact(retracted.value, "retract");
      await fixture.artifacts.archiveArtifact(archived.value, "archive");

      await expectBuildError(fixture, setup.value, retracted.value, "retracted-required", "1.1.0", "resource_retracted");
      await expectBuildError(fixture, setup.value, archived.value, "archived-required", "1.1.1", "resource_unavailable");
      const request = await fixture.hatch.requestHatch(hatchInput(fixture, setup.value, {
        packageName: "policy-required",
        requestedVersion: { schemaVersion: "1.1.2", producerVersion: "hatch-test" },
        publishMode: "external_export",
        resourceCandidates: [{ artifactRef: userContent.value, role: "source_material_snapshot", required: true }]
      }));
      expect(request.ok).toBe(true);
      if (!request.ok) throw new Error(request.error.message);
      const plan = await fixture.hatch.buildHatchPlan(request.value, allowHatchPublish());
      expect(plan.ok).toBe(true);
      if (!plan.ok) throw new Error(plan.error.message);
      const packageRef = await fixture.hatch.buildHatchPackage(plan.value.hatchBuildPlanRef);
      expect(packageRef.ok).toBe(false);
      if (!packageRef.ok) expect(packageRef.error.code).toBe("policy_blocked");
    });
  });

  test("records structural exclusions for unstable or unavailable artifact candidates", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeHatchFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const candidateOutput = await registerTextArtifact(fixture, { content: "draft", kind: "candidate_output" });
      const unknown = await registerTextArtifact(fixture, { content: "unknown", privacy: "unknown" });
      const archived = await registerTextArtifact(fixture, { content: "old" });
      const retracted = await registerTextArtifact(fixture, { content: "bad" });
      const trace = await registerTextArtifact(fixture, { content: "trace", kind: "attempt_trace", producer: "grow-attempt-runner" });
      expect(candidateOutput.ok && unknown.ok && archived.ok && retracted.ok && trace.ok).toBe(true);
      if (!candidateOutput.ok || !unknown.ok || !archived.ok || !retracted.ok || !trace.ok) throw new Error("artifact setup failed");
      await fixture.artifacts.archiveArtifact(archived.value, "archive");
      await fixture.artifacts.retractArtifact(retracted.value, "retract");

      const request = await fixture.hatch.requestHatch(hatchInput(fixture, setup.value, {
        resourceCandidates: [
          { artifactRef: candidateOutput.value, role: "runtime_entry" },
          { artifactRef: unknown.value, role: "configuration_template" },
          { artifactRef: archived.value, role: "source_material_snapshot" },
          { artifactRef: retracted.value, role: "source_material_snapshot" },
          { artifactRef: trace.value, role: "debug_support" }
        ]
      }));
      expect(request.ok).toBe(true);
      if (!request.ok) throw new Error(request.error.message);
      const plan = await fixture.hatch.buildHatchPlan(request.value, allowHatchPublish());
      expect(plan.ok).toBe(true);
      if (plan.ok) {
        const reasons = plan.value.excludedResources.map((item) => item.reason);
        expect(reasons).toContain("unaccepted_candidate");
        expect(reasons).toContain("privacy_unknown");
        expect(reasons).toContain("archived_artifact");
        expect(reasons).toContain("retracted_artifact");
        expect(reasons).toContain("raw_attempt_trace");
      }
    });
  });

  test("packages binary resources and external handles with content hashes", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeHatchFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const binary = await fixture.artifacts.registerArtifact({
        kind: "source_material",
        content: new Uint8Array([1, 2, 3, 4]),
        mediaType: "application/octet-stream",
        encoding: "binary",
        source: source(fixture, "system"),
        version,
        audit: audit("binary asset"),
        privacyClass: "workspace_private",
        retentionClass: "hatch_scoped",
        producerModule: "human"
      });
      const external = await fixture.artifacts.registerExternalHandle({
        kind: "source_material",
        handle: "external://asset",
        mediaType: "text/plain",
        source: source(fixture, "system"),
        version,
        audit: audit("external asset"),
        privacyClass: "workspace_private",
        retentionClass: "hatch_scoped",
        producerModule: "human",
        contentHash: { algorithm: "sha256", value: "0".repeat(64) },
        size: 16,
        trusted: true
      });
      expect(binary.ok && external.ok).toBe(true);
      if (!binary.ok || !external.ok) throw new Error("resource setup failed");
      const request = await fixture.hatch.requestHatch(hatchInput(fixture, setup.value, {
        resourceCandidates: [
          { artifactRef: binary.value, role: "target_world_asset" },
          { artifactRef: external.value, role: "source_material_snapshot" }
        ]
      }));
      expect(request.ok).toBe(true);
      if (!request.ok) throw new Error(request.error.message);
      const plan = await fixture.hatch.buildHatchPlan(request.value, allowHatchPublish());
      expect(plan.ok).toBe(true);
      if (!plan.ok) throw new Error(plan.error.message);
      const packageRef = await fixture.hatch.buildHatchPackage(plan.value.hatchBuildPlanRef);
      expect(packageRef.ok).toBe(true);
      if (!packageRef.ok) throw new Error(packageRef.error.message);
      const record = await fixture.hatch.getHatchPackage(packageRef.value);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);
      const materialized = await fixture.artifacts.materializeArtifact(record.value.artifactRef, {
        reason: "read package",
        maxBytes: 1024 * 1024
      });
      expect(materialized.ok).toBe(true);
      if (materialized.ok && typeof materialized.value.content === "string") {
        expect(materialized.value.content).toContain("\"encoding\": \"base64\"");
        expect(materialized.value.content).toContain("\"encoding\": \"external\"");
      }
    });
  });

  test("keeps hatch package privacy public when every included resource is public", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeHatchFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const contract = await fixture.contracts.getRuntimeContract(setup.value.runtimeContractRef);
      const readiness = await fixture.evidence.explainReadinessVerdict(setup.value.readinessVerdictRef);
      expect(contract.ok && readiness.ok).toBe(true);
      if (!contract.ok || !readiness.ok) throw new Error("hatch base resource setup failed");
      await forceArtifactPrivacy(fixture, contract.value.artifactRef, "public");
      await forceArtifactPrivacy(fixture, readiness.value.artifactRef, "public");

      const request = await fixture.hatch.requestHatch(hatchInput(fixture, setup.value, {
        packageName: "public-package",
        requestedVersion: { schemaVersion: "2.5.0", producerVersion: "hatch-test" }
      }));
      expect(request.ok).toBe(true);
      if (!request.ok) throw new Error(request.error.message);
      const plan = await fixture.hatch.buildHatchPlan(request.value, allowHatchPublish());
      expect(plan.ok).toBe(true);
      if (!plan.ok) throw new Error(plan.error.message);
      expect(plan.value.includedResources.every((item) => item.privacyClass === "public")).toBe(true);
      const packageRef = await fixture.hatch.buildHatchPackage(plan.value.hatchBuildPlanRef);
      expect(packageRef.ok).toBe(true);
      if (!packageRef.ok) throw new Error(packageRef.error.message);
      const record = await fixture.hatch.getHatchPackage(packageRef.value);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);
      const artifact = await fixture.artifacts.resolveArtifact(record.value.artifactRef);
      expect(artifact.ok).toBe(true);
      if (artifact.ok) expect(artifact.value.privacyClass).toBe("public");
    });
  });

  test("excludes resources whose managed content file disappeared", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeHatchFixture(workspace);
      const setup = await lockedContractSetup(fixture);
      expect(setup.ok).toBe(true);
      if (!setup.ok) throw new Error(setup.error.message);
      const artifact = await registerTextArtifact(fixture, { content: "will disappear" });
      expect(artifact.ok).toBe(true);
      if (!artifact.ok) throw new Error(artifact.error.message);
      const record = await fixture.artifacts.resolveArtifact(artifact.value);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);
      if (record.value.contentLocation.kind === "managed") {
        await fixture.store.removeFile(fixture.workspace, record.value.contentLocation.logicalPath, {
          reason: "remove managed content without lifecycle transition"
        });
      }
      const selection = await fixture.hatch.selectHatchResources(hatchInput(fixture, setup.value, {
        resourceCandidates: [{ artifactRef: artifact.value, role: "source_material_snapshot" }]
      }), allowHatchPublish());
      expect(selection.ok).toBe(true);
      if (selection.ok) expect(selection.value.excludedResources.map((item) => item.reason)).toContain("unavailable_artifact");
    });
  });
});

async function expectBuildError(
  fixture: ReturnType<typeof makeHatchFixture>,
  setup: Parameters<typeof hatchInput>[1],
  artifactRef: ArtifactRef,
  packageName: string,
  schemaVersion: string,
  code: string
): Promise<void> {
  const request = await fixture.hatch.requestHatch(hatchInput(fixture, setup, {
    packageName,
    requestedVersion: { schemaVersion, producerVersion: "hatch-test" },
    resourceCandidates: [{ artifactRef, role: "source_material_snapshot", required: true }]
  }));
  expect(request.ok).toBe(true);
  if (!request.ok) throw new Error(request.error.message);
  const plan = await fixture.hatch.buildHatchPlan(request.value, allowHatchPublish());
  expect(plan.ok).toBe(true);
  if (!plan.ok) throw new Error(plan.error.message);
  const packageRef = await fixture.hatch.buildHatchPackage(plan.value.hatchBuildPlanRef);
  expect(packageRef.ok).toBe(false);
  if (!packageRef.ok) expect(packageRef.error.code).toBe(code);
}

async function forceArtifactPrivacy(
  fixture: ReturnType<typeof makeHatchFixture>,
  artifactRef: ArtifactRef,
  privacyClass: "public"
): Promise<void> {
  const record = await fixture.artifacts.resolveArtifact(artifactRef);
  expect(record.ok).toBe(true);
  if (!record.ok) throw new Error(record.error.message);
  const write = await fixture.store.writeTextAtomic(
    fixture.workspace,
    artifactRecordPath(record.value.artifactId),
    JSON.stringify({ ...record.value, privacyClass }, null, 2),
    { reason: "force artifact privacy for hatch package test", createParents: true }
  );
  expect(write.ok).toBe(true);
}

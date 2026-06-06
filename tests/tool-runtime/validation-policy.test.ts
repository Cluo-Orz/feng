import { describe, expect, it } from "vitest";
import { makeArtifactId, makeRef } from "../../src/domain/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import {
  audit,
  echoImplementation,
  implementationCalls,
  makeToolRuntimeFixture,
  policyContext,
  readJsonArtifact,
  registerEchoTool,
  source,
  toolRequest,
  version
} from "./helpers.js";
import type { ToolInputValidation, ToolSettlement } from "../../src/tool-runtime/index.js";

describe("Tool Runtime validation and policy", () => {
  it("validates inline input and explains the validation artifact", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeToolRuntimeFixture(workspace);
      const tool = await fixture.runtime.registerTool(registerEchoTool(fixture));
      expect(tool.ok).toBe(true);
      if (!tool.ok) throw new Error(tool.error.message);

      const validation = await fixture.runtime.validateToolCall(toolRequest(fixture, tool.value));
      expect(validation.ok).toBe(true);
      if (!validation.ok) throw new Error(validation.error.message);
      expect(validation.value.status).toBe("valid");
      expect(validation.value.validationRef).toBeDefined();

      const explained = await fixture.runtime.explainToolInputValidation(validation.value.validationRef!);
      expect(explained.ok).toBe(true);
      if (!explained.ok) throw new Error(explained.error.message);
      expect(explained.value.inputHash).toBe(validation.value.inputHash);
    });
  });

  it("settles invalid input without executing the implementation", async () => {
    await withWorkspace(async (workspace) => {
      const implementation = echoImplementation();
      const fixture = makeToolRuntimeFixture(workspace, [implementation]);
      const tool = await fixture.runtime.registerTool(registerEchoTool(fixture));
      expect(tool.ok).toBe(true);
      if (!tool.ok) throw new Error(tool.error.message);

      const settlement = await fixture.runtime.executeTool(
        toolRequest(fixture, tool.value, { input: { extra: true } }),
        { policyContext: policyContext("allow") }
      );
      expect(settlement.ok).toBe(true);
      if (!settlement.ok) throw new Error(settlement.error.message);
      expect(settlement.value.status).toBe("validation_failed");
      expect(settlement.value.visibleToModelSummary).toContain("field is not declared");
      expect(implementationCalls(implementation)).toBe(0);
    });
  });

  it("materializes JSON input artifacts before validation", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeToolRuntimeFixture(workspace);
      const tool = await fixture.runtime.registerTool(registerEchoTool(fixture));
      expect(tool.ok).toBe(true);
      if (!tool.ok) throw new Error(tool.error.message);
      const artifact = await fixture.artifacts.registerArtifact({
        kind: "source_material",
        content: JSON.stringify({ prompt: "from artifact" }),
        mediaType: "application/json",
        encoding: "utf8",
        source: source(fixture, "user"),
        version,
        audit: audit("input artifact"),
        privacyClass: "workspace_private",
        retentionClass: "attempt_scoped",
        producerModule: "human"
      });
      expect(artifact.ok).toBe(true);
      if (!artifact.ok) throw new Error(artifact.error.message);

      const baseRequest = toolRequest(fixture, tool.value);
      const { input: _inlineInput, ...artifactRequest } = baseRequest;
      void _inlineInput;
      const validation = await fixture.runtime.validateToolCall({
        ...artifactRequest,
        inputArtifactRef: artifact.value
      });
      expect(validation.ok).toBe(true);
      if (!validation.ok) throw new Error(validation.error.message);
      expect(validation.value.status).toBe("valid");
      expect(validation.value.normalizedInput).toEqual({ prompt: "from artifact" });
    });
  });

  it("blocks denied policy decisions before implementation execution", async () => {
    await withWorkspace(async (workspace) => {
      const implementation = echoImplementation();
      const fixture = makeToolRuntimeFixture(workspace, [implementation]);
      const tool = await fixture.runtime.registerTool(registerEchoTool(fixture));
      expect(tool.ok).toBe(true);
      if (!tool.ok) throw new Error(tool.error.message);

      const settlement = await fixture.runtime.executeTool(
        toolRequest(fixture, tool.value),
        { policyContext: policyContext("deny") }
      );
      expect(settlement.ok).toBe(true);
      if (!settlement.ok) throw new Error(settlement.error.message);
      expect(settlement.value.status).toBe("policy_blocked");
      expect(implementationCalls(implementation)).toBe(0);
    });
  });

  it("records credential requirements as validation issues", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeToolRuntimeFixture(workspace);
      const tool = await fixture.runtime.registerTool(registerEchoTool(fixture, {
        credentialRequirements: [{ name: "api-key", purpose: "external API" }]
      }));
      expect(tool.ok).toBe(true);
      if (!tool.ok) throw new Error(tool.error.message);

      const settlement = await fixture.runtime.executeTool(
        toolRequest(fixture, tool.value),
        { policyContext: policyContext("allow") }
      );
      expect(settlement.ok).toBe(true);
      if (!settlement.ok) throw new Error(settlement.error.message);
      expect(settlement.value.status).toBe("validation_failed");
      const stored = await readJsonArtifact<ToolSettlement>(fixture, settlement.value.settlementRef!);
      expect(stored.visibleToModelSummary).toContain("required credential is missing");
    });
  });

  it("rejects path traversal through schema format guards", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeToolRuntimeFixture(workspace);
      const tool = await fixture.runtime.registerTool(registerEchoTool(fixture));
      expect(tool.ok).toBe(true);
      if (!tool.ok) throw new Error(tool.error.message);

      const validation = await fixture.runtime.validateToolCall(toolRequest(fixture, tool.value, {
        input: { prompt: "x", path: "../escape.txt" }
      }));
      expect(validation.ok).toBe(true);
      if (!validation.ok) throw new Error(validation.error.message);
      expect(validation.value.status).toBe("invalid");
      const stored = await readJsonArtifact<ToolInputValidation>(fixture, validation.value.validationRef!);
      expect(stored.issues.some((issue) => issue.code === "unsafe_path")).toBe(true);
    });
  });

  it("reports both inline and artifact input as unsupported", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeToolRuntimeFixture(workspace);
      const tool = await fixture.runtime.registerTool(registerEchoTool(fixture));
      expect(tool.ok).toBe(true);
      if (!tool.ok) throw new Error(tool.error.message);
      const artifact = await fixture.artifacts.registerArtifact({
        kind: "source_material",
        content: "{}",
        mediaType: "application/json",
        encoding: "utf8",
        source: source(fixture),
        version,
        audit: audit("input"),
        privacyClass: "workspace_private",
        retentionClass: "attempt_scoped",
        producerModule: "human"
      });
      expect(artifact.ok).toBe(true);
      if (!artifact.ok) throw new Error(artifact.error.message);

      const validation = await fixture.runtime.validateToolCall(toolRequest(fixture, tool.value, {
        input: { prompt: "x" },
        inputArtifactRef: artifact.value
      }));
      expect(validation.ok).toBe(true);
      if (!validation.ok) throw new Error(validation.error.message);
      expect(validation.value.issues.some((issue) => issue.code === "unsupported")).toBe(true);
    });
  });

  it("covers missing, type, enum, array, max length, and unsafe command validation", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeToolRuntimeFixture(workspace);
      const tool = await fixture.runtime.registerTool(registerEchoTool(fixture, {
        inputSchema: {
          type: "object",
          properties: {
            prompt: { type: "string", enum: ["ok"], maxLength: 3 },
            tags: { type: "array", items: { type: "string" } },
            command: { type: "string", format: "shell_command" }
          },
          required: ["prompt", "tags"],
          additionalProperties: false
        },
        declaredCapabilities: ["command.run"]
      }));
      expect(tool.ok).toBe(true);
      if (!tool.ok) throw new Error(tool.error.message);

      const validation = await fixture.runtime.validateToolCall(toolRequest(fixture, tool.value, {
        input: { prompt: "too long ".repeat(800), tags: [1], command: "reboot" }
      }));
      expect(validation.ok).toBe(true);
      if (!validation.ok) throw new Error(validation.error.message);
      const codes = validation.value.issues.map((issue) => issue.code);
      expect(codes).toContain("unsupported");
      expect(codes).toContain("input_too_large");
      expect(codes).toContain("type_mismatch");
      expect(codes).toContain("unsafe_command");

      const missing = await fixture.runtime.validateToolCall(toolRequest(fixture, tool.value, {
        input: { tags: [] }
      }));
      expect(missing.ok).toBe(true);
      if (!missing.ok) throw new Error(missing.error.message);
      expect(missing.value.issues.some((issue) => issue.code === "missing_required")).toBe(true);
    });
  });

  it("handles invalid, non-object, missing, and redacted input artifacts", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeToolRuntimeFixture(workspace);
      const tool = await fixture.runtime.registerTool(registerEchoTool(fixture));
      expect(tool.ok).toBe(true);
      if (!tool.ok) throw new Error(tool.error.message);

      const invalid = await fixture.artifacts.registerArtifact({
        kind: "source_material",
        content: "{bad",
        mediaType: "application/json",
        encoding: "utf8",
        source: source(fixture),
        version,
        audit: audit("bad input"),
        privacyClass: "workspace_private",
        retentionClass: "attempt_scoped",
        producerModule: "human"
      });
      expect(invalid.ok).toBe(true);
      if (!invalid.ok) throw new Error(invalid.error.message);
      const invalidRequest = toolRequest(fixture, tool.value);
      const { input: _inlineInput, ...artifactRequest } = invalidRequest;
      void _inlineInput;
      const invalidValidation = await fixture.runtime.validateToolCall({
        ...artifactRequest,
        inputArtifactRef: invalid.value
      });
      expect(invalidValidation.ok).toBe(true);
      if (!invalidValidation.ok) throw new Error(invalidValidation.error.message);
      expect(invalidValidation.value.issues.some((issue) => issue.code === "invalid_json")).toBe(true);

      const redacted = await fixture.artifacts.registerArtifact({
        kind: "source_material",
        content: JSON.stringify({ prompt: "secret" }),
        mediaType: "application/json",
        encoding: "utf8",
        source: source(fixture),
        version,
        audit: audit("redacted input"),
        privacyClass: "workspace_private",
        retentionClass: "attempt_scoped",
        producerModule: "human"
      });
      expect(redacted.ok).toBe(true);
      if (!redacted.ok) throw new Error(redacted.error.message);
      await fixture.artifacts.redactArtifact(redacted.value, "hide input");
      const redactedBase = toolRequest(fixture, tool.value);
      const { input: _input, ...redactedRequest } = redactedBase;
      void _input;
      const redactedValidation = await fixture.runtime.validateToolCall({
        ...redactedRequest,
        inputArtifactRef: redacted.value
      });
      expect(redactedValidation.ok).toBe(true);
      if (!redactedValidation.ok) throw new Error(redactedValidation.error.message);
      expect(redactedValidation.value.issues.some((issue) => issue.code === "privacy_blocked")).toBe(true);

      const missingBase = toolRequest(fixture, tool.value);
      const { input: _missingInput, ...missingRequest } = missingBase;
      void _missingInput;
      const missingValidation = await fixture.runtime.validateToolCall({
        ...missingRequest,
        inputArtifactRef: makeRef("artifact", makeArtifactId("missing-artifact"))
      });
      expect(missingValidation.ok).toBe(true);
      if (!missingValidation.ok) throw new Error(missingValidation.error.message);
      expect(missingValidation.value.issues.some((issue) => issue.code === "artifact_unavailable")).toBe(true);

      const binary = await fixture.artifacts.registerArtifact({
        kind: "source_material",
        content: new Uint8Array([1, 2, 3]),
        mediaType: "application/octet-stream",
        encoding: "binary",
        source: source(fixture),
        version,
        audit: audit("binary input"),
        privacyClass: "workspace_private",
        retentionClass: "attempt_scoped",
        producerModule: "human"
      });
      expect(binary.ok).toBe(true);
      if (!binary.ok) throw new Error(binary.error.message);
      const binaryBase = toolRequest(fixture, tool.value);
      const { input: _binaryInput, ...binaryRequest } = binaryBase;
      void _binaryInput;
      const binaryValidation = await fixture.runtime.validateToolCall({
        ...binaryRequest,
        inputArtifactRef: binary.value
      });
      expect(binaryValidation.ok).toBe(true);
      if (!binaryValidation.ok) throw new Error(binaryValidation.error.message);
      expect(binaryValidation.value.issues.some((issue) => issue.code === "unsupported")).toBe(true);
    });
  });

  it("allows optional credentials when no credential name is provided", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeToolRuntimeFixture(workspace);
      const tool = await fixture.runtime.registerTool(registerEchoTool(fixture, {
        credentialRequirements: [{ name: "optional-key", purpose: "optional API", optional: true }]
      }));
      expect(tool.ok).toBe(true);
      if (!tool.ok) throw new Error(tool.error.message);
      const validation = await fixture.runtime.validateToolCall(toolRequest(fixture, tool.value));
      expect(validation.ok).toBe(true);
      if (!validation.ok) throw new Error(validation.error.message);
      expect(validation.value.status).toBe("valid");
    });
  });
});

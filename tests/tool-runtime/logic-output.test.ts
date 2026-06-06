import { describe, expect, it } from "vitest";
import {
  errorFromUnknown,
  assertPolicyExecutable,
  executable,
  evaluateToolPolicy,
  materializeJsonArtifact,
  matchesToolQuery,
  normalizeToolOutput,
  surfaceEntry,
  transitionAllowed,
  validateRegisterToolInput
} from "../../src/tool-runtime/index.js";
import { withWorkspace } from "../file-store/helpers.js";
import {
  audit,
  makeToolRuntimeFixture,
  policyContext,
  registerEchoTool,
  source,
  toolRequest,
  version
} from "./helpers.js";

describe("Tool Runtime logic and output helpers", () => {
  it("validates registration fields and query predicates", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeToolRuntimeFixture(workspace);
      const input = registerEchoTool(fixture);
      expect(validateRegisterToolInput({ ...input, description: "" }).ok).toBe(false);
      expect(validateRegisterToolInput({
        ...input,
        version: { schemaVersion: "" }
      }).ok).toBe(false);
      expect(validateRegisterToolInput({
        ...input,
        implementation: { kind: "host_function", implementationId: "" }
      }).ok).toBe(false);

      const ref = await fixture.runtime.registerTool(registerEchoTool(fixture, {
        lifecycle: "deprecated",
        compatibility: { notes: "old but usable" }
      }));
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);
      const record = await fixture.runtime.getTool(ref.value);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);

      expect(matchesToolQuery(record.value, { namespace: "other" })).toBe(false);
      expect(matchesToolQuery(record.value, { lifecycle: "active" })).toBe(false);
      expect(matchesToolQuery(record.value, { sourceKind: "workspace_local" })).toBe(false);
      expect(matchesToolQuery(record.value, { text: "ECHO" })).toBe(true);
      expect(surfaceEntry(record.value).compatibilityWarnings).toContain("tool is deprecated");
      expect(surfaceEntry({
        ...record.value,
        implementation: { kind: "none", implementationId: "none" }
      }).compatibilityWarnings).toContain("tool has no executable implementation");
    });
  });

  it("classifies executable states and lifecycle transitions", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeToolRuntimeFixture(workspace);
      const ref = await fixture.runtime.registerTool(registerEchoTool(fixture));
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);
      const record = await fixture.runtime.getTool(ref.value);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);

      expect(executable({ ...record.value, lifecycle: "active" }).ok).toBe(true);
      expect(executable({ ...record.value, lifecycle: "deprecated" }).ok).toBe(true);
      expect(executable({ ...record.value, lifecycle: "retracted" }).ok).toBe(false);
      expect(executable({ ...record.value, lifecycle: "incompatible" }).ok).toBe(false);
      expect(executable({ ...record.value, lifecycle: "unavailable" }).ok).toBe(false);
      expect(executable({ ...record.value, lifecycle: "registered" }).ok).toBe(false);
      expect(transitionAllowed("registered", "registered")).toBe(false);
      expect(transitionAllowed("registered", "discovered")).toBe(false);
      expect(transitionAllowed("discovered", "registered")).toBe(true);
      expect(transitionAllowed("retracted", "active")).toBe(false);
    });
  });

  it("normalizes output variants and redacts policy-sensitive results", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeToolRuntimeFixture(workspace);
      const ref = await fixture.runtime.registerTool(registerEchoTool(fixture));
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);
      const record = await fixture.runtime.getTool(ref.value);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);
      const { outputSchema: _schema, ...noSchema } = record.value;
      void _schema;

      expect(normalizeToolOutput({
        raw: "line1\nline2\nline3",
        definition: noSchema,
        redacted: false,
        maxPreviewChars: 8
      }).ok).toBe(true);
      expect(normalizeToolOutput({ raw: null, definition: noSchema, redacted: false, maxPreviewChars: 20 }).ok).toBe(true);
      expect(normalizeToolOutput({ raw: 42, definition: noSchema, redacted: false, maxPreviewChars: 20 }).ok).toBe(true);
      expect(normalizeToolOutput({ raw: Symbol("bad"), definition: noSchema, redacted: false, maxPreviewChars: 20 }).ok).toBe(false);
      expect(normalizeToolOutput({
        raw: { structuredOutput: { value: Symbol("bad") } },
        definition: noSchema,
        redacted: false,
        maxPreviewChars: 20
      }).ok).toBe(false);

      const redacted = normalizeToolOutput({
        raw: {
          stdout: "secret stdout",
          stderr: "secret stderr",
          structuredOutput: { nested: "secret" },
          sideEffects: [{ kind: "write", summary: "secret side effect" }, { bad: true }]
        },
        definition: noSchema,
        redacted: true,
        maxPreviewChars: 80
      });
      expect(redacted.ok).toBe(true);
      if (!redacted.ok) throw new Error(redacted.error.message);
      expect(redacted.value.outputPreview).toContain("redacted");
      expect(redacted.value.sideEffects).toHaveLength(1);
    });
  });

  it("reports output schema and error object branches", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeToolRuntimeFixture(workspace);
      const ref = await fixture.runtime.registerTool(registerEchoTool(fixture));
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);
      const record = await fixture.runtime.getTool(ref.value);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);

      const missing = normalizeToolOutput({
        raw: { structuredOutput: {} },
        definition: record.value,
        redacted: false,
        maxPreviewChars: 40
      });
      expect(missing.ok).toBe(false);
      expect(errorFromUnknown({ code: "custom", message: "failed", retryable: true }).retryable).toBe(true);
      expect(errorFromUnknown(new Error("boom")).message).toBe("boom");
    });
  });

  it("materializes invalid or redacted JSON artifacts as errors", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeToolRuntimeFixture(workspace);
      const invalid = await fixture.artifacts.registerArtifact({
        kind: "summary",
        content: "{not json",
        mediaType: "application/json",
        encoding: "utf8",
        source: source(fixture),
        version,
        audit: audit("invalid json"),
        privacyClass: "workspace_private",
        retentionClass: "attempt_scoped",
        producerModule: "tool-runtime"
      });
      expect(invalid.ok).toBe(true);
      if (!invalid.ok) throw new Error(invalid.error.message);
      const invalidRead = await materializeJsonArtifact({
        artifactRegistry: fixture.artifacts,
        artifactRef: invalid.value,
        reason: "read invalid"
      });
      expect(invalidRead.ok).toBe(false);

      const redacted = await fixture.artifacts.registerArtifact({
        kind: "summary",
        content: "{}",
        mediaType: "application/json",
        encoding: "utf8",
        source: source(fixture),
        version,
        audit: audit("redacted"),
        privacyClass: "workspace_private",
        retentionClass: "attempt_scoped",
        producerModule: "tool-runtime"
      });
      expect(redacted.ok).toBe(true);
      if (!redacted.ok) throw new Error(redacted.error.message);
      const receipt = await fixture.artifacts.redactArtifact(redacted.value, "hide");
      expect(receipt.ok).toBe(true);
      const redactedRead = await materializeJsonArtifact({
        artifactRegistry: fixture.artifacts,
        artifactRef: redacted.value,
        reason: "read redacted"
      });
      expect(redactedRead.ok).toBe(false);
    });
  });

  it("evaluates generic runtime policy when no capability is declared", async () => {
    await withWorkspace(async (workspace) => {
      const fixture = makeToolRuntimeFixture(workspace);
      const ref = await fixture.runtime.registerTool(registerEchoTool(fixture, {
        declaredCapabilities: []
      }));
      expect(ref.ok).toBe(true);
      if (!ref.ok) throw new Error(ref.error.message);
      const record = await fixture.runtime.getTool(ref.value);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error(record.error.message);
      const policy = await evaluateToolPolicy({
        policyBoundary: fixture.policy,
        definition: record.value,
        request: toolRequest(fixture, ref.value, { requestedCapabilities: [] }),
        context: policyContext("allow")
      });
      expect(policy.ok).toBe(true);
      if (!policy.ok) throw new Error(policy.error.message);
      expect(policy.value.decisions[0]?.capability).toBe("runtime.target_action");
      expect(assertPolicyExecutable(policy.value).ok).toBe(true);
    });
  });

  it("classifies blocked policy checks without executing", () => {
    const denied = assertPolicyExecutable({
      decisions: [],
      executable: false,
      blockedBy: {
        policyDecisionId: "policy-1" as never,
        requestId: "request-1" as never,
        capability: "file.write",
        verdict: "deny",
        constraints: [],
        boundaryDeclaration: {
          capability: "file.write",
          level: "policy_decision",
          enforcedBy: "test",
          limitations: []
        },
        source: {
          kind: "system",
          origin: "test",
          userProvided: false,
          receivedAt: "2026-06-06T00:00:00.000Z",
          privacyLevel: "workspace_private"
        },
        audit: audit("deny"),
        explanation: "denied"
      },
      constraints: [],
      redactionRequired: false
    });
    expect(denied.ok).toBe(false);
    const noDecision = assertPolicyExecutable({
      decisions: [],
      executable: false,
      constraints: [],
      redactionRequired: false
    });
    expect(noDecision.ok).toBe(false);
  });
});

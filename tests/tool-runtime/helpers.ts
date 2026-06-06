import {
  createArtifactRegistry,
  type ArtifactRegistry
} from "../../src/artifact-registry/index.js";
import {
  makeAttemptId,
  makeGrowUnitId,
  makeRef,
  type AuditDescriptor,
  type SourceDescriptor,
  type VersionDescriptor
} from "../../src/domain/index.js";
import { createEventLedger, type EventLedger } from "../../src/event-ledger/index.js";
import { createPolicyBoundary, type PolicyBoundary, type PolicyContext } from "../../src/policy-boundary/index.js";
import { createSkillRegistry, type SkillRegistry } from "../../src/skill-registry/index.js";
import {
  createToolRuntime,
  makeToolCallId,
  type RegisterToolInput,
  type ToolCallRequest,
  type ToolImplementation,
  type ToolRuntime
} from "../../src/tool-runtime/index.js";
import type { TempWorkspace } from "../file-store/helpers.js";

export interface ToolRuntimeFixture extends TempWorkspace {
  readonly ledger: EventLedger;
  readonly artifacts: ArtifactRegistry;
  readonly policy: PolicyBoundary;
  readonly skills: SkillRegistry;
  readonly runtime: ToolRuntime;
}

export const version: VersionDescriptor = {
  schemaVersion: "1",
  producerVersion: "tool-runtime-test"
};

let callSeq = 0;

export function makeToolRuntimeFixture(
  workspace: TempWorkspace,
  implementations: readonly ToolImplementation[] = [echoImplementation()]
): ToolRuntimeFixture {
  const ledger = createEventLedger(workspace.store, {
    workspace: workspace.workspace,
    producer: "tool-runtime-test"
  });
  const artifacts = createArtifactRegistry(workspace.store, {
    workspace: workspace.workspace,
    ledger,
    producer: "tool-runtime-test",
    defaultPreviewChars: 80
  });
  const policy = createPolicyBoundary({ ledger, artifactRegistry: artifacts, producer: "tool-runtime-test" });
  const skills = createSkillRegistry(workspace.store, {
    workspace: workspace.workspace,
    ledger,
    artifactRegistry: artifacts,
    policyBoundary: policy,
    producer: "tool-runtime-test"
  });
  return {
    ...workspace,
    ledger,
    artifacts,
    policy,
    skills,
    runtime: createToolRuntime({
      workspace: workspace.workspace,
      store: workspace.store,
      ledger,
      artifactRegistry: artifacts,
      policyBoundary: policy,
      skillRegistry: skills,
      producer: "tool-runtime-test",
      implementations,
      maxInlineInputBytes: 4 * 1024,
      maxOutputPreviewChars: 64,
      defaultTimeoutMs: 500
    })
  };
}

export function source(fixture: ToolRuntimeFixture, kind: SourceDescriptor["kind"] = "system"): SourceDescriptor {
  return {
    kind,
    origin: "tool-runtime-test",
    workspace: fixture.workspace.id,
    userProvided: kind === "user",
    receivedAt: "2026-06-06T00:00:00.000Z",
    privacyLevel: "workspace_private"
  };
}

export function audit(reason: string): AuditDescriptor {
  return {
    createdAt: "2026-06-06T00:00:00.000Z",
    createdBy: "tool-runtime-test",
    reason
  };
}

export function registerEchoTool(
  fixture: ToolRuntimeFixture,
  extra: Partial<RegisterToolInput> = {}
): RegisterToolInput {
  return {
    name: "echo",
    namespace: "test",
    version,
    lifecycle: "active",
    sourceKind: "system_default",
    source: source(fixture),
    description: "Echoes prompt input.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", maxLength: 200 },
        path: { type: "string", format: "workspace_path" }
      },
      required: ["prompt"],
      additionalProperties: false
    },
    outputSchema: {
      type: "object",
      properties: { echoed: { type: "string" } },
      required: ["echoed"],
      additionalProperties: false
    },
    outputSchemaSummary: "structured echoed text",
    declaredCapabilities: ["file.read"],
    risk: "low",
    sideEffects: {
      mutatesWorkspace: false,
      mutatesExternalWorld: false,
      readsSecrets: false,
      networkAccess: false,
      summary: "read-only echo"
    },
    implementation: { kind: "host_function", implementationId: "echo" },
    privacyClass: "workspace_private",
    audit: audit("register echo tool"),
    ...extra
  };
}

export function toolRequest(
  fixture: ToolRuntimeFixture,
  toolRef: ToolCallRequest["toolRef"],
  extra: Partial<ToolCallRequest> = {}
): ToolCallRequest {
  callSeq += 1;
  return {
    toolCallId: makeToolCallId(`tool-call-${callSeq}`),
    toolRef,
    growUnitRef: makeRef("grow_unit", makeGrowUnitId("grow-1")),
    attemptRef: makeRef("attempt", makeAttemptId("attempt-1")),
    requestedBy: "grow_attempt_runner",
    input: { prompt: "hello" },
    reason: "unit test tool call",
    source: source(fixture, "runtime"),
    version,
    audit: audit("call tool"),
    ...extra
  };
}

export function policyContext(
  verdict: "allow" | "deny" | "ask" | "allow_with_redaction" | "allow_with_constraints" = "allow"
): PolicyContext {
  return {
    caller: "tool-runtime-test",
    environment: {
      hostSandboxAvailable: true,
      networkAvailable: true,
      externalEnforcementAvailable: true,
      secretStoreAvailable: true
    },
    rules: [{ capability: "*", resource: "*", verdict }]
  };
}

export function echoImplementation(extra: Partial<ToolImplementation> = {}): ToolImplementation {
  let calls = 0;
  return {
    implementationId: "echo",
    execute: ({ input }) => {
      calls += 1;
      const prompt = readPrompt(input);
      return {
        stdout: `echo:${prompt}`,
        structuredOutput: { echoed: prompt },
        sideEffects: [{ kind: "none", summary: "no side effects" }]
      };
    },
    calls: () => calls,
    ...extra
  } as ToolImplementation & { readonly calls: () => number };
}

export function implementationCalls(implementation: ToolImplementation): number {
  const calls = (implementation as ToolImplementation & { readonly calls?: () => number }).calls;
  return calls === undefined ? 0 : calls();
}

export async function readJsonArtifact<T>(fixture: ToolRuntimeFixture, ref: Parameters<ArtifactRegistry["materializeArtifact"]>[0]): Promise<T> {
  const materialized = await fixture.artifacts.materializeArtifact(ref, {
    reason: "read test artifact",
    allowArchived: true,
    maxBytes: 1024 * 1024
  });
  if (!materialized.ok || typeof materialized.value.content !== "string") {
    throw new Error("expected readable JSON artifact");
  }
  return JSON.parse(materialized.value.content) as T;
}

function readPrompt(input: unknown): string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return "";
  return String((input as Record<string, unknown>)["prompt"] ?? "");
}

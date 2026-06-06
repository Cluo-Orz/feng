import { randomUUID } from "node:crypto";
import type { ArtifactRef, AuditDescriptor, PrivacyLevel, SourceDescriptor, TargetWorldRef } from "../domain/index.js";
import type { Result } from "../domain/result.js";
import type { EventAppendReceipt } from "../event-ledger/index.js";
import { makePolicyRequestId, type PolicyContext, type PolicyDecision } from "../policy-boundary/index.js";
import { runtimeEventTypes, runtimeInvocationStream, runtimeTraceStream } from "./events.js";
import { payload } from "./payloads.js";
import { AgentRuntimeStorage } from "./storage.js";
import type { AgentRuntimeKernelOptions, RuntimeInvocation } from "./types.js";
import type { RuntimeInvocationRef, RuntimeTraceRef } from "./refs.js";

export interface AgentRuntime {
  readonly options: AgentRuntimeKernelOptions;
  readonly storage: AgentRuntimeStorage;
  readonly kernelVersion: string;
}

export function createAgentRuntime(options: AgentRuntimeKernelOptions): AgentRuntime {
  return {
    options,
    storage: new AgentRuntimeStorage(options.store, options.workspace),
    kernelVersion: options.runtimeKernelVersion ?? "agent-runtime-kernel@0.1.0"
  };
}

export async function appendRuntimeEvent(input: {
  readonly runtime: AgentRuntime;
  readonly invocationRef: RuntimeInvocationRef;
  readonly eventType: string;
  readonly body: Record<string, unknown>;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly correlationId?: string | undefined;
}): Promise<Result<EventAppendReceipt>> {
  return input.runtime.options.ledger.appendEvent(runtimeInvocationStream(input.invocationRef), {
    eventType: input.eventType,
    eventVersion: "1",
    payload: payload(input.body),
    source: input.source,
    audit: input.audit,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    producer: input.runtime.options.producer
  });
}

export async function appendTraceEvent(input: {
  readonly runtime: AgentRuntime;
  readonly traceRef: RuntimeTraceRef;
  readonly eventType: string;
  readonly body: Record<string, unknown>;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly correlationId?: string | undefined;
}): Promise<Result<EventAppendReceipt>> {
  return input.runtime.options.ledger.appendEvent(runtimeTraceStream(input.traceRef), {
    eventType: input.eventType,
    eventVersion: "1",
    payload: payload(input.body),
    source: input.source,
    audit: input.audit,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    producer: input.runtime.options.producer
  });
}

export async function registerRuntimeArtifact(input: {
  readonly runtime: AgentRuntime;
  readonly kind: "runtime_message_list" | "runtime_trace" | "candidate_output" | "summary";
  readonly content: unknown;
  readonly privacyClass: PrivacyLevel;
  readonly source: SourceDescriptor;
  readonly version: import("../domain/index.js").VersionDescriptor;
  readonly audit: AuditDescriptor;
  readonly parentRefs?: readonly ArtifactRef[] | undefined;
  readonly correlationId?: string | undefined;
}): Promise<Result<ArtifactRef>> {
  const artifact = {
    kind: input.kind,
    content: JSON.stringify(input.content, null, 2),
    mediaType: "application/json",
    encoding: "utf8",
    source: input.source,
    version: input.version,
    audit: input.audit,
    privacyClass: input.privacyClass,
    retentionClass: "runtime_scoped",
    producerModule: "agent-runtime-kernel",
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId })
  } as const;
  const parents = input.parentRefs ?? [];
  return parents.length === 0
    ? input.runtime.options.artifactRegistry.registerArtifact(artifact)
    : input.runtime.options.artifactRegistry.registerDerivedArtifact({ ...artifact, parentRefs: parents });
}

export async function evaluateRuntimePolicy(input: {
  readonly runtime: AgentRuntime;
  readonly invocation: RuntimeInvocation;
  readonly capability: string;
  readonly operation: string;
  readonly resourceSummary: string;
  readonly reason: string;
  readonly source: SourceDescriptor;
  readonly targetWorldRef?: TargetWorldRef | undefined;
  readonly context?: PolicyContext | undefined;
}): Promise<Result<PolicyDecision>> {
  return input.runtime.options.policyBoundary.evaluateAction({
    requestId: makePolicyRequestId(`runtime-policy-${randomUUID()}`),
    capability: input.capability,
    requestedByModule: "agent-runtime-kernel",
    workspace: input.runtime.options.workspace.id,
    runtime: input.invocation.runtimeInvocationRef.id,
    targetWorld: (input.targetWorldRef ?? input.invocation.targetWorldRef).id,
    resourceSummary: input.resourceSummary,
    operation: input.operation,
    reason: input.reason,
    source: input.source,
    ...(input.invocation.correlationId === undefined ? {} : { correlationId: input.invocation.correlationId })
  }, {
    caller: "agent-runtime-kernel",
    environment: input.context?.environment ?? {
      hostSandboxAvailable: false,
      networkAvailable: true,
      externalEnforcementAvailable: false,
      secretStoreAvailable: false
    },
    ...(input.context?.rules === undefined ? {} : { rules: input.context.rules }),
    ...(input.context?.activeGrants === undefined ? {} : { activeGrants: input.context.activeGrants }),
    ...(input.context?.runtimeContract === undefined ? {} : { runtimeContract: input.context.runtimeContract }),
    ...(input.context?.targetWorldContract === undefined ? {} : { targetWorldContract: input.context.targetWorldContract })
  });
}

export function policyAllows(decision: PolicyDecision): boolean {
  return decision.verdict === "allow" || decision.verdict === "allow_with_constraints" || decision.verdict === "allow_with_redaction";
}

export { runtimeEventTypes };

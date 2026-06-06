import { randomUUID } from "node:crypto";
import type { ArtifactRef, AuditDescriptor, SourceDescriptor, TargetWorldRef, PrivacyLevel } from "../domain/index.js";
import type { Result } from "../domain/result.js";
import type { EventAppendReceipt } from "../event-ledger/index.js";
import { makePolicyRequestId } from "../policy-boundary/brand.js";
import type { PolicyContext, PolicyDecision } from "../policy-boundary/index.js";
import { targetWorldEventTypes, targetWorldStream, workspaceTargetWorldStream } from "./events.js";
import { payload } from "./payloads.js";
import { TargetWorldAdapterStorage } from "./storage.js";
import type { TargetWorldAdapterOptions } from "./types.js";

export interface TargetWorldRuntime {
  readonly options: TargetWorldAdapterOptions;
  readonly storage: TargetWorldAdapterStorage;
}

export function createTargetWorldRuntime(options: TargetWorldAdapterOptions): TargetWorldRuntime {
  return { options, storage: new TargetWorldAdapterStorage(options.store, options.workspace) };
}

export async function appendTargetWorldEvent(input: {
  readonly runtime: TargetWorldRuntime;
  readonly targetWorldRef?: TargetWorldRef;
  readonly eventType: string;
  readonly body: Record<string, unknown>;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly correlationId?: string;
}): Promise<Result<EventAppendReceipt>> {
  const stream = input.targetWorldRef === undefined
    ? workspaceTargetWorldStream(input.runtime.options.workspace.id)
    : targetWorldStream(input.targetWorldRef);
  return input.runtime.options.ledger.appendEvent(stream, {
    eventType: input.eventType,
    eventVersion: "1",
    payload: payload(input.body),
    source: input.source,
    audit: input.audit,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    producer: input.runtime.options.producer
  });
}

export async function registerTargetArtifact(input: {
  readonly runtime: TargetWorldRuntime;
  readonly kind: "summary" | "validation_report";
  readonly content: unknown;
  readonly mediaType?: string;
  readonly privacyClass: PrivacyLevel;
  readonly retentionClass?: "grow_scoped" | "runtime_scoped" | "hatch_scoped" | "archive";
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}): Promise<Result<ArtifactRef>> {
  return input.runtime.options.artifactRegistry.registerArtifact({
    kind: input.kind,
    content: JSON.stringify(input.content, null, 2),
    mediaType: input.mediaType ?? "application/json",
    encoding: "utf8",
    source: input.source,
    version: { schemaVersion: "1.0.0", producerVersion: "target-world-adapter" },
    audit: input.audit,
    privacyClass: input.privacyClass,
    retentionClass: input.retentionClass ?? "runtime_scoped",
    producerModule: "target-world-adapter"
  });
}

export async function evaluateTargetPolicy(input: {
  readonly runtime: TargetWorldRuntime;
  readonly capability: string;
  readonly targetWorldRef: TargetWorldRef;
  readonly resourceSummary: string;
  readonly operation: string;
  readonly reason: string;
  readonly source: SourceDescriptor;
  readonly context?: PolicyContext;
}): Promise<Result<PolicyDecision>> {
  return input.runtime.options.policyBoundary.evaluateAction({
    requestId: makePolicyRequestId(`target-policy-${randomUUID()}`),
    capability: input.capability,
    requestedByModule: "target-world-adapter",
    workspace: input.runtime.options.workspace.id,
    targetWorld: input.targetWorldRef.id,
    resourceSummary: input.resourceSummary,
    operation: input.operation,
    reason: input.reason,
    source: input.source
  }, {
    caller: "target-world-adapter",
    environment: {
      hostSandboxAvailable: false,
      networkAvailable: true,
      externalEnforcementAvailable: input.context?.environment.externalEnforcementAvailable ?? false,
      secretStoreAvailable: false
    },
    ...(input.context?.rules === undefined ? {} : { rules: input.context.rules }),
    ...(input.context?.activeGrants === undefined ? {} : { activeGrants: input.context.activeGrants }),
    ...(input.context?.targetWorldContract === undefined ? {} : { targetWorldContract: input.context.targetWorldContract }),
    ...(input.context?.runtimeContract === undefined ? {} : { runtimeContract: input.context.runtimeContract })
  });
}

export function policyAllows(decision: PolicyDecision): boolean {
  return decision.verdict === "allow" || decision.verdict === "allow_with_constraints" || decision.verdict === "allow_with_redaction";
}

export { targetWorldEventTypes };

import { randomUUID } from "node:crypto";
import type { ArtifactRef, AuditDescriptor, PrivacyLevel, SourceDescriptor } from "../domain/index.js";
import type { Result } from "../domain/result.js";
import type { EventAppendReceipt } from "../event-ledger/index.js";
import { makePolicyRequestId } from "../policy-boundary/brand.js";
import type { PolicyContext, PolicyDecision } from "../policy-boundary/index.js";
import { debugBridgeStream } from "./events.js";
import { payload } from "./payloads.js";
import { DebugBridgeStorage } from "./storage.js";
import type { DebugCorrelationRef } from "./types.js";
import type { DebugFeedbackBridgeOptions } from "./ports.js";

export interface DebugBridgeRuntime {
  readonly options: DebugFeedbackBridgeOptions;
  readonly storage: DebugBridgeStorage;
}

export function createDebugBridgeRuntime(options: DebugFeedbackBridgeOptions): DebugBridgeRuntime {
  return { options, storage: new DebugBridgeStorage(options.store, options.workspace) };
}

export async function appendBridgeEvent(input: {
  readonly runtime: DebugBridgeRuntime;
  readonly correlationRef: DebugCorrelationRef;
  readonly eventType: string;
  readonly body: Record<string, unknown>;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly correlationId?: string;
}): Promise<Result<EventAppendReceipt>> {
  return input.runtime.options.ledger.appendEvent(debugBridgeStream(input.correlationRef.id), {
    eventType: input.eventType,
    eventVersion: "1",
    payload: payload(input.body),
    source: input.source,
    audit: input.audit,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    producer: input.runtime.options.producer
  });
}

export async function registerBridgeArtifact(input: {
  readonly runtime: DebugBridgeRuntime;
  readonly kind: "summary" | "feedback_evidence";
  readonly content: unknown;
  readonly privacyClass: PrivacyLevel;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}): Promise<Result<ArtifactRef>> {
  return input.runtime.options.artifactRegistry.registerArtifact({
    kind: input.kind,
    content: JSON.stringify(input.content, null, 2),
    mediaType: "application/json",
    encoding: "utf8",
    source: input.source,
    version: { schemaVersion: "1.0.0", producerVersion: "debug-feedback-bridge" },
    audit: input.audit,
    privacyClass: input.privacyClass,
    retentionClass: "runtime_scoped",
    producerModule: "debug-feedback-bridge"
  });
}

export async function evaluateBridgePolicyDecision(input: {
  readonly runtime: DebugBridgeRuntime;
  readonly capability: string;
  readonly resourceSummary: string;
  readonly operation: string;
  readonly reason: string;
  readonly source: SourceDescriptor;
  readonly context?: PolicyContext;
}): Promise<Result<PolicyDecision>> {
  return input.runtime.options.policyBoundary.evaluateAction({
    requestId: makePolicyRequestId(`bridge-policy-${randomUUID()}`),
    capability: input.capability,
    requestedByModule: "debug-feedback-bridge",
    workspace: input.runtime.options.workspace.id,
    resourceSummary: input.resourceSummary,
    operation: input.operation,
    reason: input.reason,
    source: input.source
  }, {
    caller: "debug-feedback-bridge",
    environment: {
      hostSandboxAvailable: false,
      networkAvailable: true,
      externalEnforcementAvailable: input.context?.environment.externalEnforcementAvailable ?? false,
      secretStoreAvailable: false
    },
    ...(input.context?.rules === undefined ? {} : { rules: input.context.rules }),
    ...(input.context?.activeGrants === undefined ? {} : { activeGrants: input.context.activeGrants }),
    ...(input.context?.runtimeContract === undefined ? {} : { runtimeContract: input.context.runtimeContract }),
    ...(input.context?.targetWorldContract === undefined ? {} : { targetWorldContract: input.context.targetWorldContract })
  });
}

export function policyAllows(decision: PolicyDecision): boolean {
  return decision.verdict === "allow"
    || decision.verdict === "allow_with_constraints"
    || decision.verdict === "allow_with_redaction";
}

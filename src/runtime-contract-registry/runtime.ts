import { randomUUID } from "node:crypto";
import { ok, type Result } from "../domain/result.js";
import type { AuditDescriptor, GrowUnitRef, SourceDescriptor } from "../domain/index.js";
import { makePolicyRequestId } from "../policy-boundary/brand.js";
import type { PolicyContext, PolicyDecision } from "../policy-boundary/index.js";
import type { EventAppendReceipt } from "../event-ledger/index.js";
import { runtimeContractGrowStream } from "./events.js";
import { contractErr } from "./errors.js";
import { payload } from "./payloads.js";
import { RuntimeContractStorage } from "./storage.js";
import type { RuntimeContractRecord, RuntimeContractRegistryOptions } from "./types.js";

export interface RuntimeContractRuntime {
  readonly options: RuntimeContractRegistryOptions;
  readonly storage: RuntimeContractStorage;
}

export function createRuntimeContractRuntime(options: RuntimeContractRegistryOptions): RuntimeContractRuntime {
  return { options, storage: new RuntimeContractStorage(options.store, options.workspace) };
}

export async function ensureGrowUnitWritable(runtime: RuntimeContractRuntime, growUnitRef: GrowUnitRef): Promise<Result<void>> {
  const record = await runtime.options.growUnitManager.getGrowUnit(growUnitRef);
  if (!record.ok) return record;
  if (record.value.lifecycle === "archived") {
    return contractErr({ code: "grow_unit_archived", message: "archived grow unit cannot change runtime contract" });
  }
  return ok(undefined);
}

export async function appendContractEvent(input: {
  readonly runtime: RuntimeContractRuntime;
  readonly record: RuntimeContractRecord;
  readonly eventType: string;
  readonly body: Record<string, unknown>;
  readonly source?: SourceDescriptor;
  readonly audit?: AuditDescriptor;
}): Promise<Result<EventAppendReceipt>> {
  return input.runtime.options.ledger.appendEvent(runtimeContractGrowStream(input.record.growUnitRef), {
    eventType: input.eventType,
    eventVersion: "1",
    payload: payload(input.body),
    source: input.source ?? input.record.source,
    audit: input.audit ?? input.record.audit,
    producer: input.runtime.options.producer
  });
}

export async function evaluateContractArtifactPolicy(input: {
  readonly runtime: RuntimeContractRuntime;
  readonly record: RuntimeContractRecord;
  readonly capability: string;
  readonly operation: string;
  readonly reason: string;
  readonly context?: PolicyContext;
}): Promise<Result<PolicyDecision>> {
  const artifact = await input.runtime.options.artifactRegistry.resolveArtifact(input.record.artifactRef);
  if (!artifact.ok) return artifact;
  return input.runtime.options.policyBoundary.evaluateAction({
    requestId: makePolicyRequestId(`policy-request-${randomUUID()}`),
    capability: input.capability,
    requestedByModule: "runtime-contract-registry",
    workspace: input.runtime.options.workspace.id,
    growUnit: input.record.growUnitRef.id,
    artifactRefs: [input.record.artifactRef],
    resourceSummary: `runtime-contract:${input.record.runtimeContractRef.id}`,
    operation: input.operation,
    reason: input.reason,
    source: input.record.source
  }, {
    caller: "runtime-contract-registry",
    environment: {
      hostSandboxAvailable: false,
      networkAvailable: true,
      externalEnforcementAvailable: false,
      secretStoreAvailable: false
    },
    ...(input.context?.rules === undefined ? {} : { rules: input.context.rules }),
    ...(input.context?.activeGrants === undefined ? {} : { activeGrants: input.context.activeGrants }),
    artifactSummaries: [{
      artifactRef: artifact.value.artifactRef,
      privacyClass: artifact.value.privacyClass,
      retentionClass: artifact.value.retentionClass,
      lifecycle: artifact.value.lifecycle,
      sourceKind: artifact.value.source.kind
    }]
  });
}

export function unsupportedCapabilities(runtime: RuntimeContractRuntime, capabilities: readonly string[]): readonly string[] {
  return capabilities.filter((capability) => {
    const boundary = runtime.options.policyBoundary.describeBoundary(capability, {
      hostSandboxAvailable: false,
      networkAvailable: true,
      externalEnforcementAvailable: false,
      secretStoreAvailable: false
    });
    return !boundary.ok || boundary.value.level === "unsupported";
  });
}

import { randomUUID } from "node:crypto";
import type { ArtifactRecord, ArtifactMaterialization } from "../artifact-registry/index.js";
import type { ArtifactRef, AuditDescriptor, GrowUnitRef, SourceDescriptor } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import type { EventAppendReceipt } from "../event-ledger/index.js";
import { makePolicyRequestId } from "../policy-boundary/brand.js";
import type { PolicyContext, PolicyDecision } from "../policy-boundary/index.js";
import { evidenceGrowStream } from "./events.js";
import { evidenceErr } from "./errors.js";
import { payload } from "./payloads.js";
import { EvidenceStorage } from "./storage.js";
import type { EvidenceReadinessOptions } from "./types.js";

export interface EvidenceRuntime {
  readonly options: EvidenceReadinessOptions;
  readonly storage: EvidenceStorage;
}

export function createEvidenceRuntime(options: EvidenceReadinessOptions): EvidenceRuntime {
  return { options, storage: new EvidenceStorage(options.store, options.workspace) };
}

export async function ensureGrowUnitWritable(runtime: EvidenceRuntime, growUnitRef: GrowUnitRef): Promise<Result<void>> {
  const record = await runtime.options.growUnitManager.getGrowUnit(growUnitRef);
  if (!record.ok) return record;
  if (record.value.lifecycle === "archived") {
    return evidenceErr({ code: "grow_unit_archived", message: "archived grow unit cannot change evidence readiness" });
  }
  return ok(undefined);
}

export async function appendEvidenceEvent(input: {
  readonly runtime: EvidenceRuntime;
  readonly growUnitRef: GrowUnitRef;
  readonly eventType: string;
  readonly body: Record<string, unknown>;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}): Promise<Result<EventAppendReceipt>> {
  return input.runtime.options.ledger.appendEvent(evidenceGrowStream(input.growUnitRef), {
    eventType: input.eventType,
    eventVersion: "1",
    payload: payload(input.body),
    source: input.source,
    audit: input.audit,
    producer: input.runtime.options.producer
  });
}

export async function resolveArtifactForEvidence(
  runtime: EvidenceRuntime,
  artifactRef: ArtifactRef
): Promise<Result<ArtifactRecord>> {
  const record = await runtime.options.artifactRegistry.resolveArtifact(artifactRef);
  if (!record.ok) return record.error.code === "not_found"
    ? evidenceErr({ code: "artifact_unavailable", message: "evidence artifact is missing" })
    : record;
  return record;
}

export async function materializeEvidenceArtifact(
  runtime: EvidenceRuntime,
  artifactRef: ArtifactRef,
  reason: string
): Promise<Result<ArtifactMaterialization>> {
  const materialized = await runtime.options.artifactRegistry.materializeArtifact(artifactRef, {
    reason,
    maxBytes: 64 * 1024,
    allowArchived: true
  });
  if (!materialized.ok) return materialized.error.code === "not_found"
    ? evidenceErr({ code: "artifact_unavailable", message: "evidence artifact is missing" })
    : materialized;
  return materialized;
}

export async function evaluateArtifactPolicy(input: {
  readonly runtime: EvidenceRuntime;
  readonly record: ArtifactRecord;
  readonly growUnitRef: GrowUnitRef;
  readonly source: SourceDescriptor;
  readonly reason: string;
  readonly context?: PolicyContext;
}): Promise<Result<PolicyDecision>> {
  return input.runtime.options.policyBoundary.evaluateAction({
    requestId: makePolicyRequestId(`policy-request-${randomUUID()}`),
    capability: "artifact.read",
    requestedByModule: "evidence-readiness",
    workspace: input.runtime.options.workspace.id,
    growUnit: input.growUnitRef.id,
    artifactRefs: [input.record.artifactRef],
    resourceSummary: `artifact:${input.record.artifactId}`,
    operation: "read evidence artifact",
    reason: input.reason,
    source: input.source
  }, {
    caller: "evidence-readiness",
    environment: {
      hostSandboxAvailable: false,
      networkAvailable: true,
      externalEnforcementAvailable: false,
      secretStoreAvailable: false
    },
    ...(input.context?.rules === undefined ? {} : { rules: input.context.rules }),
    ...(input.context?.activeGrants === undefined ? {} : { activeGrants: input.context.activeGrants }),
    artifactSummaries: [{
      artifactRef: input.record.artifactRef,
      privacyClass: input.record.privacyClass,
      retentionClass: input.record.retentionClass,
      lifecycle: input.record.lifecycle,
      sourceKind: input.record.source.kind
    }]
  });
}

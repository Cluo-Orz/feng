import { randomUUID } from "node:crypto";
import type { AuditDescriptor, SourceDescriptor } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import { makePolicyRequestId } from "../policy-boundary/brand.js";
import type { PolicyContext, PolicyDecision } from "../policy-boundary/index.js";
import type { EventAppendReceipt } from "../event-ledger/index.js";
import { hatchGrowStream, hatchPackageStream } from "./events.js";
import { payload } from "./payloads.js";
import { HatchBuilderStorage } from "./storage.js";
import type { HatchBuilderOptions, HatchPackageRecord, HatchRequestRecord } from "./types.js";

export interface HatchRuntime {
  readonly options: HatchBuilderOptions;
  readonly storage: HatchBuilderStorage;
}

export function createHatchRuntime(options: HatchBuilderOptions): HatchRuntime {
  return { options, storage: new HatchBuilderStorage(options.store, options.workspace) };
}

export async function appendHatchGrowEvent(input: {
  readonly runtime: HatchRuntime;
  readonly request: HatchRequestRecord;
  readonly eventType: string;
  readonly body: Record<string, unknown>;
}): Promise<Result<EventAppendReceipt>> {
  return input.runtime.options.ledger.appendEvent(hatchGrowStream(input.request.growUnitRef), {
    eventType: input.eventType,
    eventVersion: "1",
    payload: payload(input.body),
    source: input.request.source,
    audit: input.request.audit,
    producer: input.runtime.options.producer
  });
}

export async function appendHatchPackageEvent(input: {
  readonly runtime: HatchRuntime;
  readonly record: HatchPackageRecord;
  readonly eventType: string;
  readonly body: Record<string, unknown>;
  readonly source?: SourceDescriptor;
  readonly audit?: AuditDescriptor;
}): Promise<Result<EventAppendReceipt>> {
  return input.runtime.options.ledger.appendEvent(hatchPackageStream(input.record.hatchPackageRef), {
    eventType: input.eventType,
    eventVersion: "1",
    payload: payload(input.body),
    source: input.source ?? input.record.source,
    audit: input.audit ?? input.record.audit,
    producer: input.runtime.options.producer
  });
}

export async function evaluateHatchPolicy(input: {
  readonly runtime: HatchRuntime;
  readonly capability: string;
  readonly resourceSummary: string;
  readonly operation: string;
  readonly reason: string;
  readonly source: SourceDescriptor;
  readonly growUnit?: HatchRequestRecord["growUnitRef"];
  readonly context?: PolicyContext;
}): Promise<Result<PolicyDecision>> {
  return input.runtime.options.policyBoundary.evaluateAction({
    requestId: makePolicyRequestId(`hatch-policy-${randomUUID()}`),
    capability: input.capability,
    requestedByModule: "hatch-builder",
    workspace: input.runtime.options.workspace.id,
    ...(input.growUnit === undefined ? {} : { growUnit: input.growUnit.id }),
    resourceSummary: input.resourceSummary,
    operation: input.operation,
    reason: input.reason,
    source: input.source
  }, {
    caller: "hatch-builder",
    environment: {
      hostSandboxAvailable: false,
      networkAvailable: true,
      externalEnforcementAvailable: false,
      secretStoreAvailable: false
    },
    ...(input.context?.rules === undefined ? {} : { rules: input.context.rules }),
    ...(input.context?.activeGrants === undefined ? {} : { activeGrants: input.context.activeGrants })
  });
}

export function policyAllows(decision: PolicyDecision): boolean {
  return decision.verdict === "allow" || decision.verdict === "allow_with_constraints" || decision.verdict === "allow_with_redaction";
}

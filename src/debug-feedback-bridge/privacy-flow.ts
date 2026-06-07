import { ok, type Result } from "../domain/result.js";
import type { ArtifactRef, AuditDescriptor, PrivacyLevel, SourceDescriptor } from "../domain/index.js";
import type { PolicyDecision } from "../policy-boundary/index.js";
import { debugBridgeEventTypes } from "./events.js";
import { bridgeErr } from "./errors.js";
import { bounded, derivePrivacy, newPrivacyRef } from "./logic.js";
import {
  appendBridgeEvent,
  evaluateBridgePolicyDecision,
  registerBridgeArtifact,
  type DebugBridgeRuntime
} from "./runtime.js";
import type { BridgePolicyActionRequest, BridgePrivacyInput } from "./ports.js";
import type {
  DebugCorrelation,
  DebugCorrelationRef,
  PrivacyFilterResult,
  PrivacyFilterResultRef
} from "./types.js";

export async function buildRedactedBridgeSummaryRecord(
  runtime: DebugBridgeRuntime,
  ref: DebugCorrelationRef,
  inputRefs: readonly ArtifactRef[],
  summary: string,
  source: SourceDescriptor,
  audit: AuditDescriptor
): Promise<Result<ArtifactRef>> {
  const correlation = await runtime.storage.readCorrelation(ref);
  if (!correlation.ok) return correlation;
  return registerBridgeArtifact({
    runtime,
    kind: "summary",
    content: { debugCorrelationRef: ref, redactedFrom: inputRefs, summary: bounded(summary, 4_000) },
    privacyClass: "workspace_private",
    source,
    audit
  });
}

export async function computePrivacyFilter(
  runtime: DebugBridgeRuntime,
  correlation: DebugCorrelation,
  input: {
    readonly inputArtifactRefs: readonly ArtifactRef[];
    readonly privacyClasses: readonly PrivacyLevel[];
    readonly intent: "local" | "upstream";
    readonly summary: string;
    readonly source: SourceDescriptor;
    readonly audit: AuditDescriptor;
  }
): Promise<Result<PrivacyFilterResult>> {
  const derived = derivePrivacy(input.privacyClasses, input.intent);
  let redactedSummaryRef: ArtifactRef | undefined;
  if (derived.requiresRedaction && derived.decision !== "waiting_policy") {
    const redacted = await buildRedactedBridgeSummaryRecord(
      runtime,
      correlation.debugCorrelationRef,
      input.inputArtifactRefs,
      input.summary,
      input.source,
      input.audit
    );
    if (!redacted.ok) return redacted;
    redactedSummaryRef = redacted.value;
  }
  const filterRef = newPrivacyRef();
  const blockedRefs: readonly ArtifactRef[] = [];
  const record: PrivacyFilterResult = {
    privacyFilterId: filterRef.id,
    privacyFilterRef: filterRef,
    debugCorrelationRef: correlation.debugCorrelationRef,
    inputArtifactRefs: input.inputArtifactRefs,
    originalPrivacyClasses: input.privacyClasses,
    resultPrivacyClass: derived.resultPrivacyClass,
    ...(redactedSummaryRef === undefined ? {} : { redactedSummaryRef }),
    redactedEvidenceRefs: redactedSummaryRef === undefined ? [] : [redactedSummaryRef],
    blockedRefs,
    decision: derived.decision,
    reason: privacyReason(derived.decision),
    source: input.source,
    audit: input.audit
  };
  return ok(record);
}

export async function evaluateBridgePrivacyRecord(
  runtime: DebugBridgeRuntime,
  ref: DebugCorrelationRef,
  input: BridgePrivacyInput
): Promise<Result<PrivacyFilterResultRef>> {
  const correlation = await runtime.storage.readCorrelation(ref);
  if (!correlation.ok) return correlation;
  const filter = await computePrivacyFilter(runtime, correlation.value, {
    inputArtifactRefs: input.inputArtifactRefs,
    privacyClasses: input.privacyClasses,
    intent: input.intent,
    summary: "bridge privacy evaluation",
    source: input.source,
    audit: input.audit
  });
  if (!filter.ok) return filter;
  const write = await runtime.storage.writePrivacy(filter.value, "write privacy filter result");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addPrivacy(filter.value.privacyFilterRef);
  if (!indexed.ok) return indexed;
  const event = await appendBridgeEvent({
    runtime,
    correlationRef: ref,
    eventType: debugBridgeEventTypes.privacyFilterApplied,
    body: { privacyFilterRef: filter.value.privacyFilterRef, decision: filter.value.decision },
    source: input.source,
    audit: input.audit
  });
  return event.ok ? ok(filter.value.privacyFilterRef) : event;
}

export async function evaluateBridgePolicyRecord(
  runtime: DebugBridgeRuntime,
  input: BridgePolicyActionRequest
): Promise<Result<PolicyDecision>> {
  const correlation = await runtime.storage.readCorrelation(input.debugCorrelationRef);
  if (!correlation.ok) return correlation;
  return evaluateBridgePolicyDecision({
    runtime,
    capability: input.capability,
    resourceSummary: input.resourceSummary,
    operation: input.operation,
    reason: input.reason,
    source: input.source,
    ...(input.policyContext === undefined ? {} : { context: input.policyContext })
  });
}

const privacyReasons: Record<PrivacyFilterResult["decision"], string> = {
  pass_local: "no sensitive content detected; report stays local",
  redact_then_local: "sensitive content detected; redacted summary used for local feedback",
  redact_then_upstream_candidate: "cross-layer propagation must use the redacted summary, never raw content",
  block_upstream: "upstream propagation is blocked by policy or privacy boundary",
  block_all: "all propagation is blocked",
  waiting_policy: "privacy class is unknown; waiting for policy decision before any propagation",
  waiting_human: "waiting for human review before propagation"
};

function privacyReason(decision: PrivacyFilterResult["decision"]): string {
  return privacyReasons[decision];
}

export function bridgePrivacyGuard(record: PrivacyFilterResult, intent: "local" | "upstream"): Result<void> {
  if (record.decision === "waiting_policy") {
    return bridgeErr({ code: "privacy_blocked", message: record.reason });
  }
  if (intent === "upstream" && record.decision === "block_upstream") {
    return bridgeErr({ code: "privacy_blocked", message: record.reason });
  }
  if (intent === "upstream" && record.redactedSummaryRef === undefined) {
    return bridgeErr({ code: "redaction_required", message: "upstream propagation requires a redacted summary" });
  }
  return ok(undefined);
}

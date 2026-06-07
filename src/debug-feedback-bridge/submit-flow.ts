import { ok, type Result } from "../domain/result.js";
import type { FeedbackUnitRef } from "../domain/index.js";
import type { UpstreamProposalRef } from "../admission-feedback-inbox/index.js";
import { debugBridgeEventTypes } from "./events.js";
import { bridgeErr } from "./errors.js";
import { newProposalRequestRef, toAdmissionLayer } from "./logic.js";
import { appendBridgeEvent, type DebugBridgeRuntime } from "./runtime.js";
import type { BridgeReceipt, RecordUpstreamBridgeResultInput, RequestUpstreamProposalInput } from "./ports.js";
import type {
  FeedbackAttribution,
  FeedbackBridgePacket,
  FeedbackBridgePacketRef,
  UpstreamProposalRequest,
  UpstreamProposalRequestRef
} from "./types.js";

export async function submitFeedbackCandidateRecord(
  runtime: DebugBridgeRuntime,
  ref: FeedbackBridgePacketRef
): Promise<Result<FeedbackBridgePacket>> {
  const packet = await runtime.storage.readPacket(ref);
  if (!packet.ok) return packet;
  if (packet.value.feedbackUnitRef !== undefined) {
    return bridgeErr({ code: "invalid_state", message: "feedback candidate already submitted for this packet" });
  }
  const p = packet.value;
  const created = await runtime.options.admissionInbox.createFeedbackUnit({
    growUnitRef: p.originGrowUnitRef,
    originLayer: toAdmissionLayer(p.attribution.originLayer),
    targetLayer: toAdmissionLayer(p.attribution.candidateTargetLayer),
    summary: p.summary,
    ...(carrierRef(p) === undefined ? {} : { detailRef: carrierRef(p) }),
    evidenceRefs: p.evidenceRefs,
    runtimeTraceRefs: [],
    attribution: attributionString(p.attribution),
    impact: p.impact,
    suggestedAction: p.suggestedAction,
    privacyClass: p.privacyClass,
    source: p.source,
    audit: p.audit
  });
  if (!created.ok) return created;
  return finalizeSubmission(runtime, p, created.value);
}

export async function requestUpstreamProposalRecord(
  runtime: DebugBridgeRuntime,
  input: RequestUpstreamProposalInput
): Promise<Result<UpstreamProposalRequestRef>> {
  const packet = await runtime.storage.readPacket(input.bridgePacketRef);
  if (!packet.ok) return packet;
  const p = packet.value;
  if (p.feedbackUnitRef === undefined) {
    return bridgeErr({ code: "invalid_state", message: "submit a local feedback candidate before requesting upstream proposal" });
  }
  if (!p.attribution.upstreamEligible) {
    return bridgeErr({ code: "invalid_state", message: "attribution is insufficient to attribute the gap to the upstream feng project" });
  }
  const redactedSummaryRef = p.privacy.redactedSummaryRef;
  if (redactedSummaryRef === undefined) {
    return bridgeErr({ code: "redaction_required", message: "upstream proposal requires a redacted summary, never raw content" });
  }
  const requestRef = newProposalRequestRef();
  const proposal = await runtime.options.admissionInbox.createUpstreamProposal({
    feedbackUnitRefs: [p.feedbackUnitRef],
    targetGrowUnitRef: input.toGrowUnitRef,
    summary: p.summary,
    redactedSummaryRef,
    evidenceRefs: p.evidenceRefs,
    attribution: attributionString(p.attribution),
    privacyBoundary: p.privacyClass,
    reason: input.reason,
    source: input.source,
    audit: input.audit,
    ...(input.policyContext === undefined ? {} : { policyContext: input.policyContext })
  });
  if (!proposal.ok) return proposal;
  const record: UpstreamProposalRequest = {
    upstreamProposalRequestId: requestRef.id,
    upstreamProposalRequestRef: requestRef,
    debugCorrelationRef: p.debugCorrelationRef,
    feedbackUnitRefs: [p.feedbackUnitRef],
    fromGrowUnitRef: p.originGrowUnitRef,
    toGrowUnitRef: input.toGrowUnitRef,
    summary: p.summary,
    redactedSummaryRef,
    evidenceRefs: p.evidenceRefs,
    ...(p.policyDecisionId === undefined ? {} : { policyDecisionId: p.policyDecisionId }),
    attribution: attributionString(p.attribution),
    reason: input.reason,
    upstreamProposalRef: proposal.value,
    source: input.source,
    audit: input.audit
  };
  const write = await runtime.storage.writeProposalRequest(record, "write upstream proposal request");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addProposalRequest(requestRef);
  if (!indexed.ok) return indexed;
  const updated = await persistProposed(runtime, p, proposal.value);
  if (!updated.ok) return updated;
  const event = await appendBridgeEvent({
    runtime,
    correlationRef: p.debugCorrelationRef,
    eventType: debugBridgeEventTypes.upstreamProposalRequested,
    body: { upstreamProposalRequestRef: requestRef, upstreamProposalRef: proposal.value, toGrowUnitRef: input.toGrowUnitRef },
    source: input.source,
    audit: input.audit
  });
  return event.ok ? ok(requestRef) : event;
}

export async function recordUpstreamBridgeResultRecord(
  runtime: DebugBridgeRuntime,
  ref: UpstreamProposalRequestRef,
  input: RecordUpstreamBridgeResultInput
): Promise<Result<BridgeReceipt>> {
  const request = await runtime.storage.readProposalRequest(ref);
  if (!request.ok) return request;
  const recorded = await runtime.options.admissionInbox.recordUpstreamResult(request.value.upstreamProposalRef, {
    result: input.result,
    reason: input.reason,
    source: input.source,
    audit: input.audit
  });
  if (!recorded.ok) return recorded;
  const event = await appendBridgeEvent({
    runtime,
    correlationRef: request.value.debugCorrelationRef,
    eventType: debugBridgeEventTypes.upstreamBridgeResultRecorded,
    body: { upstreamProposalRequestRef: ref, result: input.result },
    source: input.source,
    audit: input.audit
  });
  if (!event.ok) return event;
  return ok({
    debugCorrelationRef: request.value.debugCorrelationRef,
    status: input.result === "accepted_upstream" ? "proposed_upstream" : "local_only",
    eventReceipt: event.value
  });
}

async function finalizeSubmission(
  runtime: DebugBridgeRuntime,
  packet: FeedbackBridgePacket,
  feedbackUnitRef: FeedbackUnitRef
): Promise<Result<FeedbackBridgePacket>> {
  const next: FeedbackBridgePacket = { ...packet, feedbackUnitRef, status: "submitted_local" };
  const write = await runtime.storage.writePacket(next, "record feedback candidate submission");
  if (!write.ok) return write;
  const event = await appendBridgeEvent({
    runtime,
    correlationRef: packet.debugCorrelationRef,
    eventType: debugBridgeEventTypes.feedbackCandidateSubmitted,
    body: { bridgePacketRef: packet.bridgePacketRef, feedbackUnitRef },
    source: packet.source,
    audit: packet.audit
  });
  return event.ok ? ok(next) : event;
}

async function persistProposed(
  runtime: DebugBridgeRuntime,
  packet: FeedbackBridgePacket,
  upstreamProposalRef: UpstreamProposalRef
): Promise<Result<void>> {
  const next: FeedbackBridgePacket = { ...packet, upstreamProposalRef, status: "proposed_upstream" };
  const write = await runtime.storage.writePacket(next, "record upstream proposal on packet");
  return write.ok ? ok(undefined) : write;
}

function carrierRef(packet: FeedbackBridgePacket) {
  if (packet.privacyClass === "redacted") return packet.redactedSummaryRef ?? packet.detailRef;
  return packet.detailRef;
}

function attributionString(attribution: FeedbackAttribution): string {
  return `${attribution.originLayer} -> ${attribution.candidateTargetLayer} (${attribution.confidence}); ${attribution.reason}`;
}

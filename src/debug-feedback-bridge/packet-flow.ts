import { ok, type Result } from "../domain/result.js";
import type { ArtifactRef, PolicyDecisionId, SkillRef } from "../domain/index.js";
import { debugBridgeEventTypes } from "./events.js";
import { bridgeErr } from "./errors.js";
import { bounded, deriveAttribution, newAttributionRef, newPacketRef, paginate } from "./logic.js";
import {
  appendBridgeEvent,
  evaluateBridgePolicyDecision,
  policyAllows,
  registerBridgeArtifact,
  type DebugBridgeRuntime
} from "./runtime.js";
import { bridgePrivacyGuard, computePrivacyFilter } from "./privacy-flow.js";
import type {
  BridgePacketQuery,
  BuildBridgePacketInput,
  FeedbackBridgeExplanation,
  FeedbackBridgePacketPage
} from "./ports.js";
import type {
  BridgeLayer,
  DebugCorrelation,
  DebugCorrelationRef,
  FeedbackAttribution,
  FeedbackBridgePacket,
  FeedbackBridgePacketRef,
  PrivacyFilterResult,
  RuntimeReportEnvelope,
  RuntimeReportEnvelopeRef,
  SuggestedAction
} from "./types.js";

export async function buildFeedbackBridgePacketRecord(
  runtime: DebugBridgeRuntime,
  ref: DebugCorrelationRef,
  input: BuildBridgePacketInput
): Promise<Result<FeedbackBridgePacketRef>> {
  const correlation = await runtime.storage.readCorrelation(ref);
  if (!correlation.ok) return correlation;
  if (correlation.value.status === "closed" || correlation.value.status === "archived") {
    return bridgeErr({ code: "invalid_state", message: "debug correlation is closed" });
  }
  if (input.envelopeRefs.length === 0) {
    return bridgeErr({ code: "invalid_input", message: "feedback bridge packet requires at least one envelope" });
  }
  const envelopes = await readEnvelopes(runtime, correlation.value, input.envelopeRefs);
  if (!envelopes.ok) return envelopes;
  const contract = await runtime.options.runtimeContractRegistry.getRuntimeContract(correlation.value.runtimeContractRef);
  if (!contract.ok) return contract;
  if (contract.value.shape.feedback === undefined) {
    return bridgeErr({ code: "contract_incompatible", message: "runtime contract declares no feedback contract" });
  }
  const evidenceRefs = collectEvidence(envelopes.value, input.evidenceRefs ?? []);
  const privacyClasses = envelopes.value.map((item) => item.privacyClass);
  const router = await readDefaultRouter(runtime);
  if (!router.ok) return router;
  const attribution = await persistAttribution(runtime, correlation.value, input, envelopes.value, evidenceRefs, router.value);
  if (!attribution.ok) return attribution;
  const privacy = await computePrivacyFilter(runtime, correlation.value, {
    inputArtifactRefs: evidenceRefs,
    privacyClasses,
    intent: input.intent,
    summary: input.summary,
    source: input.source,
    audit: input.audit
  });
  if (!privacy.ok) return privacy;
  const persistedPrivacy = await persistPrivacy(runtime, correlation.value.debugCorrelationRef, privacy.value, input);
  if (!persistedPrivacy.ok) return persistedPrivacy;
  const routerTrace = await registerBridgeArtifact({
    runtime,
    kind: "summary",
    content: {
      router: router.value?.id ?? "none",
      attribution: attribution.value,
      privacyDecision: privacy.value.decision,
      intent: input.intent
    },
    privacyClass: "workspace_private",
    source: input.source,
    audit: input.audit
  });
  if (!routerTrace.ok) return routerTrace;
  const detail = await registerBridgeArtifact({
    runtime,
    kind: "feedback_evidence",
    content: { summary: input.summary, envelopeSummaries: envelopes.value.map((item) => item.summary) },
    privacyClass: correlation.value.privacyBoundary,
    source: input.source,
    audit: input.audit
  });
  if (!detail.ok) return detail;
  const upstream = await resolveUpstream(runtime, attribution.value, privacy.value, input);
  if (!upstream.ok) return upstream;
  const packetRef = newPacketRef();
  const record: FeedbackBridgePacket = {
    bridgePacketId: packetRef.id,
    bridgePacketRef: packetRef,
    debugCorrelationRef: correlation.value.debugCorrelationRef,
    originGrowUnitRef: correlation.value.originGrowUnitRef,
    ...(correlation.value.targetGrowUnitRef === undefined ? {} : { targetGrowUnitRef: correlation.value.targetGrowUnitRef }),
    summary: bounded(input.summary, 2_000),
    detailRef: detail.value,
    ...(privacy.value.redactedSummaryRef === undefined ? {} : { redactedSummaryRef: privacy.value.redactedSummaryRef }),
    evidenceRefs,
    runtimeTraceRefs: correlation.value.runtimeTraceRefs,
    debugSignalRefs: correlation.value.debugSignalRefs,
    attribution: attribution.value,
    privacy: privacy.value,
    impact: input.impact,
    suggestedAction: upstream.value.suggestedAction,
    privacyClass: privacy.value.resultPrivacyClass,
    ...(upstream.value.policyDecisionId === undefined ? {} : { policyDecisionId: upstream.value.policyDecisionId }),
    routerTraceRef: routerTrace.value,
    contractRefs: [correlation.value.runtimeContractRef],
    ...(upstream.value.localOnlyReason === undefined ? {} : { localOnlyReason: upstream.value.localOnlyReason }),
    status: "packet_built",
    createdAt: new Date().toISOString(),
    source: input.source,
    audit: input.audit,
    recordVersion: 1
  };
  const write = await runtime.storage.writePacket(record, "write feedback bridge packet");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addPacket(packetRef);
  if (!indexed.ok) return indexed;
  const advanced = await advanceCorrelation(runtime, correlation.value);
  if (!advanced.ok) return advanced;
  const event = await appendBridgeEvent({
    runtime,
    correlationRef: correlation.value.debugCorrelationRef,
    eventType: debugBridgeEventTypes.feedbackBridgePacketBuilt,
    body: { bridgePacketRef: packetRef, suggestedAction: record.suggestedAction, privacyClass: record.privacyClass },
    source: input.source,
    audit: input.audit
  });
  return event.ok ? ok(packetRef) : event;
}

export async function explainFeedbackBridgePacketRecord(
  runtime: DebugBridgeRuntime,
  ref: FeedbackBridgePacketRef
): Promise<Result<FeedbackBridgeExplanation>> {
  const packet = await runtime.storage.readPacket(ref);
  if (!packet.ok) return packet;
  const p = packet.value;
  const facts = [
    `origin grow unit ${p.originGrowUnitRef.id}`,
    `attribution ${p.attribution.originLayer} -> ${p.attribution.candidateTargetLayer} (${p.attribution.confidence})`,
    `privacy decision ${p.privacy.decision} resulting in ${p.privacyClass}`,
    `suggested action ${p.suggestedAction}`,
    `${p.evidenceRefs.length} evidence refs and ${p.runtimeTraceRefs.length} runtime trace refs`,
    p.policyDecisionId === undefined ? "no policy decision recorded" : `policy decision ${p.policyDecisionId}`
  ];
  const excluded = [
    p.redactedSummaryRef === undefined ? "no redaction applied" : "raw content excluded; redacted summary is the cross-layer carrier",
    p.upstreamProposalRef === undefined ? "not proposed upstream" : `proposed upstream as ${p.upstreamProposalRef.id}`,
    p.localOnlyReason ?? "no local-only restriction"
  ];
  return ok({ bridgePacketRef: ref, summary: p.summary, facts, excluded });
}

export async function listBridgePacketsRecord(
  runtime: DebugBridgeRuntime,
  ref: DebugCorrelationRef,
  query?: BridgePacketQuery
): Promise<Result<FeedbackBridgePacketPage>> {
  const records = await runtime.storage.readPacketsForCorrelation(ref);
  if (!records.ok) return records;
  const filtered = query?.status === undefined
    ? records.value
    : records.value.filter((item) => item.status === query.status);
  return ok(paginate(filtered, query?.limit, query?.cursor));
}

async function readEnvelopes(
  runtime: DebugBridgeRuntime,
  correlation: DebugCorrelation,
  refs: readonly RuntimeReportEnvelopeRef[]
): Promise<Result<readonly RuntimeReportEnvelope[]>> {
  const records: RuntimeReportEnvelope[] = [];
  for (const envelopeRef of refs) {
    const record = await runtime.storage.readEnvelope(envelopeRef);
    if (!record.ok) return record;
    if (record.value.debugCorrelationRef.id !== correlation.debugCorrelationRef.id) {
      return bridgeErr({ code: "invalid_input", message: "envelope does not belong to this debug correlation" });
    }
    records.push(record.value);
  }
  return ok(records);
}

function collectEvidence(envelopes: readonly RuntimeReportEnvelope[], extra: readonly ArtifactRef[]): readonly ArtifactRef[] {
  const seen = new Set<string>();
  const result: ArtifactRef[] = [];
  for (const ref of [...envelopes.flatMap((item) => item.evidenceRefs), ...extra]) {
    if (!seen.has(ref.id)) {
      seen.add(ref.id);
      result.push(ref);
    }
  }
  return result;
}

async function readDefaultRouter(runtime: DebugBridgeRuntime): Promise<Result<SkillRef | undefined>> {
  const skills = await runtime.options.skillRegistry.listSkills({
    family: "default_feedback_router",
    includeRetracted: false,
    limit: 1
  });
  if (!skills.ok) return skills;
  return ok(skills.value.records[0]?.skillRef);
}

async function persistAttribution(
  runtime: DebugBridgeRuntime,
  correlation: DebugCorrelation,
  input: BuildBridgePacketInput,
  envelopes: readonly RuntimeReportEnvelope[],
  evidenceRefs: readonly ArtifactRef[],
  router: SkillRef | undefined
): Promise<Result<FeedbackAttribution>> {
  const originLayer: BridgeLayer = input.originLayer ?? envelopes[0]?.sourceLayer ?? "current_project";
  const derived = deriveAttribution({
    originLayer,
    candidateTargetLayer: input.candidateTargetLayer,
    ...(input.confidenceHint === undefined ? {} : { confidenceHint: input.confidenceHint }),
    supportingReportCount: envelopes.length,
    evidenceCount: evidenceRefs.length
  });
  const attributionRef = newAttributionRef();
  const record: FeedbackAttribution = {
    attributionId: attributionRef.id,
    attributionRef,
    debugCorrelationRef: correlation.debugCorrelationRef,
    originLayer: derived.originLayer,
    candidateTargetLayer: derived.candidateTargetLayer,
    confidence: derived.confidence,
    reason: derived.reason,
    evidenceRefs,
    counterEvidenceRefs: input.counterEvidenceRefs ?? [],
    sourceRefs: envelopes.map((item) => item.runtimeReportRef),
    ...(router === undefined ? {} : { routerVersionRef: router }),
    upstreamEligible: derived.upstreamEligible,
    source: input.source,
    audit: input.audit
  };
  const write = await runtime.storage.writeAttribution(record, "write feedback attribution");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addAttribution(attributionRef);
  if (!indexed.ok) return indexed;
  const event = await appendBridgeEvent({
    runtime,
    correlationRef: correlation.debugCorrelationRef,
    eventType: debugBridgeEventTypes.feedbackAttributionRecorded,
    body: { attributionRef, candidateTargetLayer: record.candidateTargetLayer, confidence: record.confidence },
    source: input.source,
    audit: input.audit
  });
  return event.ok ? ok(record) : event;
}

async function persistPrivacy(
  runtime: DebugBridgeRuntime,
  correlationRef: DebugCorrelationRef,
  record: PrivacyFilterResult,
  input: BuildBridgePacketInput
): Promise<Result<void>> {
  const write = await runtime.storage.writePrivacy(record, "write privacy filter result");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addPrivacy(record.privacyFilterRef);
  if (!indexed.ok) return indexed;
  const event = await appendBridgeEvent({
    runtime,
    correlationRef,
    eventType: debugBridgeEventTypes.privacyFilterApplied,
    body: { privacyFilterRef: record.privacyFilterRef, decision: record.decision },
    source: input.source,
    audit: input.audit
  });
  return event.ok ? ok(undefined) : event;
}

interface UpstreamResolution {
  readonly suggestedAction: SuggestedAction;
  readonly policyDecisionId?: PolicyDecisionId;
  readonly localOnlyReason?: string;
}

async function resolveUpstream(
  runtime: DebugBridgeRuntime,
  attribution: FeedbackAttribution,
  privacy: PrivacyFilterResult,
  input: BuildBridgePacketInput
): Promise<Result<UpstreamResolution>> {
  if (input.intent === "local") {
    const action: SuggestedAction = attribution.candidateTargetLayer === "target_agent_project"
      ? "propose_to_target_agent"
      : "create_local_feedback_candidate";
    return ok({ suggestedAction: action });
  }
  if (attribution.confidence === "unknown") {
    return ok({ suggestedAction: "request_more_evidence", localOnlyReason: "attribution is unknown; cannot propose upstream" });
  }
  if (!attribution.upstreamEligible) {
    return ok({ suggestedAction: "request_more_evidence", localOnlyReason: attribution.reason });
  }
  const guard = bridgePrivacyGuard(privacy, "upstream");
  if (!guard.ok) return ok({ suggestedAction: "request_human_review", localOnlyReason: guard.error.message });
  if (input.policyContext === undefined) {
    return ok({ suggestedAction: "request_human_review", localOnlyReason: "upstream proposal requires a policy decision" });
  }
  const decision = await evaluateBridgePolicyDecision({
    runtime,
    capability: "feedback.upstream",
    resourceSummary: "feedback bridge upstream candidate",
    operation: "evaluate feedback upstream propagation",
    reason: input.summary,
    source: input.source,
    context: input.policyContext
  });
  if (!decision.ok) return decision;
  if (!policyAllows(decision.value)) {
    return ok({ suggestedAction: "keep_local_observation", localOnlyReason: `policy verdict is ${decision.value.verdict}` });
  }
  return ok({ suggestedAction: "propose_to_upstream_feng", policyDecisionId: decision.value.policyDecisionId });
}

async function advanceCorrelation(runtime: DebugBridgeRuntime, correlation: DebugCorrelation): Promise<Result<void>> {
  const next: DebugCorrelation = { ...correlation, status: "packet_built", updatedAt: new Date().toISOString() };
  const write = await runtime.storage.writeCorrelation(next, "advance correlation to packet built");
  return write.ok ? ok(undefined) : write;
}

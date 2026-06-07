import type { Result } from "../domain/result.js";
import type { ArtifactRef, AuditDescriptor, SourceDescriptor } from "../domain/index.js";
import type {
  RuntimeFeedbackCandidateHintRef,
  RuntimeInvocationRef,
  RuntimeTraceRef
} from "../agent-runtime-kernel/index.js";
import type { TargetDebugSignalRef } from "../target-world-adapter/index.js";
import type { PolicyDecision } from "../policy-boundary/index.js";
import {
  closeDebugCorrelationRecord,
  linkDebugSignalRecord,
  linkRuntimeInvocationRecord,
  linkRuntimeTraceRecord,
  openDebugCorrelationRecord
} from "./correlation-flow.js";
import {
  ingestManualObservationRecord,
  ingestRuntimeFeedbackHintRecord,
  ingestRuntimeTraceRecord,
  ingestTargetDebugSignalRecord
} from "./ingest-flow.js";
import {
  buildFeedbackBridgePacketRecord,
  explainFeedbackBridgePacketRecord,
  listBridgePacketsRecord
} from "./packet-flow.js";
import {
  recordUpstreamBridgeResultRecord,
  requestUpstreamProposalRecord,
  submitFeedbackCandidateRecord
} from "./submit-flow.js";
import {
  buildRedactedBridgeSummaryRecord,
  evaluateBridgePolicyRecord,
  evaluateBridgePrivacyRecord
} from "./privacy-flow.js";
import { createDebugBridgeRuntime, type DebugBridgeRuntime } from "./runtime.js";
import type {
  BridgePacketQuery,
  BridgePolicyActionRequest,
  BridgePrivacyInput,
  BridgeReceipt,
  BuildBridgePacketInput,
  DebugFeedbackBridge,
  DebugFeedbackBridgeOptions,
  FeedbackBridgeExplanation,
  FeedbackBridgePacketPage,
  ManualObservationInput,
  OpenDebugCorrelationInput,
  RecordUpstreamBridgeResultInput,
  RequestUpstreamProposalInput
} from "./ports.js";
import type {
  DebugCorrelation,
  DebugCorrelationRef,
  FeedbackBridgePacket,
  FeedbackBridgePacketRef,
  PrivacyFilterResultRef,
  RuntimeReportEnvelope,
  RuntimeReportEnvelopeRef,
  UpstreamProposalRequestRef
} from "./types.js";

export class NodeDebugFeedbackBridge implements DebugFeedbackBridge {
  private readonly runtime: DebugBridgeRuntime;

  constructor(options: DebugFeedbackBridgeOptions) {
    this.runtime = createDebugBridgeRuntime(options);
  }

  openDebugCorrelation(input: OpenDebugCorrelationInput): Promise<Result<DebugCorrelationRef>> {
    return openDebugCorrelationRecord(this.runtime, input);
  }

  linkRuntimeInvocation(ref: DebugCorrelationRef, invocationRef: RuntimeInvocationRef): Promise<Result<BridgeReceipt>> {
    return linkRuntimeInvocationRecord(this.runtime, ref, invocationRef);
  }

  linkRuntimeTrace(ref: DebugCorrelationRef, traceRef: RuntimeTraceRef): Promise<Result<BridgeReceipt>> {
    return linkRuntimeTraceRecord(this.runtime, ref, traceRef);
  }

  linkDebugSignal(ref: DebugCorrelationRef, signalRef: TargetDebugSignalRef): Promise<Result<BridgeReceipt>> {
    return linkDebugSignalRecord(this.runtime, ref, signalRef);
  }

  closeDebugCorrelation(ref: DebugCorrelationRef, reason: string): Promise<Result<BridgeReceipt>> {
    return closeDebugCorrelationRecord(this.runtime, ref, reason);
  }

  getDebugCorrelation(ref: DebugCorrelationRef): Promise<Result<DebugCorrelation>> {
    return this.runtime.storage.readCorrelation(ref);
  }

  ingestRuntimeTrace(ref: DebugCorrelationRef, traceRef: RuntimeTraceRef): Promise<Result<RuntimeReportEnvelopeRef>> {
    return ingestRuntimeTraceRecord(this.runtime, ref, traceRef);
  }

  ingestTargetDebugSignal(ref: DebugCorrelationRef, signalRef: TargetDebugSignalRef): Promise<Result<RuntimeReportEnvelopeRef>> {
    return ingestTargetDebugSignalRecord(this.runtime, ref, signalRef);
  }

  ingestRuntimeFeedbackHint(
    ref: DebugCorrelationRef,
    hintRef: RuntimeFeedbackCandidateHintRef
  ): Promise<Result<RuntimeReportEnvelopeRef>> {
    return ingestRuntimeFeedbackHintRecord(this.runtime, ref, hintRef);
  }

  ingestManualObservation(ref: DebugCorrelationRef, input: ManualObservationInput): Promise<Result<RuntimeReportEnvelopeRef>> {
    return ingestManualObservationRecord(this.runtime, ref, input);
  }

  getRuntimeReportEnvelope(ref: RuntimeReportEnvelopeRef): Promise<Result<RuntimeReportEnvelope>> {
    return this.runtime.storage.readEnvelope(ref);
  }

  buildFeedbackBridgePacket(
    ref: DebugCorrelationRef,
    input: BuildBridgePacketInput
  ): Promise<Result<FeedbackBridgePacketRef>> {
    return buildFeedbackBridgePacketRecord(this.runtime, ref, input);
  }

  explainFeedbackBridgePacket(ref: FeedbackBridgePacketRef): Promise<Result<FeedbackBridgeExplanation>> {
    return explainFeedbackBridgePacketRecord(this.runtime, ref);
  }

  listBridgePackets(ref: DebugCorrelationRef, query?: BridgePacketQuery): Promise<Result<FeedbackBridgePacketPage>> {
    return listBridgePacketsRecord(this.runtime, ref, query);
  }

  getFeedbackBridgePacket(ref: FeedbackBridgePacketRef): Promise<Result<FeedbackBridgePacket>> {
    return this.runtime.storage.readPacket(ref);
  }

  submitFeedbackCandidate(ref: FeedbackBridgePacketRef): Promise<Result<FeedbackBridgePacket>> {
    return submitFeedbackCandidateRecord(this.runtime, ref);
  }

  requestUpstreamProposal(input: RequestUpstreamProposalInput): Promise<Result<UpstreamProposalRequestRef>> {
    return requestUpstreamProposalRecord(this.runtime, input);
  }

  recordUpstreamBridgeResult(
    ref: UpstreamProposalRequestRef,
    input: RecordUpstreamBridgeResultInput
  ): Promise<Result<BridgeReceipt>> {
    return recordUpstreamBridgeResultRecord(this.runtime, ref, input);
  }

  evaluateBridgePrivacy(ref: DebugCorrelationRef, input: BridgePrivacyInput): Promise<Result<PrivacyFilterResultRef>> {
    return evaluateBridgePrivacyRecord(this.runtime, ref, input);
  }

  evaluateBridgePolicy(input: BridgePolicyActionRequest): Promise<Result<PolicyDecision>> {
    return evaluateBridgePolicyRecord(this.runtime, input);
  }

  buildRedactedBridgeSummary(
    ref: DebugCorrelationRef,
    inputRefs: readonly ArtifactRef[],
    summary: string,
    source: SourceDescriptor,
    audit: AuditDescriptor
  ): Promise<Result<ArtifactRef>> {
    return buildRedactedBridgeSummaryRecord(this.runtime, ref, inputRefs, summary, source, audit);
  }
}

export function createDebugFeedbackBridge(options: DebugFeedbackBridgeOptions): DebugFeedbackBridge {
  return new NodeDebugFeedbackBridge(options);
}

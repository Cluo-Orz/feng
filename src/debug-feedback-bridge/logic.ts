import { randomUUID } from "node:crypto";
import type { PrivacyLevel } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import type { FeedbackLayer } from "../admission-feedback-inbox/index.js";
import {
  makeDebugCorrelationId,
  makeFeedbackAttributionId,
  makeFeedbackBridgePacketId,
  makePrivacyFilterResultId,
  makeRuntimeReportEnvelopeId,
  makeUpstreamProposalRequestId
} from "./brand.js";
import { bridgeErr } from "./errors.js";
import {
  debugCorrelationRef,
  feedbackAttributionRef,
  feedbackBridgePacketRef,
  privacyFilterResultRef,
  runtimeReportEnvelopeRef,
  upstreamProposalRequestRef
} from "./refs.js";
import type {
  BridgeLayer,
  ConfidenceLevel,
  FeedbackBridgePacket,
  PrivacyDecision
} from "./types.js";
import type { FeedbackBridgePacketPage } from "./ports.js";

export const newCorrelationRef = () => debugCorrelationRef(makeDebugCorrelationId(`debug-correlation-${randomUUID()}`));
export const newEnvelopeRef = () => runtimeReportEnvelopeRef(makeRuntimeReportEnvelopeId(`runtime-report-${randomUUID()}`));
export const newAttributionRef = () => feedbackAttributionRef(makeFeedbackAttributionId(`feedback-attribution-${randomUUID()}`));
export const newPrivacyRef = () => privacyFilterResultRef(makePrivacyFilterResultId(`privacy-filter-${randomUUID()}`));
export const newPacketRef = () => feedbackBridgePacketRef(makeFeedbackBridgePacketId(`feedback-bridge-packet-${randomUUID()}`));
export const newProposalRequestRef = () =>
  upstreamProposalRequestRef(makeUpstreamProposalRequestId(`upstream-proposal-request-${randomUUID()}`));

const fengPlatformLayers: ReadonlySet<BridgeLayer> = new Set(["runtime_kernel", "feedback_router"]);

export function toAdmissionLayer(layer: BridgeLayer): FeedbackLayer {
  if (layer === "target_agent_project") return "target_agent_project";
  if (layer === "upstream_feng_project") return "upstream_feng_project";
  if (layer === "external_runtime") return "external_runtime";
  if (layer === "unknown") return "unknown";
  if (fengPlatformLayers.has(layer)) return "upstream_feng_project";
  return "current_project";
}

export const sensitivePrivacyClasses: ReadonlySet<PrivacyLevel> = new Set([
  "contains_secret",
  "project_private",
  "contains_user_content"
]);

export function isSensitive(privacy: PrivacyLevel): boolean {
  return sensitivePrivacyClasses.has(privacy);
}

export interface AttributionDerivation {
  readonly originLayer: BridgeLayer;
  readonly candidateTargetLayer: BridgeLayer;
  readonly confidence: ConfidenceLevel;
  readonly reason: string;
  readonly upstreamEligible: boolean;
}

export function deriveAttribution(input: {
  readonly originLayer: BridgeLayer;
  readonly candidateTargetLayer: BridgeLayer;
  readonly confidenceHint?: ConfidenceLevel;
  readonly supportingReportCount: number;
  readonly evidenceCount: number;
}): AttributionDerivation {
  const target = input.candidateTargetLayer;
  if (target === "unknown") {
    return {
      originLayer: input.originLayer,
      candidateTargetLayer: "unknown",
      confidence: "unknown",
      reason: "target layer is unknown; attribution cannot propagate upstream automatically",
      upstreamEligible: false
    };
  }
  const requestedConfidence = input.confidenceHint ?? "medium";
  if (target === "upstream_feng_project" || toAdmissionLayer(target) === "upstream_feng_project") {
    const sufficient = input.supportingReportCount >= 2 && input.evidenceCount >= 1 && requestedConfidence === "high";
    return {
      originLayer: input.originLayer,
      candidateTargetLayer: target,
      confidence: sufficient ? "high" : "low",
      reason: sufficient
        ? "multiple correlated reports with evidence attribute the gap to a feng platform mechanism"
        : "single or weakly evidenced downstream failure cannot be directly attributed to the upstream feng project",
      upstreamEligible: sufficient
    };
  }
  return {
    originLayer: input.originLayer,
    candidateTargetLayer: target,
    confidence: requestedConfidence,
    reason: "attribution stays within the current or target agent project scope",
    upstreamEligible: false
  };
}

export interface PrivacyDerivation {
  readonly decision: PrivacyDecision;
  readonly resultPrivacyClass: PrivacyLevel;
  readonly requiresRedaction: boolean;
  readonly upstreamAllowedAfterRedaction: boolean;
}

export function derivePrivacy(classes: readonly PrivacyLevel[], intent: "local" | "upstream"): PrivacyDerivation {
  const unknownPresent = classes.includes("unknown") || classes.length === 0;
  const sensitive = classes.some((item) => isSensitive(item));
  if (unknownPresent) {
    return { decision: "waiting_policy", resultPrivacyClass: "unknown", requiresRedaction: true, upstreamAllowedAfterRedaction: false };
  }
  if (intent === "local") {
    if (sensitive) {
      return { decision: "redact_then_local", resultPrivacyClass: "redacted", requiresRedaction: true, upstreamAllowedAfterRedaction: false };
    }
    return { decision: "pass_local", resultPrivacyClass: highestClass(classes), requiresRedaction: false, upstreamAllowedAfterRedaction: false };
  }
  return {
    decision: "redact_then_upstream_candidate",
    resultPrivacyClass: "redacted",
    requiresRedaction: true,
    upstreamAllowedAfterRedaction: true
  };
}

function highestClass(classes: readonly PrivacyLevel[]): PrivacyLevel {
  if (classes.includes("contains_model_output")) return "contains_model_output";
  if (classes.includes("workspace_private")) return "workspace_private";
  return classes[0] ?? "workspace_private";
}

export function bounded(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

export function nonEmpty(value: string, message: string): Result<void> {
  return value.trim().length === 0 ? bridgeErr({ code: "invalid_input", message }) : ok(undefined);
}

export function paginate(records: readonly FeedbackBridgePacket[], limit?: number, cursor?: string): FeedbackBridgePacketPage {
  const start = cursor === undefined ? 0 : Number.parseInt(cursor, 10);
  const size = Math.max(1, limit ?? (records.length || 1));
  const page = records.slice(start, start + size);
  return {
    records: page,
    total: records.length,
    ...(start + size >= records.length ? {} : { nextCursor: String(start + size) }),
    truncated: start + size < records.length
  };
}

import { describe, expect, it } from "vitest";
import { bounded, deriveAttribution, derivePrivacy, isSensitive, nonEmpty, paginate, toAdmissionLayer } from "../../src/debug-feedback-bridge/logic.js";
import type { FeedbackBridgePacket } from "../../src/debug-feedback-bridge/index.js";

describe("Debug Feedback Bridge pure logic", () => {
  it("maps bridge layers to admission feedback layers", () => {
    expect(toAdmissionLayer("runtime_kernel")).toBe("upstream_feng_project");
    expect(toAdmissionLayer("feedback_router")).toBe("upstream_feng_project");
    expect(toAdmissionLayer("target_world_adapter")).toBe("current_project");
    expect(toAdmissionLayer("target_agent_project")).toBe("target_agent_project");
    expect(toAdmissionLayer("external_runtime")).toBe("external_runtime");
    expect(toAdmissionLayer("unknown")).toBe("unknown");
  });

  it("never attributes a weak single report upstream but accepts well-evidenced correlated reports", () => {
    const weak = deriveAttribution({
      originLayer: "current_project",
      candidateTargetLayer: "upstream_feng_project",
      confidenceHint: "high",
      supportingReportCount: 1,
      evidenceCount: 0
    });
    expect(weak.upstreamEligible).toBe(false);
    const strong = deriveAttribution({
      originLayer: "current_project",
      candidateTargetLayer: "upstream_feng_project",
      confidenceHint: "high",
      supportingReportCount: 2,
      evidenceCount: 2
    });
    expect(strong.upstreamEligible).toBe(true);
    const unknown = deriveAttribution({
      originLayer: "current_project",
      candidateTargetLayer: "unknown",
      supportingReportCount: 5,
      evidenceCount: 5
    });
    expect(unknown.confidence).toBe("unknown");
    expect(unknown.upstreamEligible).toBe(false);
  });

  it("requires redaction for sensitive or upstream propagation", () => {
    expect(isSensitive("contains_secret")).toBe(true);
    expect(derivePrivacy(["unknown"], "local").decision).toBe("waiting_policy");
    expect(derivePrivacy(["contains_user_content"], "local").decision).toBe("redact_then_local");
    expect(derivePrivacy(["workspace_private"], "local").decision).toBe("pass_local");
    expect(derivePrivacy(["workspace_private"], "upstream").decision).toBe("redact_then_upstream_candidate");
  });

  it("paginates packets with cursors", () => {
    const records = Array.from({ length: 3 }, (_, index) => ({ bridgePacketId: `p${index}` }) as unknown as FeedbackBridgePacket);
    const page = paginate(records, 2);
    expect(page.records).toHaveLength(2);
    expect(page.truncated).toBe(true);
    const next = paginate(records, 2, page.nextCursor);
    expect(next.records).toHaveLength(1);
    expect(next.truncated).toBe(false);
  });

  it("bounds and normalizes text", () => {
    expect(bounded("  a   b  ", 100)).toBe("a b");
    expect(bounded("abcdef", 5)).toBe("ab...");
  });

  it("resolves the highest privacy class for non-sensitive carriers", () => {
    expect(derivePrivacy(["contains_model_output"], "local").resultPrivacyClass).toBe("contains_model_output");
    expect(derivePrivacy(["public"], "local").resultPrivacyClass).toBe("public");
  });

  it("flags empty text via nonEmpty", () => {
    expect(nonEmpty("  ", "blank").ok).toBe(false);
    expect(nonEmpty("value", "blank").ok).toBe(true);
  });
});

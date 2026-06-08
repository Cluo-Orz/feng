import { describe, expect, it } from "vitest";
import { routeFeedback, checkKernelContract } from "../../src/authoring-runtime/index.js";
import { defaultFeedbackRouting, defaultNovelTargetWorld, type AuthoringRuntimePackage } from "../../src/runtime-package/index.js";
import type { QualityIssue } from "../../src/authoring-runtime/index.js";

function pkgWith(targetWorld: AuthoringRuntimePackage["targetWorld"]): AuthoringRuntimePackage {
  return {
    schemaVersion: "1.0.0", packageId: "p", name: "x", kind: "serialized_authoring_agent", version: "1.0.0",
    locked: true, runEntry: "feng run", targetWorld,
    contextPolicy: [], writingStrategy: { systemPrompt: "s", stylePrinciples: [], constraints: [] },
    storyModel: { trackedFacts: [], continuityDimensions: [] }, harness: { steps: [] },
    qualityRules: [], feedbackRouting: defaultFeedbackRouting,
    validation: { readiness: "ready", grownInProject: "/x", evidenceSummary: "", checkedAt: "t" },
    provenance: { model: "m", provider: "p", hatchedAt: "t" }
  };
}

describe("checkKernelContract", () => {
  it("flags dialogueAllowed as a system-layer runtime_capability gap", () => {
    const issues = checkKernelContract(pkgWith({ ...defaultNovelTargetWorld, dialogueAllowed: true }));
    expect(issues.some((i) => i.kind === "runtime_capability")).toBe(true);
  });

  it("flags an unsupported output kind", () => {
    const issues = checkKernelContract(pkgWith({ ...defaultNovelTargetWorld, outputKinds: ["chapter_text", "audio_narration"] }));
    expect(issues.some((i) => i.detail.includes("audio_narration"))).toBe(true);
  });

  it("passes a default novel target world", () => {
    expect(checkKernelContract(pkgWith(defaultNovelTargetWorld))).toHaveLength(0);
  });

  it("routes a runtime_capability issue to the system layer", () => {
    const issues: readonly QualityIssue[] = [{ kind: "runtime_capability", severity: "warning", detail: "kernel gap" }];
    const routed = routeFeedback(defaultFeedbackRouting, 1, issues);
    expect(routed.byLayer.system).toBe(1);
    expect(routed.candidates[0]?.layer).toBe("system");
  });
});

describe("feedback routing", () => {
  it("routes each issue kind to its lifecycle layer", () => {
    const issues: readonly QualityIssue[] = [
      { kind: "length", severity: "error", detail: "字数" },
      { kind: "year_consistency", severity: "error", detail: "年份" },
      { kind: "geography_consistency", severity: "warning", detail: "地理" },
      { kind: "character_continuation", severity: "warning", detail: "人物" },
      { kind: "outline_continuity", severity: "error", detail: "大纲" },
      { kind: "chapter_continuity", severity: "error", detail: "章序" },
      { kind: "artifact_presence", severity: "error", detail: "trace" }
    ];
    const routed = routeFeedback(defaultFeedbackRouting, 3, issues);
    expect(routed.byLayer.work).toBe(3);
    expect(routed.byLayer.capability).toBe(3);
    expect(routed.byLayer.system).toBe(1);
    expect(routed.candidates).toHaveLength(7);
    expect(routed.candidates.every((c) => c.chapterNumber === 3)).toBe(true);
  });

  it("falls back to work layer for unknown issue kinds", () => {
    const issues: readonly QualityIssue[] = [{ kind: "mystery" as never, severity: "error", detail: "x" }];
    const routed = routeFeedback(defaultFeedbackRouting, 1, issues);
    expect(routed.candidates[0]?.layer).toBe("work");
  });
});

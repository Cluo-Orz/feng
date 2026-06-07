import { routingLayerFor, type FeedbackLayer, type FeedbackRoutingRule } from "../runtime-package/index.js";
import type { QualityIssue } from "./quality.js";

export interface FeedbackCandidate {
  readonly issueKind: string;
  readonly layer: FeedbackLayer;
  readonly severity: "warning" | "error";
  readonly detail: string;
  readonly routingReason: string;
  readonly chapterNumber: number;
}

export interface RoutedFeedback {
  readonly candidates: readonly FeedbackCandidate[];
  readonly byLayer: Record<FeedbackLayer, number>;
}

// Concept (novel-case-flow.md 226-251): every issue must be attributed to a
// layer before it can enter the right grow level. Work facts stay local,
// capability gaps flow to the agent project, system gaps flow to feng.
export function routeFeedback(
  rules: readonly FeedbackRoutingRule[],
  chapterNumber: number,
  issues: readonly QualityIssue[]
): RoutedFeedback {
  const byLayer: Record<FeedbackLayer, number> = { work: 0, capability: 0, system: 0 };
  const candidates = issues.map((issue): FeedbackCandidate => {
    const route = routingLayerFor(rules, issue.kind);
    byLayer[route.layer] += 1;
    return {
      issueKind: issue.kind,
      layer: route.layer,
      severity: issue.severity,
      detail: issue.detail,
      routingReason: route.reason,
      chapterNumber
    };
  });
  return { candidates, byLayer };
}

import { routingLayerFor, type FeedbackLayer, type FeedbackRoutingRule } from "../runtime-package/index.js";
import type { AuthoringRuntimePackage } from "../runtime-package/index.js";
import type { QualityIssue } from "./quality.js";

// What this authoring runtime kernel can actually express. A package that
// declares a capability outside this set is a feng system-layer gap ("默认
// runtime kernel 不能表达某类创作 agent"), not a work or writing-skill problem.
export const KERNEL_SUPPORTED_OUTPUTS = ["chapter_text", "updated_outline", "setting_conflicts", "feedback_candidates"] as const;
export const KERNEL_SUPPORTS_DIALOGUE = false;

export function checkKernelContract(pkg: AuthoringRuntimePackage): readonly QualityIssue[] {
  const issues: QualityIssue[] = [];
  if (pkg.targetWorld.dialogueAllowed && !KERNEL_SUPPORTS_DIALOGUE) {
    issues.push({ kind: "runtime_capability", severity: "warning", detail: "运行包声明 dialogueAllowed=true，但当前 authoring runtime kernel 不支持对话式输入；需要 feng grow 出可表达对话型创作 agent 的 kernel" });
  }
  const supported = new Set<string>(KERNEL_SUPPORTED_OUTPUTS);
  for (const kind of pkg.targetWorld.outputKinds) {
    if (!supported.has(kind)) {
      issues.push({ kind: "runtime_capability", severity: "warning", detail: `运行包要求输出 outputKind「${kind}」，但当前 runtime kernel 无法产出；属于 feng 运行 kernel 能力缺口` });
    }
  }
  return issues;
}

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

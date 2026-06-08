import type { QualityCheckKind } from "../runtime-package/index.js";
import type { WritingStrategy } from "../runtime-package/index.js";

// Deterministic capability-feedback -> revised strategy mapping. When a sample
// run surfaces a capability-layer quality gap, the agent's writing strategy is
// revised by appending an explicit constraint that targets that gap. This is
// the "xiaoshuo reads capability feedback and produces a revised package" step,
// expressed as a pure, testable transformation.
const CONSTRAINT_FOR: Partial<Record<QualityCheckKind, string>> = {
  character_continuation: "每章开头第一段必须让上一章结尾登场或提及的人物出现或被提及，保持人物承接，不得凭空切换到全新人物。",
  outline_continuity: "必须基于已累积的章节大纲推进剧情，更新大纲，不得遗漏或重复前情。",
  chapter_continuity: "严格按章节顺序推进，本章必须紧接上一章的结尾情境。",
  length: "严格把每章正文字数控制在声明的字数区间内；若超出上限，必须精简删减后再输出。",
  year_consistency: "全文公元年份必须与作品设定保持一致，不得在章节之间跳变。",
  geography_consistency: "地点与地理设定必须与世界设定一致，不得自相矛盾。",
  semantic_style: "提升文风与可读性：避免比喻堆叠与生硬说明，控制叙事节奏，保持语言质感统一。",
  semantic_character: "强化人物可信度与一致性：人物反应要符合其身份、性格与处境，避免轻率或失真的对白与举动。",
  semantic_plot: "强化情节吸引力与推进：每章设置有效冲突、阻碍与悬念钩子，避免平铺直叙的过场。"
};

export function constraintFor(kind: QualityCheckKind): string | undefined {
  return CONSTRAINT_FOR[kind];
}

export function reviseStrategyForIssues(
  strategy: WritingStrategy,
  issueKinds: readonly QualityCheckKind[]
): { readonly strategy: WritingStrategy; readonly added: readonly string[] } {
  const existing = new Set(strategy.constraints);
  const added: string[] = [];
  for (const kind of issueKinds) {
    const constraint = CONSTRAINT_FOR[kind];
    if (constraint === undefined || existing.has(constraint)) continue;
    existing.add(constraint);
    added.push(constraint);
  }
  if (added.length === 0) return { strategy, added };
  return {
    strategy: { ...strategy, constraints: [...strategy.constraints, ...added] },
    added
  };
}

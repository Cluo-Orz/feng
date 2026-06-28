import type { QualityCheckKind } from "../runtime-package/index.js";
import type { WritingStrategy } from "../runtime-package/index.js";

// Deterministic capability-feedback -> revised strategy mapping. When a sample
// run surfaces a capability-layer quality gap, the agent's writing strategy is
// revised by appending an explicit constraint that targets that gap. This is
// the "xiaoshuo reads capability feedback and produces a revised package" step,
// expressed as a pure, testable transformation.
export const SAMPLE_GOAL_COVERAGE_CONSTRAINT =
  "每章正文必须正面回应【本章目标】：把目标转化为可见事件、行动或冲突写进正文；不能只在提示词、摘要或大纲中提到目标。";

const CONSTRAINT_FOR: Partial<Record<QualityCheckKind, string>> = {
  character_continuation: "每章开头第一段必须让上一章结尾登场或提及的人物出现或被提及，保持人物承接，不得凭空切换到全新人物。",
  outline_continuity: "必须基于已累积的章节大纲推进剧情，更新大纲，不得遗漏或重复前情。",
  chapter_continuity: "严格按章节顺序推进，本章必须紧接上一章的结尾情境。",
  length: "严格把每章正文字数控制在声明的字数区间内；若超出上限，必须精简删减后再输出。",
  year_consistency: "全文公元年份必须与作品设定保持一致，不得在章节之间跳变。",
  geography_consistency: "地点与地理设定必须与世界设定一致，不得自相矛盾。",
  goal_coverage: SAMPLE_GOAL_COVERAGE_CONSTRAINT,
  semantic_style: "提升文风与可读性：避免比喻堆叠与生硬说明，控制叙事节奏，保持语言质感统一。",
  semantic_character: "强化人物可信度与一致性：人物反应要符合其身份、性格与处境，避免轻率或失真的对白与举动。",
  semantic_plot: "强化情节吸引力与推进：每章设置有效冲突、阻碍与悬念钩子，避免平铺直叙的过场。"
};

export interface FeedbackDetailForRevision {
  readonly issueKind: string;
  readonly detail?: string;
}

const DETAIL_CONSTRAINTS: readonly {
  readonly issueKind?: QualityCheckKind;
  readonly pattern: RegExp;
  readonly constraint: string;
}[] = [
  {
    issueKind: "semantic_style",
    pattern: /比喻|意象|修辞|重笔触|画面感|阅读消耗/,
    constraint: "语义修稿约束：每个场景只保留少量高价值比喻，避免连续堆叠抽象意象；优先用动作、物件和可见细节承载氛围。"
  },
  {
    issueKind: "semantic_style",
    pattern: /常见|陈腐|词根|重复|动词单调|模板化|套话/,
    constraint: "语义修稿约束：避免常见套话、陈腐比喻和同词根重复；优先选择贴合角色身份、场景物件和目标世界质感的具体表达。"
  },
  {
    issueKind: "semantic_style",
    pattern: /解释|补充说明|直接.*解读|替读者|心理解析|削弱/,
    constraint: "语义修稿约束：少用解释性总结和替读者下结论的句子；把判断改写成动作、对白、物证或场景变化。"
  },
  {
    issueKind: "semantic_character",
    pattern: /动机|主动|被动|牵连|必然性|不确定.*为什么/,
    constraint: "语义修稿约束：角色做关键行动前必须有可见动机、个人牵连或明确选择，不能只被梦境、巧合或外力推着走。"
  },
  {
    issueKind: "semantic_character",
    pattern: /镇定|惊悸|惊吓|生理反应|手抖|冷汗|心理曲线|血肉/,
    constraint: "语义修稿约束：普通角色面对异常事件时先写本能反应，再写克制和判断，让恐惧、犹豫、推理形成可信心理曲线。"
  },
  {
    issueKind: "semantic_plot",
    pattern: /直接|刻意|巧合|精准|缺乏.*解释|答案.*出现|线索.*出现/,
    constraint: "语义修稿约束：关键线索必须经过观察、误判、搜索、验证或代价逐步浮现，避免答案式、巧合式或过度精准的推进。"
  },
  {
    issueKind: "semantic_plot",
    pattern: /因果|依据|触发|铺垫|合理|严密|信服/,
    constraint: "语义修稿约束：异常事件必须有前置触发条件和可追踪因果；主角每次推断都要对应具体物证、时间、地点或行为。"
  },
  {
    issueKind: "semantic_plot",
    pattern: /一次性|无后续|吓人|硬插|脚步声|痕迹|监视/,
    constraint: "语义修稿约束：悬疑事件不能只制造惊吓；它必须留下痕迹、后果、反应或后续验证入口，成为可追踪的情节链。"
  },
  {
    issueKind: "semantic_plot",
    pattern: /仓促|立刻.*联系|回忆.*仓促|熟悉|确认|查找|推理/,
    constraint: "语义修稿约束：重要联想和推理要分层推进，先出现模糊熟悉或异常感，再通过查找、对照、验证确认结论。"
  },
  {
    issueKind: "semantic_character",
    pattern: /触发点|时间选择|三年未|突然决定|为什么.*今天/,
    constraint: "语义修稿约束：角色突然进入危险地点或做高风险行动时，必须给出当下触发点，例如纪念日、外部压力、证据新变化或无法回避的期限。"
  }
];

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

export function reviseStrategyForSampleGoalCoverage(
  strategy: WritingStrategy,
  issueCount: number
): { readonly strategy: WritingStrategy; readonly added: readonly string[] } {
  if (issueCount <= 0 || strategy.constraints.includes(SAMPLE_GOAL_COVERAGE_CONSTRAINT)) {
    return { strategy, added: [] };
  }
  return {
    strategy: { ...strategy, constraints: [...strategy.constraints, SAMPLE_GOAL_COVERAGE_CONSTRAINT] },
    added: [SAMPLE_GOAL_COVERAGE_CONSTRAINT]
  };
}

export function reviseStrategyForFeedbackDetails(
  strategy: WritingStrategy,
  feedback: readonly FeedbackDetailForRevision[]
): { readonly strategy: WritingStrategy; readonly added: readonly string[] } {
  const existing = new Set(strategy.constraints);
  const added: string[] = [];
  for (const item of feedback) {
    const kind = item.issueKind as QualityCheckKind;
    const detail = item.detail ?? "";
    for (const rule of DETAIL_CONSTRAINTS) {
      if (rule.issueKind !== undefined && rule.issueKind !== kind) continue;
      if (!rule.pattern.test(detail)) continue;
      if (existing.has(rule.constraint)) continue;
      existing.add(rule.constraint);
      added.push(rule.constraint);
    }
  }
  if (added.length === 0) return { strategy, added: [] };
  return {
    strategy: { ...strategy, constraints: [...strategy.constraints, ...added] },
    added
  };
}

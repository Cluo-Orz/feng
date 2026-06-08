import type {
  ContextSectionPolicy,
  FeedbackRoutingRule,
  QualityRule,
  StoryModel,
  AgentHarness,
  TargetWorldContract
} from "./types.js";

// feng's default downstream協議 for a serialized authoring agent. The writing
// strategy is grown per project; these defaults (context policy, quality rules,
// feedback routing) are the kernel capabilities feng delivers downstream and a
// grown package may override.

export const defaultNovelTargetWorld: TargetWorldContract = {
  description: "连载式中文小说创作：在一个作品项目中逐章写作，保持设定、人物与情节连贯。",
  inputKinds: ["premise", "chapter_goal", "prior_outline", "character_bible", "author_feedback"],
  outputKinds: ["chapter_text", "updated_outline", "setting_conflicts", "feedback_candidates"],
  actionBoundary: ["可写章节文件与大纲", "可读作品资料", "可提出问题", "未经确认不得发布或删除作品"],
  failureHandling: ["产出过短或缺失则记录问题并重试", "设定冲突写入 feedback candidate", "模型失败向上返回错误"],
  dialogueAllowed: false
};

export const defaultStoryModel: StoryModel = {
  trackedFacts: [
    "premise(作品设定)",
    "world_bible(世界观/规则)",
    "character_bible(人物设定与性格)",
    "character_state(人物当前目标/关系/处境/弧线)",
    "timeline(时间线与年份)",
    "locations(地点设定)",
    "unresolved_hooks(未回收伏笔/悬念)",
    "chapter_outlines(逐章大纲累积)"
  ],
  continuityDimensions: ["人物承接", "性格延续", "年份一致", "地点一致", "大纲连续", "悬念推进", "文风一致"]
};

export const defaultHarness: AgentHarness = {
  steps: ["run_chapter", "revise_chapter", "evaluate_chapter", "continuity_check", "route_feedback", "re_grow_package", "re_run_sample"]
};

export const defaultContextPolicy: readonly ContextSectionPolicy[] = [
  { kind: "observation", title: "本轮目标与设定", source: "premise + chapter_goal", maxChars: 2000 },
  { kind: "short_term", title: "前情提要", source: "prior chapter outlines + last chapter tail", maxChars: 2400 },
  { kind: "long_term", title: "作品长期设定", source: "character_bible + world_bible", maxChars: 2400 },
  { kind: "feedback", title: "已采纳反馈", source: "accepted feedback candidates", maxChars: 1200 }
];

export const defaultQualityRules: readonly QualityRule[] = [
  { kind: "length", minChars: 900, maxChars: 1500, note: "每章中文字数区间" },
  { kind: "chapter_continuity", note: "章节编号必须连续" },
  { kind: "year_consistency", note: "公元年份不得在章节间漂移" },
  { kind: "character_continuation", note: "上一章结尾出现的人物应在本章开头延续" },
  { kind: "geography_consistency", note: "地点设定不得自相矛盾" },
  { kind: "outline_continuity", note: "novel-state 大纲应逐章累积" },
  { kind: "artifact_presence", note: "每章须有 message list / trace / quality eval" }
];

export const defaultFeedbackRouting: readonly FeedbackRoutingRule[] = [
  { issueKind: "length", layer: "work", reason: "单章字数是作品级问题，本地修订或重跑" },
  { issueKind: "year_consistency", layer: "work", reason: "具体年份是作品事实，留在作品项目" },
  { issueKind: "geography_consistency", layer: "work", reason: "具体地理设定是作品事实，留在作品项目" },
  { issueKind: "character_continuation", layer: "capability", reason: "反复忘前文是写作上下文/记忆能力问题，回流 xiaoshuo" },
  { issueKind: "outline_continuity", layer: "capability", reason: "章节计划与正文断裂是小说能力问题，回流 xiaoshuo" },
  { issueKind: "chapter_continuity", layer: "capability", reason: "章节连续性是写作流程能力问题，回流 xiaoshuo" },
  { issueKind: "artifact_presence", layer: "system", reason: "trace/message-list 缺失是 feng 运行记录底座问题" }
];

export function routingLayerFor(
  rules: readonly FeedbackRoutingRule[],
  issueKind: string
): FeedbackRoutingRule {
  const found = rules.find((rule) => rule.issueKind === issueKind);
  return found ?? { issueKind, layer: "work", reason: "默认留在作品项目，待人工归因" };
}

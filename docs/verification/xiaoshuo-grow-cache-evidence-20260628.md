# xiaoshuo grow live evidence: quality ready, cache not ready

Date: 2026-06-28

Scope:

```text
feng repo: F:\code\feng
xiaoshuo grow project: F:\code\xiaoshuo
previous incomplete backup: F:\code\xiaoshuo-incomplete-bak-20260628-172907
```

## Command

```text
node F:\code\feng\bin\feng.mjs grow --goal "成长出一个可复制的中文连载小说写作 agent。它必须不是一个 prompt wrapper，而是能接收作品设定、人物、提纲、已有章节、章节目标和作者反馈，输出章节草稿、改稿、续写计划、设定冲突、质量门禁和反馈候选；能保持长篇上下文、人物、时间线、地点、伏笔和情节推进连贯；能把作品层、小说 agent 能力层、feng 系统层问题正确归因并回流。" --name xiaoshuo --rounds 3 --sample-chapters 2
```

`MAX_TOKENS=8192` was set for this run.

## Pre-run backup discipline

The previous `F:\code\xiaoshuo` run was incomplete and backed up only after cache analysis was written:

```text
F:\code\xiaoshuo-incomplete-bak-20260628-172907\.feng\cache-analysis\pre-backup-20260628-172907.md
```

That analysis recorded:

```text
completed_receipts=33
overall_cache_hit_rate=20.87%
semantic_judge_hit=0.81%
goal_coverage_judge_hit=0%
last ledger event: llm_request_started without matching response
```

## Grow result

The new run completed all three grow rounds.

Final stdout:

```text
[grow] .feng/hatch/xiaoshuo-runtime.json growUnit=grow-4eb6e092-33f9-4204-947c-cacaf3481347 lifecycle=ready_to_hatch readiness=ready
  round 1 (v0.1.0): chapters=2 fail=0 capabilityIssues=[semantic_character,semantic_plot] added=5 cache=18.8% (3968/21102 input tokens, calls=11, zero=8)
  round 2 (v0.2.0): chapters=2 fail=0 capabilityIssues=[semantic_character] added=0 cache=8.22% (3584/43577 input tokens, calls=14, zero=10)
  round 3 (v0.3.0): chapters=2 fail=0 capabilityIssues=[] added=0 cache=4.88% (896/18368 input tokens, calls=8, zero=7)
  improved=true finalCapabilityIssues=0 cache=14.29% (12800/89584 input tokens, calls=36, zero=25)
```

Final files:

```text
F:\code\xiaoshuo\.feng\hatch\xiaoshuo-runtime.json
F:\code\xiaoshuo\.feng\quality-gates\xiaoshuo.json
F:\code\xiaoshuo\.feng\grow-samples\latest-checkpoint.json
```

Final package:

```text
name=xiaoshuo
version=1.0.0
locked=true
runEntry=feng run
```

Final quality gate summary:

```text
totalGates=12
passed=12
failed=0
uncoveredRequirements=0
blockingCount=0
```

## Judgment

This is a valid quality-ready hatch candidate for the `xiaoshuo` agent layer:

```text
finalCapabilityIssues=0
quality gates 12/12 passed
blocking=0
goal coverage uncovered=0
locked=true
```

However, it is not a cache-healthy long-running flow:

```text
overall cache=14.29%
round 1 cache=18.8%
round 2 cache=8.22%
round 3 cache=4.88%
zero-cache calls=25/36
```

The most important phase failures are:

```text
chapter_generation: repeatedly 0% cache
semantic_judge: repeatedly 0% cache
goal_coverage_judge: repeatedly 0% cache
```

This should be treated as a feng system-layer issue in the Message Compiler / Prompt Context Kernel, not as a xiaoshuo domain-quality issue.

## Next action

Do not advance to `libai-chongshengle` as the main proof path until cache health is addressed or explicitly accepted as a known temporary system defect.

The next implementation focus should be:

```text
Preserve a stable prefix for authoring generation, semantic judge, and goal coverage judge calls.
Keep dynamic chapter text, request ids, timestamps, paths, and prior outputs after the stable cached prefix.
Add tests that compare stable prefixes across repeated chapter/judge/coverage message lists.
Re-run xiaoshuo grow and require materially better cache evidence before claiming long-running health.
```

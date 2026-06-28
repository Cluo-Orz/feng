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

## 2026-06-28 18:11 rerun after stable-prefix expansion

After `e04002f Expand stable authoring cache context`, `F:\code\xiaoshuo` was recreated and the same grow command was run again:

```text
node F:\code\feng\bin\feng.mjs grow --goal "成长出一个可复制的中文连载小说写作 agent。它必须不是一个 prompt wrapper，而是能接收作品设定、人物、提纲、已有章节、章节目标和作者反馈，输出章节草稿、改稿、续写计划、设定冲突、质量门禁和反馈候选；能保持长篇上下文、人物、时间线、地点、伏笔和情节推进连贯；能把作品层、小说 agent 能力层、feng 系统层问题正确归因并回流。" --name xiaoshuo --rounds 3 --sample-chapters 2
```

The run stopped after round 2 because readiness became `ready_to_hatch`.

Final files:

```text
F:\code\xiaoshuo\.feng\hatch\xiaoshuo-runtime.json
F:\code\xiaoshuo\.feng\quality-gates\xiaoshuo.json
F:\code\xiaoshuo\.feng\grow-samples\latest-checkpoint.json
```

Final quality result:

```text
readiness=ready_to_hatch
quality gates 12/12 passed
blocking=0
coverage_uncovered=0
latestRound=2
```

Round evidence:

```text
round 1: chapters=2 failChapters=1 blocking=5 goalCoverageIssues=1
round 2: chapters=2 failChapters=0 blocking=0 goalCoverageIssues=0
```

This is a stronger quality signal than the previous run because the first round exposed real failures and the second round removed them through grow rather than by manual instruction.

Cache evidence remains insufficient:

```text
overall: 20 calls, 54627 input tokens, 17536 cache-read tokens, hit=32.10%, zero-cache calls=5
round 2: 6 calls, 15258 input tokens, 2560 cache-read tokens, hit=16.78%, zero-cache calls=2
grow_design: 72.23%
chapter_generation: 0%
semantic_judge: 21.55%
semantic_repair_generation: 61.40%
goal_coverage_judge: 11.25%
chapter_repair: 93.59%
```

The important correction is that cache now works for some adjacent repair paths, proving the file-native message-list prefix can be reused. The remaining defect is narrower and more serious:

```text
chapter_generation stayed 0% across all four generation calls.
goal_coverage_judge improved but stayed far below the long-running target.
semantic_judge improved only modestly.
```

Judgment:

```text
xiaoshuo is quality-ready as a hatch candidate.
feng is not cache-ready as a long-running grow system.
The next system-layer fix should focus on making chapter_generation carry a provider-cacheable stable prefix, not only repair/judge calls.
```

## 2026-06-28 18:32 and 18:45 cache experiments

Two short reruns were used to test cache hypotheses without waiting for full grow completion.

Experiment A used `70063b6 Expand authoring generation cache prefix`:

```text
backup: F:\code\xiaoshuo-cacheprefix-multimsg-bak-20260628-184401
pre-backup analysis: F:\code\xiaoshuo-cacheprefix-multimsg-bak-20260628-184401\.feng\cache-analysis\pre-backup-20260628-184401.md
messages=3
stablePrefixMessageCount=2
cachePrefixChars=8377
chapter-01/chapter-02 cachePrefix hash=6d750c47eb4a1ecb
authoring-ch1-0 hit=0.00%
authoring-ch2-0 hit=0.00%
overall partial hit=44.13%
```

This disproved the weak hypothesis that the generation prefix was merely too short. The prefix was long and byte-stable, but cross-chapter `chapter_generation` still had no cache read.

Experiment B used `44bd7b1 Place authoring dynamic input after stable prefix`:

```text
backup: F:\code\xiaoshuo-cacheprefix-singlemsg-bak-20260628-184923
pre-backup analysis: F:\code\xiaoshuo-cacheprefix-singlemsg-bak-20260628-184923\.feng\cache-analysis\pre-backup-20260628-184923.md
messages=2
stablePrefixMessageCount=1
stablePrefixBoundary.charOffset=7636
cachePrefixChars=8105
chapter-01/chapter-02 cachePrefix hash=bcf65016b3be97e8
authoring-ch1-0 hit=0.00%
authoring-ch2-0 hit=0.00%
overall partial hit=17.27%
```

This disproved the next hypothesis that provider cache was failing because dynamic input began in a separate user message. Even when the dynamic difference was moved after a long stable prefix inside the same user message, cross-chapter `chapter_generation` still had no cache read.

Follow-up code judgment:

```text
Keep: recording the full provider-neutral messages in message-list.json.
Keep: recording stablePrefixBoundary so the stable/dynamic split is auditable.
Remove: the long hardcoded generation prompt expansion, because live evidence showed it increased cold input size without improving cross-chapter generation cache.
```

Current conclusion:

```text
Do not keep extending prompt text blindly.
The next investigation should inspect provider gateway behavior and whether explicit cache-control, provider-specific prompt-cache APIs, or a different request shape is required.
Until then, feng can claim quality-ready xiaoshuo hatch evidence, but not cache-ready long-running growth evidence.
```

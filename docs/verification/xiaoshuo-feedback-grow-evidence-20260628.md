# xiaoshuo grow after libai feedback: feedback absorbed, hatch still draft

Date: 2026-06-28

Scope:

```text
feng repo: F:\code\feng
agent grow project: F:\code\xiaoshuo
source feedback: F:\code\libai-chongshengle -> F:\code\xiaoshuo\.feng\grow-inbox\capability-feedback.json
```

## Command

```text
node F:\code\feng\bin\feng.mjs grow --goal "成长出一个可复制的中文连载小说写作 agent。它必须不是一个 prompt wrapper，而是能接收作品设定、人物、提纲、已有章节、章节目标和作者反馈，输出章节草稿、改稿、续写计划、设定冲突、质量门禁和反馈候选；能保持长篇上下文、人物、时间线、地点、伏笔和情节推进连贯；能把作品层、小说 agent 能力层、feng 系统层问题正确归因并回流。当前已从 libai-chongshengle 回流 goal_coverage 能力反馈，要求 xiaoshuo grow 后能更稳定地覆盖每章显式目标，不能漏题。" --name xiaoshuo --rounds 2 --sample-chapters 3
```

Log files in the xiaoshuo project:

```text
F:\code\xiaoshuo\grow-after-libai-feedback-isolated.out.log
F:\code\xiaoshuo\grow-after-libai-feedback-isolated.err.log
```

## Sample Isolation

This run used the growUnit-isolated sample directory introduced in `ad31f71`:

```text
.feng/grow-samples/grow-22052d9b-d400-4b1c-bdf2-10eb8f762139/round-1
.feng/grow-samples/grow-22052d9b-d400-4b1c-bdf2-10eb8f762139/round-2
```

The round sample `novel-state.json` files started from chapter 1 within the current growUnit instead of continuing from the prior sample project. This makes the failure below valid evidence rather than stale-state pollution.

## Result

Final stdout:

```text
[grow] .feng/hatch/xiaoshuo-runtime.json growUnit=grow-22052d9b-d400-4b1c-bdf2-10eb8f762139 lifecycle=verifying readiness=draft
  seeded 1 constraint(s) from downstream capability feedback
  capability adoption: .feng/grow-inbox/capability-feedback-adoption.json
  round 1 (v0.1.0): chapters=3 fail=2 capabilityIssues=[semantic_plot] added=2 cache=43.77% (16640/38013 input tokens, calls=16, zero=2)
  round 2 (v0.2.0): chapters=3 fail=1 capabilityIssues=[semantic_plot] added=1 cache=38.28% (17024/44467 input tokens, calls=14, zero=2)
  improved=false finalCapabilityIssues=1 cache=41.45% (36096/87087 input tokens, calls=32, zero=4)
```

Package status:

```text
locked=false
validation.readiness=draft
quality gates 10/13 passed
blocking=6
coverage_uncovered=3
```

The xiaoshuo package correctly absorbed the libai `goal_coverage` feedback as a strategy constraint:

```text
每章正文必须正面回应【本章目标】：把目标转化为可见事件、行动或冲突写进正文；不能只在提示词、摘要或大纲中提到目标。
```

However, absorption did not make the agent ready. The final blockers were:

```text
gate-semantic-plot: failed
gate-length: failed
gate-sample-work-quality-gates: failed
```

Round 2 sample blockers:

```text
chapter 1: blocking=0
chapter 2: semantic_plot needs human judgment; runtime_capability needs human judgment
chapter 3: length failed; runtime_capability needs human judgment; feedback-routing failed
```

Runtime capability issues came from model output truncation during semantic repair (`finishReason=length`). This is not a libai work-project issue; it indicates the current authoring runtime/grow loop still lacks a robust output-budget or staged-repair strategy for long chapters.

## Cache Evidence

Overall:

```text
calls=32
inputTokens=87087
cacheReadTokens=36096
cacheHitRate=41.45%
zeroCacheReadCalls=4
```

By phase:

```text
grow_design: 52.79%
chapter_generation: 28.02%
chapter_repair: 93.59%
semantic_judge: 25.84%
semantic_repair_generation: 61.39%
goal_coverage_judge: 20.86%
```

Judgment:

```text
Cache is better than the earliest runs but still not healthy for long-running growth.
Repair calls benefit strongly from stable prefixes.
Generation and judge calls remain far below the 80%-95% long-running target.
```

## Decision

Do not install this xiaoshuo hatch package into `libai-chongshengle`.

The valid next step is not manual novel rewriting. The next step is to improve feng/xiaoshuo growth so that:

```text
sample work gates reach blocking=0,
semantic_plot no longer remains as a capability blocker after grow,
length/output-budget failures are handled without finishReason=length runtime issues,
and cache health for warm generation/judge calls is measured separately.
```

## 2026-06-29 00:50 rerun after output-budget calibration

After `a65d96e Calibrate grow output budget on truncation`, xiaoshuo was grown again with a four-round ceiling:

```text
node F:\code\feng\bin\feng.mjs grow --goal "..." --name xiaoshuo --rounds 4 --sample-chapters 3
```

Log files:

```text
F:\code\xiaoshuo\grow-after-budget-fix.out.log
F:\code\xiaoshuo\grow-after-budget-fix.err.log
```

Result:

```text
[grow] .feng/hatch/xiaoshuo-runtime.json growUnit=grow-383e39fc-a814-4701-b9cf-422f2bbb0d34 lifecycle=ready_to_hatch readiness=ready
  seeded 1 constraint(s) from downstream capability feedback
  round 1 (v0.1.0): chapters=3 fail=0 capabilityIssues=[semantic_style,semantic_plot] added=3 cache=45.18% (14848/32866 input tokens, calls=13, zero=1)
  round 2 (v0.2.0): chapters=3 fail=0 capabilityIssues=[] added=0 cache=35.38% (7552/21344 input tokens, calls=9, zero=1)
  round 3 (v0.3.0): chapters=3 fail=0 capabilityIssues=[] added=0 cache=47.04% (9216/19593 input tokens, calls=9, zero=0)
  improved=true finalCapabilityIssues=0 cache=45.08% (35328/78361 input tokens, calls=33, zero=2)
```

Final package:

```text
packageId=pkg-grow-383e39fc-a814-4701-b9cf-422f2bbb0d34-1.0.0
locked=true
validation.readiness=ready
quality gates 14/14 passed
blocking=0
coverage_uncovered=0
sample evidence under .feng/grow-samples/grow-383e39fc-a814-4701-b9cf-422f2bbb0d34/
```

Round progression:

```text
round 1: capability=[semantic_style, semantic_plot], sample blocking=2
round 2: capability=[], sample blocking=2, goalCoverageIssueCount=1
round 3: capability=[], sample blocking=0, goalCoverageIssueCount=0
```

Important cache evidence:

```text
overall cache=45.08%
chapter_generation phase total=67.94%
round 3 chapter_generation=87.04%, zero-cache calls=0
semantic_judge=30.88%
goal_coverage_judge=26.84%
```

Judgment:

```text
The xiaoshuo agent is now a valid ready hatch candidate for the next libai run.
The chapter generation warm-cache behavior is acceptable in the final round.
Judge-call cache remains a system-level optimization gap and should not be hidden by the ready hatch result.
```

## 2026-06-29 04:02 command-shape and routing-safe package update

The previous sections are historical evidence. Starting from this point, follow-up grow runs should not pass a changing long `--goal` string on every command. The high-level command shape is:

```text
node F:\code\feng\bin\feng.mjs grow --name xiaoshuo --rounds 4 --sample-chapters 3
```

When `--goal` is omitted, `feng grow` now infers the goal from file-native state, in this order:

```text
.feng/quality-gates/<name>.json
.feng/hatch/<name>-runtime.json
.feng/grow-units/records/<latest-or-matching-grow>.json
default fallback only if no prior state exists
```

This matters because the stable command represents one continuing grow unit in one workspace. Changing the goal text in every CLI invocation makes external execution approval noisy and weakens the product mental model.

After the capability-routing gate fix, the package `pkg-grow-0d40b957-8b32-4173-bffd-79bc5cb83b3a-1.0.0` was explicitly rejected even though it said `readiness=ready`, because it downgraded seeded `goal_coverage` capability feedback to `work`. That rejection is recorded in:

```text
F:\code\xiaoshuo\.feng\cache-analysis\pre-rerun-20260629-034803.md
```

The accepted rerun is:

```text
F:\code\xiaoshuo\grow-after-routing-gate-fix.out.log
F:\code\xiaoshuo\grow-after-routing-gate-fix.err.log
```

Result:

```text
[grow] .feng/hatch/xiaoshuo-runtime.json growUnit=grow-1111c772-516d-4e2e-8ed9-89126492bece lifecycle=ready_to_hatch readiness=ready
  seeded 1 constraint(s) from downstream capability feedback
  capability adoption: .feng/grow-inbox/capability-feedback-adoption.json
  round 1 (v0.1.0): chapters=3 fail=0 capabilityIssues=[] added=0 cache=28.72% (8064/28082 input tokens, calls=11, zero=2)
  improved=true finalCapabilityIssues=0 cache=28.56% (8704/30472 input tokens, calls=12, zero=2)
```

Accepted package:

```text
packageId=pkg-grow-1111c772-516d-4e2e-8ed9-89126492bece-1.0.0
locked=true
validation.readiness=ready
quality gates 12/12 passed
blocking=0
coverage_uncovered=0
goal_coverage routes to capability
length contract: 2000-8000 chars
```

Judgment:

```text
This xiaoshuo package is the current valid candidate for the next libai end-to-end rerun.
The package preserves the multi-layer feedback loop: downstream goal_coverage failures remain capability feedback to xiaoshuo.
Cache health is still weak overall and must be analyzed before backing up or replacing libai.
```

## 2026-06-29 04:29 rerun after libai short-video subgoal miss

The clean libai run after runtime fixes exposed a real goal coverage miss:

```text
chapter=2
issueKind=goal_coverage
judge parseOk=true
missing=目标要求看到诗被作为短视频素材，正文只出现书籍商品，完全没有提及短视频素材
```

That feedback was routed to xiaoshuo:

```text
F:\code\xiaoshuo\.feng\grow-inbox\capability-feedback.json
issueKinds=[goal_coverage]
count=1
```

Before rerun, cache analysis was written:

```text
F:\code\xiaoshuo\.feng\cache-analysis\pre-rerun-20260629-042454.md
```

Grow command used the fixed command shape with no `--goal`:

```text
node F:\code\feng\bin\feng.mjs grow --name xiaoshuo --rounds 4 --sample-chapters 3
```

Result:

```text
[grow] .feng/hatch/xiaoshuo-runtime.json growUnit=grow-18270bca-56f7-4d71-843d-45115f67aef6 lifecycle=ready_to_hatch readiness=ready
  goal: 成长出一个可复制的中文连载小说写作 (source=.feng/quality-gates/xiaoshuo.json)
  seeded 1 constraint(s) from downstream capability feedback
  capability adoption: .feng/grow-inbox/capability-feedback-adoption.json
  round 1 (v0.1.0): chapters=3 fail=0 capabilityIssues=[] added=0 cache=35.82% (9600/26800 input tokens, calls=11, zero=1)
  improved=true finalCapabilityIssues=0 cache=35.94% (10368/28848 input tokens, calls=12, zero=1)
```

Accepted package:

```text
packageId=pkg-grow-18270bca-56f7-4d71-843d-45115f67aef6-1.0.0
locked=true
validation.readiness=ready
quality gates 12/12 passed
blocking=0
coverage_uncovered=0
goal_coverage routes to capability
length contract: 1500-5000 chars
```

Important judgment:

```text
The new package should not hard-code libai-specific "short video" facts into xiaoshuo.
It must instead preserve a general no-missing-topic behavior and prove it by passing the next libai rerun.
Cache improved from 28.56% to 35.94% but remains far below the long-running target.
```

## 2026-06-29 10:22 grow after clean libai feedback exposed redesign replacement bug

After the clean libai rerun was routed, xiaoshuo received active capability feedback:

```text
chapter 1 goal_coverage: bookshop shelter goal was not actually completed.
chapter 2 goal_coverage: short-video material was missing again.
chapter 3 semantic_plot: episode lacked a clear choice, cost, or plot turn.
```

Before rerun, cache analysis was written:

```text
F:\code\xiaoshuo\.feng\cache-analysis\pre-rerun-20260629-095214.md
```

Grow command used the fixed command shape with no `--goal`:

```text
node F:\code\feng\bin\feng.mjs grow --name xiaoshuo --rounds 4 --sample-chapters 3
```

The shell wrapper timed out, but the node child completed and wrote:

```text
growUnit=grow-e8362e55-54b4-4dcb-82cf-2e9c0029d18b
packageId=pkg-grow-e8362e55-54b4-4dcb-82cf-2e9c0029d18b-1.0.0
locked=false
validation.readiness=draft
quality gates 13/14 passed
blocking=3
coverage_uncovered=2
```

Round progression:

```text
round 1: capability=[semantic_plot], added semantic plot constraint, cache=41.16%
round 2: failChapters=1, capability=[], cache=42.67%
round 3: failChapters=0, capability=[], sampleGateBlocking=0, goalCoverageIssueCount=0, cache=48.20%
overall grow cache=43.92%
round 3 chapter_generation cache=84.49%
```

Important judgment:

```text
The final sample round passed, so the xiaoshuo behavior improved.
The hatch package was still correctly rejected because gate-grown-coverage-policy failed:
coveragePolicyAuthoredByGrow=false.
This matched the product requirement that "不能漏题" must be produced by grow as a real runtime contract, not supplied by a default fallback.
```

Root cause:

```text
loop-design produced a complete design with generated coveragePolicy=true.
round-1-redesign was truncated with finishReason=length and parseOk=false.
designStrategy correctly recorded that redesign attempt as designStatus=incomplete.
grow-loop still replaced currentDesign with the incomplete redesign fallback.
That fallback preserved runnable defaults but erased the generated coveragePolicy evidence.
```

Feng correction:

```text
designStrategy now returns finishReason, parseOk, designStatus, and missingGeneratedFields to callers.
grow-loop only lets a completed sample redesign replace the current grown design.
An incomplete redesign still writes message-list/model-output/trace artifacts and contributes usage evidence, but the loop keeps the previous complete design plus deterministic constraints derived from sample feedback.
```

Verification:

```text
npm test -- tests/host/grow-loop.test.ts tests/host/grow-agent.test.ts tests/authoring-runtime/quality-gates.test.ts
npm run build
```

Regression test added:

```text
does not let an incomplete sample redesign replace a complete grown design
```

Next valid step:

```text
Commit and push the correction.
Before rerunning xiaoshuo grow, write a new cache/rerun analysis that records the failed grow-e836 result and the fixed redesign acceptance rule.
Then rerun:
node F:\code\feng\bin\feng.mjs grow --name xiaoshuo --rounds 4 --sample-chapters 3
```

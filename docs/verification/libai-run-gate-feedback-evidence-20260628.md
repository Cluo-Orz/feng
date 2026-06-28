# libai run live evidence: gate failure routed to xiaoshuo

Date: 2026-06-28

Scope:

```text
feng repo: F:\code\feng
agent grow project: F:\code\xiaoshuo
work project: F:\code\libai-chongshengle
```

## Commands

Install the current xiaoshuo hatch package into the work project:

```text
node F:\code\feng\bin\feng.mjs install-runtime --from F:\code\xiaoshuo --feng-dir F:\code\feng
```

Run three chapters with semantic evaluation and a runtime debug report:

```text
node F:\code\feng\bin\feng.mjs run --chapters 3 --semantic-eval --debug-report
```

Route file-native feedback from the work project:

```text
node F:\code\feng\bin\feng.mjs route-feedback --target F:\code\libai-chongshengle
```

## Runtime result

The xiaoshuo runtime installed successfully:

```text
package=xiaoshuo@1.0.0
locked=true
readiness=ready
hash=68c8489ca0fe5818c5e63b608ed6dd1b334c8e0e721992c9f9bb33856adbaff4
```

The run produced business outputs in the work-project root:

```text
chapters/chapter-01.md
chapters/chapter-02.md
chapters/chapter-03.md
outlines/chapter-01.md
outlines/chapter-02.md
outlines/chapter-03.md
outline.md
feedback-candidates/chapter-*.json
setting-conflicts/chapter-*.json
```

The runtime state stayed under `.feng/runtime`, including input, message-list, model-output, trace, quality eval, semantic eval, goal coverage eval, quality gates, package lock, and debug report.

## Gate result

The chapters passed structural quality checks and semantic score thresholds, but failed explicit chapter-goal coverage gates:

```text
chapter 1: quality=pass semantic=8.0 cache=20.89% gates=8/9 passed blocking=2 uncovered=1
chapter 2: quality=pass semantic=8.7 cache=18.33% gates=8/9 passed blocking=2 uncovered=1
chapter 3: quality=pass semantic=8.0 cache=36.36% gates=8/9 passed blocking=2 uncovered=1
```

Failed gate:

```text
gateId=gate-chapter-coverage
layer=capability
issueKind=goal_coverage
status=failed
```

Coverage misses:

```text
chapter 1 missed the first direct encounter with surveillance/monitoring.
chapter 2 goal coverage judge returned no positive evidence.
chapter 3 resolved the ending choice too explicitly instead of leaving the requested choice open.
```

Judgment:

```text
libai-chongshengle is not accepted as a good novel candidate yet.
xiaoshuo is not accepted as a high-quality writing agent yet.
This is a useful failure because the missed requirements were detected by file-native gates instead of being hidden inside prompts.
```

## Feedback routing

`route-feedback` correctly attributed these failures to the xiaoshuo capability layer:

```text
[route-feedback] total=3 work(kept-local)=0 capability->agent=3 system->feng=0
inferred agent: F:\code\xiaoshuo
inferred feng: F:\code\feng
capability digest: .feng/grow-inbox/capability-feedback.json
```

The resulting digest in `F:\code\xiaoshuo\.feng\grow-inbox\capability-feedback.json` contains three admitted `goal_coverage` candidates. This is the desired boundary for this failure: specific libai text stays local, while the agent-level problem "the writing agent did not reliably satisfy explicit chapter goals" becomes xiaoshuo grow input.

## System correction

The live run exposed a generic CLI semantics bug: `feng run` could exit successfully even when chapter quality gates were blocking. That made it too easy for an automation layer to treat "chapter artifacts exist" as "chapter accepted".

Correction:

```text
src/host/host-commands.ts now returns non-zero from run when any chapter has unresolved quality gates.
tests/host/host-commands.test.ts now expects run --debug-report / run --semantic-eval --debug-report to block when debug report candidates or no-missing-topic gates are unresolved.
```

The command still writes all file-native artifacts before returning non-zero, so the supervisor can inspect the failure and run `route-feedback`.

## Next action

The next valid step is not manual rewriting of the libai chapters. The next step is:

```text
Let xiaoshuo grow from the routed capability feedback.
Re-hatch or update the xiaoshuo package only after its own quality gates pass.
Reinstall into libai-chongshengle.
Rerun libai and require chapter-goal gates to reach blocking=0 before accepting the run.
```

If the work project is backed up, cleared, or replaced before the rerun, first write a cache-hit analysis under the project `.feng/cache-analysis/` directory.

## 2026-06-29 rerun with ready xiaoshuo package

Before replacing the failed work project, cache analysis was written inside the failed project:

```text
F:\code\libai-chongshengle\.feng\cache-analysis\pre-backup-20260629-005511.md
```

The failed project was then backed up to:

```text
F:\code\libai-chongshengle-bak-20260629-005531
```

Only creator inputs were restored into the clean work project:

```text
premise.md
characters.md
world.md
chapter-goals.md
.feng/runtime/project.json
```

The ready xiaoshuo package was installed:

```text
packageId=pkg-grow-383e39fc-a814-4701-b9cf-422f2bbb0d34-1.0.0
hash=2a91d31bf7d8f489e04d87573b0b5bd6744797479332584c61bd5f2c84eb56de
locked=true
readiness=ready
```

Run command:

```text
node F:\code\feng\bin\feng.mjs run --chapters 3 --semantic-eval --debug-report
```

Log files:

```text
F:\code\libai-chongshengle\run-after-xiaoshuo-ready.out.log
F:\code\libai-chongshengle\run-after-xiaoshuo-ready.err.log
```

Result:

```text
chapter 1: quality=pass semantic=8.3/10 gates=12/12 blocking=0 coverage_uncovered=0 cache=41.88%
chapter 2: quality=pass semantic=8.3/10 gates=12/12 blocking=0 coverage_uncovered=0 cache=23.96%
chapter 3: quality=pass semantic=8.7/10 gates=12/12 blocking=0 coverage_uncovered=0 cache=37.11%
```

Goal coverage:

```text
chapter 1: covered=true confidence=0.95
chapter 2: covered=true confidence=0.95
chapter 3: covered=true confidence=0.75
```

Overall runtime usage:

```text
calls=13
inputTokens=37149
cacheReadTokens=13824
cacheHitRate=37.21%
zeroCacheReadCalls=1
```

Judgment:

```text
The rerun is accepted as a successful end-to-end libai candidate run.
xiaoshuo produced root-level business outputs while runtime state stayed under .feng.
All work quality gates passed and no feedback candidates remained.
The generated chapters are readable candidate drafts, not final publication copy: semantic judges still suggest better motivation setup, trust-transition pacing, and a sharper challenge from Chen Yan about Li Bai's knowledge source.
Cache remains below the long-running target overall, so judge-call cache optimization stays open even though this run is accepted functionally.
```

## 2026-06-29 04:11 rerun with routing-safe xiaoshuo package

Before replacing the previous accepted work project, cache analysis was written and preserved:

```text
F:\code\libai-chongshengle\.feng\cache-analysis\pre-backup-20260629-040208.md
F:\code\libai-chongshengle-bak-20260629-040208\.feng\cache-analysis\pre-backup-20260629-040208.md
```

The previous project was backed up to:

```text
F:\code\libai-chongshengle-bak-20260629-040208
```

Only creator inputs and `.feng/runtime/project.json` were restored into the clean work project. The newer routing-safe xiaoshuo package was installed:

```text
packageId=pkg-grow-1111c772-516d-4e2e-8ed9-89126492bece-1.0.0
hash=fa4fdd9df287c876d095569c8bfac50128933ee99d9fffc2f796a488e0c424e7
locked=true
readiness=ready
```

Run command:

```text
node F:\code\feng\bin\feng.mjs run --chapters 3 --semantic-eval --debug-report
```

Log files:

```text
F:\code\libai-chongshengle\run-after-routing-safe.out.log
F:\code\libai-chongshengle\run-after-routing-safe.err.log
```

Result:

```text
chapter 1: quality=pass semantic=8.7/10 gates=10/11 blocking=1 coverage_uncovered=0 cache=19.77%
chapter 2: quality=pass semantic=8.7/10 gates=9/10 blocking=2 coverage_uncovered=1 cache=29.69%
chapter 3: quality=pass semantic=8.7/10 gates=10/10 blocking=0 coverage_uncovered=0 cache=36.10%
```

Blocking issues:

```text
chapter 1: runtime_capability -> system
  semantic repair response was finishReason=length; runtime still used the candidate.

chapter 2: gate-chapter-coverage failed as goal_coverage
  goal-coverage-eval.json contained covered=false confidence=0 evidence=[] missing=[] notes="".
  Manual inspection of chapter text shows it substantially covers the target, so the actionable diagnosis is not "xiaoshuo definitely missed the goal".
```

Codex judgment:

```text
The run correctly blocked acceptance.
The chapter 1 issue is a feng/system runtime capability gap.
The chapter 2 failure exposed a file-native evidence gap: raw goal-coverage judge output was not written with the parsed eval, so the failed judgment cannot be replayed.
An invalid or non-actionable goal-coverage judge result must not be routed as xiaoshuo goal_coverage capability feedback.
```

Feng correction added after this run:

```text
goal-coverage-eval.json now records parseOk and raw judge output.
Malformed or non-actionable goal coverage evals route as goal_coverage_eval_invalid at the system layer.
goal_coverage is reserved for valid evals that provide missing target evidence.
```

Next valid step:

```text
Commit and push the goal coverage evidence fix.
Route the current libai feedback so runtime_capability reaches feng and true capability issues reach xiaoshuo.
Rerun libai from a clean state after deciding whether to first resolve the system-level runtime_capability and goal_coverage_eval_invalid gaps.
```

## 2026-06-29 04:16 review and route current failed run

Because chapter 2 was generated before the `goal_coverage_eval_invalid` fix, its gate still looked like a capability `goal_coverage` failure. Codex reviewed the actual chapter text before routing feedback.

Manual review command:

```text
node F:\code\feng\bin\feng.mjs review-work-gate --chapter 2 --gate gate-chapter-coverage --decision passed --reason "Codex review: chapter text visibly covers the bookstore poetry-commodity shock, short-video anger, Su Xiaoman identity test, improvised poem, and partial trust shift; the failed judge output had no actionable missing evidence." --reviewer codex
```

Review result:

```text
.feng/runtime/chapters/chapter-02/gate-review.json
quality gates 10/10 passed; blocking=0; coverage_uncovered=0
```

Feedback route command:

```text
node F:\code\feng\bin\feng.mjs route-feedback --agent-dir F:\code\xiaoshuo --feng-dir F:\code\feng
```

Route result:

```text
total=2
work(kept-local)=0
capability->agent=0
system->feng=2
```

System digest:

```text
F:\code\feng\.feng\grow-inbox\system-feedback.json
issueKinds=[runtime_capability]
count=2
```

The two system entries are the direct runtime feedback and the corresponding quality-gate evidence for the same chapter 1 problem:

```text
第1章 语义修复1 被模型输出长度截断(finishReason=length)；当前 runtime 仍继续使用该候选，需要 feng 调整输出预算、分阶段写作或截断检测策略
gate-routed-runtime-capability needs_human_judgment
```

Xiaoshuo capability digest:

```text
F:\code\xiaoshuo\.feng\grow-inbox\capability-feedback.json
issueKinds=[]
count=0
```

Judgment:

```text
The failed goal coverage judge was not allowed to pollute xiaoshuo capability feedback.
The only routed blocker from this run is a feng/system runtime capability gap.
Before another acceptance rerun, feng should resolve or grow against semantic-repair length truncation.
```

## 2026-06-29 04:18 runtime semantic-repair truncation fix

The routed system blocker was:

```text
第1章 语义修复1 被模型输出长度截断(finishReason=length)；当前 runtime 仍继续使用该候选，需要 feng 调整输出预算、分阶段写作或截断检测策略
```

Feng correction:

```text
Semantic repair is now treated as an optional improvement candidate.
If a semantic repair response returns finishReason=length, the runtime discards that repair candidate and keeps the previous chapter text.
The discarded repair is recorded in model-output.json semanticRepairs.
The original semantic issues remain available as capability feedback if they still fail the semantic gate.
Main chapter generation or structural repair truncation still remains a system risk.
```

Verification:

```text
npm test -- tests/authoring-runtime/runtime.test.ts tests/authoring-runtime/goal-coverage.test.ts tests/host/host-commands.test.ts tests/host/feedback-router.test.ts
npm run build
```

Judgment:

```text
The specific system failure "runtime used a length-truncated semantic repair candidate" is fixed.
The next libai acceptance rerun should be clean-state again, because the current run's chapter 1 was generated before this correction.
```

## 2026-06-29 04:39 rerun after short-video feedback grow

Before rerun, cache analysis was written:

```text
F:\code\libai-chongshengle\.feng\cache-analysis\pre-backup-20260629-043031.md
```

The failed runtime-fixed project was backed up:

```text
F:\code\libai-chongshengle-bak-20260629-043031
```

The newly grown xiaoshuo package was installed:

```text
packageId=pkg-grow-18270bca-56f7-4d71-843d-45115f67aef6-1.0.0
hash=ca2f25856e6007f6914ef70a724303db4cde1416111bb102b38dfa8813811a0e
```

Run result:

```text
chapter 1: quality=pass_with_warnings semantic=8/10 gates=7/11 blocking=5 coverage_uncovered=1
chapter 2: quality=pass_with_warnings semantic=8.3/10 gates=8/10 blocking=2 coverage_uncovered=0
chapter 3: quality=pass_with_warnings semantic=8.7/10 gates=8/10 blocking=2 coverage_uncovered=0
```

Important positive evidence:

```text
chapter 2 short-video素材 goal coverage passed.
goalCoverage=true confidence=0.95
evidence includes: 短视频里穿仿唐袍的男人用《将进酒》吆喝点赞，李白“瞳孔猛地收缩”“声音里有了怒意”
```

New blockers:

```text
chapter 1 goal coverage failed:
  missing=目标要求“最后被苏小满带到书店暂避”，但正文结尾只承诺“吃完我带你去个地方，先避一避”，未实际到达书店。

chapter 1 semantic_plot warning:
  苏小满突然出现，需要提前埋伏她的旁观细节。

geography_consistency false positives:
  runtime flagged 手机支付、流量、身份证、长安、西安 by mere occurrence.
```

Codex judgment:

```text
The new xiaoshuo package improved the exact short-video subgoal, but regressed broader no-missing-topic behavior on chapter 1.
The geography warnings expose a feng runtime quality-evaluator bug: conflictTerms were treated as forbidden geography terms by mere occurrence.
This package is not accepted.
```

Feng correction:

```text
checkGeography now warns only when a monitored term appears near explicit contradiction language such as 以前叫、改名、误作、应为、不是、并非、不在、矛盾 or 冲突.
Mere occurrence of monitored terms such as 手机支付、流量、身份证、长安、西安 no longer creates geography_consistency warnings.
```

Verification:

```text
npm test -- tests/authoring-runtime/quality.test.ts tests/authoring-runtime/runtime.test.ts tests/host/feedback-router.test.ts tests/host/host-commands.test.ts
npm run build
```

Next valid step:

```text
Route the current libai run's real capability issues back to xiaoshuo: chapter 1 goal_coverage and semantic_plot.
Do not accept the current package until a clean libai rerun passes all quality gates.
```

## 2026-06-29 04:50 route-feedback gate and stale feedback correction

While reviewing the 04:39 rerun before feeding it back into xiaoshuo, Codex found two feng-level routing defects:

```text
1. gate-feedback-routing compared feedback candidate count against a duplicated issue list, so already-routed work/capability issues could be mislabeled as a system routing failure.
2. capability-feedback digests were pruned only by exact gateId. Old goal_coverage feedback from a previous package could survive after the same chapter goal passed under a newer gateId.
```

Why this matters:

```text
The concept requires "不能漏题" to be produced as a real gate, and also requires feng not to absorb every downstream problem blindly.
These two defects polluted that boundary: real chapter 1 goal_coverage needed to reach xiaoshuo, while stale chapter 2 short-video feedback and false gate-feedback-routing system noise needed to stay out of the next grow input.
```

Correction:

```text
Work-project gates now materialize goal_coverage through the explicit chapter-goal coverage gate instead of duplicating it as a generic quality rule gate.
gate-feedback-routing now passes when deduplicated generated issues have routed candidates and by-layer counts match the candidate list.
route-feedback clears old digest entries by chapter+issueKind when the current run proves that issue kind has passed, even if the old gateId changed.
Duplicate gateIds no longer clear a failed gate unless every gate with that id has passed.
```

Verification:

```text
npm test -- tests/authoring-runtime/quality-gates.test.ts tests/host/feedback-router.test.ts tests/authoring-runtime/runtime.test.ts tests/host/host-commands.test.ts
npm run build
```

Next valid step:

```text
Commit and push this feng correction, then rerun libai from a clean state before letting xiaoshuo grow again.
The rerun should confirm that chapter 1 goal_coverage and semantic_plot are the only meaningful xiaoshuo capability signals, without stale chapter 2 feedback or gate-feedback-routing system noise.
```

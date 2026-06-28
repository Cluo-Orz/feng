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

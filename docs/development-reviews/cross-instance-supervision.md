# `feng supervise` — cross-instance feedback supervision Review

## Scope

Delivers the nested-supervision core: an **outer feng that collects an inner feng's anomalies through its own Admission / feedback mechanism**, file-native and deterministic (no LLM).

- `src/host/supervisor.ts`:
  - `detectIssues(state, minChars)` — pure analysis of an inner feng's `.feng/xiaoshuo/novel-state.json`: `not_started`, `too_short`, `self_repair_logged` (surfacing the inner writer's own repair notes), and `continuity_gap` (non-contiguous chapter numbers).
  - `superviseNovel(host, { targetRoot, minChars })` — opens the target workspace, reads its novel-state, detects issues, creates a supervision grow unit in the supervisor workspace, and for each issue runs the real Admission flow (`receiveRuntimeReport → normalize → classify → decideAdmission(admit_as_feedback_candidate)`) **and** `createFeedbackUnit`, so each inner-feng issue becomes a file-native feedback unit in the outer feng.
- `feng supervise --target <dir> [--min-chars N]` wired into `runCli`.
- The xiaoshuo writer now persists per-chapter `issues` into novel-state so the supervisor can collect the inner feng's self-repair history.

## Why this adaptation (questioning the detailed design)

The detailed-design Debug & Feedback Bridge is coupled to **hatched runtimes**: `openDebugCorrelation` requires a `hatchPackageRef` + `runtimeContractRef`, and correlation is built around agent-runtime-kernel traces. The novel writer (`feng write`) drives the gateway directly and produces no kernel traces, so the bridge does not fit without first building the heavy hatch + kernel-run-elsewhere path. Per the standing guidance ("实现优先，设计不是绝对真理；过度设计可调整"), the bridge's runtime-trace coupling is over-fit for non-action (authoring) agents. Because feng is file-native, the faithful and simpler realization of "外层 feng 采集内层 feng 异常并用 feedback 机制上报" is to read the inner feng's file-native state and route issues through the real **Admission & Feedback Inbox** module — which is exactly what this supervisor does. This keeps the concept (file-native, feedback-as-mechanism, no blind upstream absorption — the supervisor only collects and reports) without forcing the action-runtime machinery.

## Verification (live)

`feng supervise --target ../libai-chongsheng --min-chars 2500` against the real 3-chapter novel detected 3 `too_short` issues (1892 / 2004 / 1776 chars) and created 3 file-native feedback units under the supervisor workspace's `.feng/admission/feedback/records/`, reporting `feedbackCandidates=3`.

`npm run typecheck`, `npm run build`, `npm run test:coverage` pass (97 files / 463 tests, global branch 80.07%). `supervisor.ts` is 155 lines, `cli-entry.ts` 131 (≤ 400). Supervisor tests are LLM-free and deterministic.

## Boundary Checks

- The supervisor only **reads** the target workspace and **writes feedback into its own** workspace through Admission; it never mutates the inner feng's state and never blindly absorbs issues upstream (it records them as candidates for review — "是否合理吸收本身也是结果的一部分").
- All supervision output is file-native (admission inbox items + feedback units).

## Residual risks / follow-ups

- Issue detection is currently structural (length, continuity, logged repairs); semantic checks (plot consistency, character drift) would need an LLM pass and could themselves be a grow unit.
- A full Debug & Feedback Bridge correlation (with runtime traces) still requires the hatch + agent-runtime-kernel-run-elsewhere path; this supervisor is the faithful, lighter realization that matches how the authoring agent actually runs.
- Closing the loop automatically (supervisor → trigger inner-feng repair `feng write` re-run for the flagged chapter) is a natural next step; today the supervisor surfaces feedback and the operator/inner feng acts on it.

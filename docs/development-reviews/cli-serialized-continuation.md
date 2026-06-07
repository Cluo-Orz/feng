# CLI Serialized Continuation (long-running novel writing) Review

## Scope

Adds the missing piece for feng's "long-running / serialized" capability: a CLI path to **admit** a prior result as visible context so the next grow attempt continues from it.

- `feng input submit --grow <ref> --text <t> [--summary <outline>] [--admit]`.
  - Without `--admit`: the input is only *received* into the inbox (unchanged behavior, message clarified to "received into inbox").
  - With `--admit`: the input is received → normalized → classified → decided `admit_as_material`, which makes it a visible input candidate for the next `feng grow run`.
  - `--summary` sets the item's `normalizedSummary`, which is what the context compiler renders into the next prompt (the admission section surfaces the item's summary/outline, not its full body).

## Why this design

Empirically verified against the real compiler: an admitted item's summary **does** reach the compiled message list that feng sends to the model (confirmed by compiling a message list and finding the outline marker in the file-native `.feng/context/message-lists` output). The context compiler's admission section renders `explainAdmissionDecision().summary`, i.e. the outline, not the full chapter body. Outline-carried continuation is the scalable approach for long-form writing and matches the grown xiaoshuo skill's own `updated_outline` output, so it was chosen deliberately rather than trying to stuff full prior chapters into every prompt.

## Verification (live)

A 2-chapter serialized run of 《李白重生了》 via the `feng` bin against DeepSeek:
1. `feng grow run --allow` wrote chapter 1.
2. `feng input submit … --summary "第一章结尾：李白捡到手机，屏幕显示他写的《将进酒》…" --admit`.
3. `feng grow run --allow` wrote chapter 2, which opened with the phone showing 《将进酒》 ("君不见黄河之水天上来") and continued the clue throughout — direct, correct continuity from the admitted outline.

`npm run typecheck`, `npm run build`, and `npm run test:coverage` all pass (94 files / 441 tests, global branch 80.09%). `src/cli/handlers-core.ts` is 201 lines (≤ 400).

## Boundary Checks

- Continuation still flows through Admission (`admit_as_material`); the CLI never injects context directly into the compiler or writes business facts itself.
- The grow attempt's visible context is still gated by the attempt intent (`inputCandidateRefs` are auto-derived from `latestInboxRefs`), so admitting does not bypass the compiler's visibility rules.

## Residual risks / follow-ups

- Continuity is outline-level by design; exact prior-chapter prose is not re-fed. If verbatim callbacks are ever required, the full chapter artifact can be passed via `artifactCandidateRefs` (full-content path, bounded to 8KB) — not wired into the CLI yet.
- The supervisor currently authors each chapter's outline summary; a natural next step is to have feng emit the `updated_outline` as a structured candidate and auto-admit it, closing the loop without manual outline authoring.

# Evidence & Readiness Development Review

## Scope

Implemented `src/evidence-readiness` as the file-native evidence ledger, DoD evaluation, readiness assessment, and verdict layer.

Included:

- Evidence candidate recording, classification, acceptance, rejection, stale marking, listing, and summaries.
- File-native records under `.feng/evidence-readiness` for evidence, DoD evaluations, readiness assessments, readiness gaps, and readiness verdicts.
- Evidence/readiness events on the grow unit stream for candidate, classification, acceptance, stale/reject, evaluation, assessment, gap, verdict, and report registration.
- Policy and artifact lifecycle checks before evidence can be accepted for evaluation.
- Explicit handling for redacted, unavailable, retracted, missing, secret, policy-denied, and approval-required evidence.
- DoD evaluation over accepted evidence, relation hints, quality levels, missing evidence, contradictions, and blocked reasons.
- Readiness assessment that creates module-owned readiness gaps without mutating Agenda.
- Readiness verdict artifact registration for Grow Unit Manager and later Hatch Builder consumption.
- Summary/explanation APIs for evidence state, DoD evaluation, readiness state, and verdict evidence chains.

Excluded by design:

- Direct LLM calls.
- Direct tool execution.
- Direct target-world validation.
- Creating or revising DoD.
- Mutating grow lifecycle.
- Building hatch packages.
- Treating model self-claims, attempt completion, or tool success as readiness by themselves.

## Review Findings

No blocking issues found after implementation and tests.

Residual risks:

- DoD-to-evidence matching is relation-hint driven; richer semantic matching belongs in future grow/validation producers, not this module.
- Subjective content quality still needs external/manual/LLM-judge evidence schemas before novel-agent cases can be judged well.
- Readiness gaps are module-local candidates only; Agenda adoption remains a future explicit workflow.
- Independent evidence streams may be revisited if Event Ledger later adds an evidence stream type.

## Boundary Checks

- Evidence candidate does not become accepted evidence without explicit acceptance.
- Artifact registration does not imply evidence acceptance.
- `model_self_claim` and weak LLM judge evidence cannot pass DoD alone.
- Policy blocked, redacted, secret, unavailable, or stale evidence cannot support `ready_to_hatch`.
- DoD evaluation does not modify DoD or Agenda records.
- Readiness verdict does not call Grow Unit Manager or Hatch Builder.
- `ready_to_hatch` verdict is emitted as an artifact and event, then must be explicitly applied by Grow Unit Manager.

## Verification

- `npm run typecheck`
- `npx vitest run tests/evidence-readiness`
- `npm run test:coverage`
- `npm run build`
- `src/**/*.ts` and `tests/**/*.ts` line-count check: no files over 400 lines.

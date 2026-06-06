# Grow Attempt Runner Development Review

## Scope

Implemented `src/grow-attempt-runner` as the file-native attempt orchestration layer that turns a grow unit and attempt intent into bounded LLM/tool execution, recoverable checkpoints, candidate outputs, and an auditable outcome.

Included:

- Attempt creation, listing, reading, explanation, cancellation, interruption, run, and resume APIs.
- File-native records under `.feng/attempts` for attempt records, snapshots, plans, turns, candidates, checkpoints, and outcomes.
- Attempt event stream for lifecycle, snapshot, plan, compile, LLM, tool, candidate, checkpoint, retry, trace, and outcome events.
- Snapshot capture from Grow Unit Manager, Admission Feedback Inbox, Agenda DoD Manager, Tool Runtime, Context Compiler tool surface, and policy summaries.
- Execution plan creation with model selection, capability hints, tool policy, turn/tool limits, timeout policy, retry policy, streaming preference, and persisted policy decisions.
- Message-list compilation only through Context Message Compiler, with continuation artifacts after tool settlements.
- LLM calls only through LLM Gateway, with provider policy checks before every call and normalized streaming aggregation.
- Tool-call settlement only through Tool Runtime, including unresolved tool refs, validation failure, policy ask/deny, and failure-stop behavior.
- Candidate output registration for text and structured model output, plus attempt trace and outcome artifacts.
- File-native resume checkpoints after snapshot, compile, LLM response, candidate registration, tool settlement, retry, interrupt, and finalization.

Excluded by design:

- Readiness or hatch decisions.
- Direct prompt construction outside Context Message Compiler.
- Direct provider SDK calls outside LLM Gateway.
- Direct tool execution outside Tool Runtime.
- Grow lifecycle mutation beyond linking attempt summaries back to Grow Unit Manager.
- Provider session resume semantics.

## Review Findings

No blocking issues found after implementation and tests.

Residual risks:

- Real long-running cancellation depends on future host/runtime integration; current interruption is cooperative and checkpoint-based.
- Retry policy is attempt-local and conservative; it does not yet replan agenda or compress context after repeated failure.
- Candidate classification is heuristic over normalized model blocks; richer hatch-specific candidate schemas should later narrow ambiguity.
- Streaming aggregation stores normalized output and receipts, but provider-specific partial stream recovery remains delegated to LLM Gateway adapters.

## Boundary Checks

- `runAttempt` does not fabricate message lists; every turn is compiled by Context Message Compiler.
- LLM provider access is evaluated through Policy Boundary before LLM Gateway receives the request.
- Model tool calls are requests only; Tool Runtime decides availability, validation, policy, execution, and settlement.
- Tool settlements become continuation artifacts instead of hidden in-memory state.
- Attempt finalization produces trace and outcome artifacts before linking the summary back to Grow Unit Manager.
- `resumeAttempt` resumes from file-native attempt state and checkpoints, not provider sessions.
- Terminal attempts with no persisted outcome fail explicitly instead of silently re-running.

## Verification

- `npm run typecheck`
- `npx vitest run tests/grow-attempt-runner`
- `npm run test:coverage`
- `npm run build`
- `src/**/*.ts` and `tests/**/*.ts` line-count check: no files over 400 lines.

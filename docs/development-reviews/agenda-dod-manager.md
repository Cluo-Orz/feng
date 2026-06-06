# Agenda & DoD Manager Development Review

## Scope

Implemented `Agenda & DoD Manager` as the ninth module in the file-native grow kernel.

The module now provides:

- Durable Agenda, AgendaItem, Gap, DoD, and AttemptIntent records under `.feng/agenda`.
- Event-backed agenda projection recovery from the grow unit stream.
- Agenda item proposal, activation, update, blocked, and retirement flows.
- Gap recording, update, resolution-for-now, duplicate detection, pagination, and retry-limit blocking.
- DoD definition, revision with history preservation, retirement, active listing, and evaluation-ref linking.
- AttemptIntent generation from active agenda items, open gaps, DoD, admission summary, and active skill summaries.
- Agenda summary and explanation APIs.

## Top-Level Review

Reread:

- `docs/detailed-design/modules/agenda-dod-manager/spec.md`
- `docs/detailed-design/top-level-module-design.md`
- Prior dependency review for `Admission & Feedback Inbox`
- Current `src/agenda-dod-manager` implementation and tests

Result:

- The module preserves the boundary that agenda is not execution. It does not call LLMs, execute tools, compile message lists, or mutate grow lifecycle.
- `AttemptIntent` is a file-native intent record, not an attempt and not a message list.
- `DoDItem` stores what must be proven and links evaluation refs, but it never records readiness or satisfaction verdicts.
- `GapRecord` reaches `blocked` at retry limit and `buildAttemptIntent` refuses to continue when an open gap exhausted retries.
- Inputs from Admission are surfaced as refs in AttemptIntent; they do not automatically become active agenda.
- Active skill visibility uses Skill Registry summaries only and does not load skill bodies.

## Local Review

Key implementation decisions:

- Used the existing `grow_unit` event stream for agenda events because the ledger has no dedicated agenda stream type yet.
- Kept current-state records in files and made `AgendaRecord` recoverable from events.
- Split the implementation into small flow files to keep business files under 400 lines.
- Made DoD revision create a replacement DoD and mark the old DoD `superseded`, preserving history rather than overwriting definitions.
- Kept `resolved_for_now` and `completed_for_now` as local progress states only; neither affects readiness.
- Aligned agenda event strings with the spec names such as `agenda_item_activated`, `gap_recorded`, `dod_defined`, and `attempt_intent_created`.

Intentional spec interpretation:

- The spec says Agenda can propose agenda changes from admission and feedback summaries. This implementation exposes that through explicit mutation ports plus `AttemptIntent.inputCandidateRefs`; it does not add a hidden heuristic auto-planner that turns feedback into active agenda. That is consistent with the product rule that feedback candidates must not silently mutate grow state.

## Verification

Commands run:

- `npm run typecheck`
- `npm run test:coverage`
- `npm run build`
- TS line-count check for `src` and `tests`

Final coverage:

- 110 tests passed.
- Statements: 89.17%
- Branches: 80.02%
- Functions: 98.70%
- Lines: 97.80%

Line-count result:

- No `src` or `tests` TypeScript file exceeds 400 lines.

## Residual Risk

- Branch coverage remains just over the global threshold; later modules may require additional tests or cleanup to keep the threshold stable.
- `AgendaRecord` is recoverable from events, but individual item/gap/DoD/intent records currently rely on their JSON files. This matches the implemented projection boundary, but future event replay may want richer per-record recovery.
- Agenda does not yet link an `AgendaStateSummary` artifact back into Grow Unit Manager. It returns summary through its own port; later Context Compiler or CLI integration can decide what summary artifact should be linked.
- Automatic agenda candidate generation from raw admission signals is deliberately not hidden inside this module. Later LLM-driven grow attempts can propose mutations explicitly through this port.

## Conclusion

The implementation satisfies the module's role as the owner of agenda, gaps, DoD, and next-attempt intent. It keeps the grow loop file-native and inspectable while preserving the core boundaries: no message compilation, no execution, no readiness judgment, and no silent lifecycle mutation.

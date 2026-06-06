# Grow Unit Manager Development Review

## Scope

Implemented `Grow Unit Manager` as feng's grow unit lifecycle, projection, and coordination module.

Files:

```text
src/grow-unit-manager/*
tests/grow-unit-manager/*
src/domain/result.ts
src/index.ts
```

Reread before implementation:

```text
docs/detailed-design/modules/grow-unit-manager/spec.md
docs/detailed-design/modules/grow-unit-manager/rounds/round-01.md
docs/detailed-design/modules/grow-unit-manager/rounds/round-02.md
docs/detailed-design/modules/grow-unit-manager/rounds/round-03.md
docs/detailed-design/top-level-module-design.md
docs/development-reviews/domain-model-contracts.md
docs/development-reviews/file-native-store.md
docs/development-reviews/event-ledger-projection.md
docs/development-reviews/artifact-registry.md
docs/development-reviews/policy-capability-boundary.md
docs/development-reviews/skill-registry.md
```

Reference code reviewed:

```text
opencode/packages/core/src/session/projector.ts
opencode/packages/core/src/session/store.ts
opencode/packages/core/src/session/info.ts
opencode/packages/core/src/session/context-epoch.ts
opencode/packages/core/src/session/event.ts
opencode/packages/core/src/session/run-coordinator.ts
hermes-agent/agent/transports/codex_event_projector.py
hermes-agent/website/docs/developer-guide/session-storage.md
hermes-agent/tests/gateway/test_session_race_guard.py
learn-claude-code/docs/zh/s07-task-system.md
learn-claude-code/docs/zh/s08-background-tasks.md
learn-claude-code/docs/zh/s12-worktree-task-isolation.md
```

## Implementation

The module now provides:

```text
GrowUnitRecord and typed lifecycle/phase contracts.
Grow unit create, open, get, list, snapshot, and explanation ports.
Stream-backed projection rebuild from grow_unit events.
File-native projection index and record storage.
Lifecycle transition table with explicit transition_conflict errors.
Block, unblock, archive, and archived/blocked mutation guards.
Policy-gated archive using file.delete decision semantics.
Goal boundary update and target world summary linking.
Admission, Agenda, Attempt, MessageList, Readiness, and Hatch coordination links.
Readiness verdict application with artifact existence checks.
ready_to_hatch guarded by readiness verdict evidence.
Hatch package linking only after ready_to_hatch.
Per-grow-unit in-process mutation lane and expectedRecordVersion stale checks.
Active skill scope summaries for snapshots without loading skill bodies.
Superseding event support for correction workflows.
```

## Design Fit

The implementation keeps `Grow Unit Manager` out of the session trap:

```text
It does not export a Session type.
It does not persist chat history.
It does not compile prompt or message content.
It does not call an LLM.
It does not execute tools.
It does not decide readiness from model confidence.
It does not build hatch packages.
```

Important invariants are preserved:

```text
GrowUnitRecord is a projection, not the source of truth.
grow_unit stream events can rebuild the current record.
All state changes append events before writing projection snapshots.
Attempts are refs under a grow unit, not sessions.
Message lists are refs supplied by Context & Message Compiler.
ready_to_hatch requires a readiness verdict artifact.
archived grow units reject subsequent mutation.
blocked grow units reject attempt linking until unblocked.
Skill Registry is consulted only for summaries, never skill body content.
```

## Completeness Check

Implemented without feature stubs:

```text
createGrowUnit
openGrowUnit
getGrowUnit
transitionGrowUnit
archiveGrowUnit
blockGrowUnit
unblockGrowUnit
updateGoalBoundary
linkTargetWorld
linkAdmissionState
linkAgendaState
linkAttempt
linkMessageList
applyReadinessVerdict
linkHatchPackage
supersedeGrowUnit
buildGrowUnitSnapshot
explainGrowUnitState
listGrowUnits
```

Covered risk cases:

```text
Direct created -> growing transition is rejected.
Direct ready_to_hatch transition without readiness evidence is rejected.
Direct hatched transition without package ref is rejected.
Hatch package linking before ready_to_hatch is rejected.
Message list link requires context-message-compiler producer marker.
Missing readiness verdict artifact returns artifact_unavailable.
Stale expectedRecordVersion returns projection_stale.
Archive without allow policy returns approval_required.
Archive with deny policy returns policy_blocked.
Blocked grow unit cannot start an attempt.
Archived grow unit cannot mutate.
Projection record can be deleted and recovered from stream.
Snapshots summarize active skills without materializing skill bodies.
```

## Reference Judgment

Useful ideas borrowed:

```text
opencode: stream projection, context epoch replacement, and per-key run coordination.
Hermes: race guards and durable projection from runtime events.
learn-claude-code: file-persisted long-task skeleton and explicit task/world separation.
```

Ideas intentionally not copied:

```text
User-visible sessions.
Session lineage.
Full message history as state.
Provider session resume semantics.
SQLite session storage.
Background execution inside the manager.
```

## Verification

Commands run:

```text
npm run typecheck
npm run test:coverage
npm run build
```

Results:

```text
Typecheck: passed
Tests: 80 passed
Coverage: statements 89.06%, branches 80.17%, functions 98.15%, lines 96.74%
Build: passed
Line-count check: no src/tests TypeScript file over 400 lines
```

## Review Notes

The module is viable as a complete first implementation of the grow unit center. The most important downstream obligation is that `Admission & Feedback Inbox`, `Agenda & DoD Manager`, `Context & Message Compiler`, `Grow Attempt Runner`, `Evidence & Readiness`, and `Hatch Builder` must keep owning their own judgments. If later modules start using Grow Unit Manager as a prompt compiler, feedback acceptor, or readiness judge, the product will drift back toward a session-shaped agent framework.

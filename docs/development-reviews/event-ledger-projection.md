# Event Ledger & Projection Implementation Review

## Reviewed Inputs

Reviewed:

```text
docs/detailed-design/top-level-module-design.md
docs/detailed-design/modules/event-ledger-projection/spec.md
docs/detailed-design/modules/event-ledger-projection/rounds/round-01.md
docs/detailed-design/modules/event-ledger-projection/rounds/round-02.md
docs/detailed-design/modules/event-ledger-projection/rounds/round-03.md
docs/detailed-design/modules/domain-model-contracts/spec.md
docs/detailed-design/modules/file-native-store/spec.md
docs/development-reviews/file-native-store.md
src/domain/*
src/file-store/*
src/event-ledger/*
tests/event-ledger/*
```

## Top-Level Judgment

The implementation keeps `Event Ledger & Projection` in the foundation layer. It records what happened and builds replayable projections, but it does not decide whether a grow unit should progress, whether feedback is accepted, whether readiness is satisfied, or whether hatch can run.

The module uses File-Native Store for contained file operations. File Store receipts remain storage receipts; Ledger returns its own append/read/projection receipts and owns sequence, idempotency, replay, and projection semantics.

## Implemented Terminal Facts

Implemented:

```text
Typed event envelope.
Supported stream type set.
Stream-local append-only JSONL storage.
Stream-local monotonically increasing sequence.
appendEvent and appendBatch.
eventId reuse detection.
idempotency key reuse and conflict detection.
batch-local idempotency deduplication.
payload fingerprinting with stable JSON.
inline payload size guard.
event version compatibility check.
readStream with pagination and truncation.
replayStream.
projection definitions with reducer callback.
buildProjection and rebuildProjection.
projection snapshot persistence.
readProjection with version compatibility check.
projection checkpoint stale check.
invalidateProjection.
schema-incompatible stream/projection detection.
```

## Local Implementation Judgment

The implementation is split by concern:

```text
types.ts: public event, stream, receipt, projection contracts.
brand.ts: branded factories.
stable-json.ts: stable payload fingerprints and event id generation.
paths.ts: Ledger-owned internal logical paths.
locks.ts: stream-level in-process append lock.
node-ledger.ts: EventLedger implementation.
```

No implementation or test file exceeds 400 lines. The largest Event Ledger implementation file is `node-ledger.ts` at 381 lines.

## Design Checks

The implementation preserves these invariants:

```text
Events are append-only.
Old events are not modified for correction.
Stream sequence is strict and local to the stream.
Idempotent retry returns existing event instead of duplicating.
Idempotency conflicts are explicit.
Projection is written as a rebuildable snapshot, not as truth source.
Projection checkpoint points back to event streams.
Unknown event version fails explicitly.
Large payloads are rejected instead of silently stored inline.
Event payload schema remains owned by business modules.
```

## Honest Limits

These limits are explicit:

```text
The first implementation uses JSONL stream files.
There is no workspace-global transaction sequence.
There is an in-process stream lock, but no cross-process file lock.
Projection reducers are supplied by callers; Ledger does not register business reducers.
Projection stale validation checks checkpoint reachability, not semantic correctness of reducer output.
Artifact availability is represented in the type/error surface, but Artifact Registry is not implemented yet.
```

These are consistent with the module spec's open questions and do not turn Ledger into a business state machine.

## Validation

Passed:

```text
npm run typecheck
npm run test:coverage
npm run build
business/test file line-count check: no file over 400 lines
```

Coverage result:

```text
Statements: 89.18%
Branches: 80.47%
Functions: 97.95%
Lines: 94.67%
```

## Conclusion

`Event Ledger & Projection` is ready as the third foundation module. It gives downstream modules a durable, replayable event fact source and rebuildable projection mechanism without absorbing their business decisions.

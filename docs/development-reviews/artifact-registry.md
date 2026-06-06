# Artifact Registry Implementation Review

## Reviewed Inputs

Reviewed:

```text
docs/detailed-design/top-level-module-design.md
docs/detailed-design/modules/artifact-registry/spec.md
docs/detailed-design/modules/artifact-registry/rounds/round-01.md
docs/detailed-design/modules/artifact-registry/rounds/round-02.md
docs/detailed-design/modules/artifact-registry/rounds/round-03.md
docs/detailed-design/modules/domain-model-contracts/spec.md
docs/detailed-design/modules/file-native-store/spec.md
docs/detailed-design/modules/event-ledger-projection/spec.md
docs/development-reviews/event-ledger-projection.md
src/artifact-registry/*
tests/artifact-registry/*
```

## Top-Level Judgment

The implementation keeps `Artifact Registry` as an artifact identity, metadata, preview, materialization, privacy, retention, and lifecycle layer. It does not compile message lists, decide readiness, choose hatch contents, execute tools, or interpret feedback.

It depends on File-Native Store for safe content/record writes and Event Ledger for artifact lifecycle events. It does not make either lower module understand artifact semantics.

## Implemented Terminal Facts

Implemented:

```text
Artifact kind and lifecycle sets.
Artifact record with ArtifactRef, content location, hash, size, privacy, retention, source, version, audit, parents, previewRef.
Managed content registration.
Derived artifact registration requiring parentRefs.
External handle registration with trusted flag and optional hash/size.
Producer ownership checks for compiled_message_list, runtime_message_list, tool_result, and hatch_package.
ArtifactRef resolution.
Full materialization with lifecycle guard and hash verification.
Line-range materialization for managed UTF-8 content.
Preview generation and update as derived preview artifacts.
Preview read guarded by original artifact lifecycle.
Archive, redact, unavailable, retract, and delete-content lifecycle transitions.
Lifecycle events written through Event Ledger.
Deleted content keeps artifact record for audit.
```

## Local Implementation Judgment

The implementation is split by concern:

```text
types.ts: artifact contracts, records, materialization, lifecycle receipts.
policy.ts: producer-to-kind creation policy.
paths.ts: Artifact-owned logical paths.
errors.ts: artifact module error construction.
node-registry.ts: ArtifactRegistry implementation.
```

No implementation or test file exceeds 400 lines. The largest Artifact Registry implementation file is `node-registry.ts` at 389 lines.

## Design Checks

The implementation preserves these invariants:

```text
ArtifactRef is not a file path.
Registering an artifact is not business adoption.
Preview is a derived artifact, not a message list.
Artifact lifecycle is separate from grow/hatch lifecycle.
Large content is stored through File Store and referenced by ArtifactRef.
Redacted/unavailable/retracted/deleted artifacts do not silently return original content.
Content hash mismatch fails explicitly.
Special artifact kinds require their owning producer module.
```

## Honest Limits

These limits are explicit:

```text
Content layout is an Artifact-owned internal `.feng/artifacts` layout.
Preview generation is intentionally simple truncation/binary placeholder until Context Compiler defines budget needs.
Policy authorization is not implemented here; privacy metadata is exposed for the future Policy module.
External handles are represented, not fetched or trusted by default.
Lifecycle events are emitted, but no higher-level business module consumes them yet.
```

These limits do not reduce the module's role: it is a complete artifact registry layer for downstream modules to use.

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
Statements: 89.20%
Branches: 80.09%
Functions: 98.86%
Lines: 95.67%
```

## Conclusion

`Artifact Registry` is ready as the fourth foundation module. It gives later modules a real ArtifactRef, metadata, preview, lifecycle, and materialization layer without turning into Context Compiler, Hatch Builder, Tool Runtime, or Policy.

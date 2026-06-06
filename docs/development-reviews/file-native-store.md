# File-Native Store Implementation Review

## Reviewed Inputs

Reviewed:

```text
docs/detailed-design/top-level-module-design.md
docs/detailed-design/modules/file-native-store/spec.md
docs/detailed-design/modules/domain-model-contracts/spec.md
src/domain/*
src/file-store/*
tests/file-store/*
opencode filesystem/path handling references reviewed before implementation
```

## Top-Level Judgment

The implementation preserves the top-level boundary: `File-Native Store` is a foundation module for workspace-bound file facts. It does not know grow, hatch, feedback, artifact lifecycle, message compilation, readiness, policy, or target-world semantics.

The module is not an agent framework feature and is not copied from opencode. The reference projects influenced the safety concerns only: canonical path checks, symlink escape handling, read guards, receipts, and mutation race windows.

## Implemented Terminal Facts

Implemented:

```text
Workspace open and describe.
Workspace-relative logical path normalization.
Absolute path rejection by default.
Path traversal rejection.
Workspace containment checks.
Default symlink escape rejection.
Text and binary reads.
Line-range text reads with scan byte guard.
File stat and directory entry metadata.
Non-recursive directory listing by default.
Recursive listing requiring maxDepth and maxEntries.
SHA-256 content hashes.
Read, write, append, delete, list, directory, move, cleanup receipts.
Atomic write through same-directory temp file and rename.
Append primitive with single record boundary.
Explicit parent creation option.
Remove and move within workspace.
Cleanup of recognized `.feng-tmp-*` files.
Node implementation behind a `FileNativeStore` interface.
```

## Local Implementation Judgment

The implementation is intentionally split by port:

```text
types.ts: public contract types.
path.ts: workspace and path containment.
read.ts: text/binary/range reads.
list.ts: bounded directory listing.
mutation.ts: atomic writes, append, move, remove, cleanup.
metadata.ts: stat, entries, receipts.
node-store.ts: facade implementing FileNativeStore.
```

No business code file exceeds 400 lines. The largest implementation file is `types.ts` at 277 lines; the largest test file is 325 lines.

## Design Checks

The implementation preserves these invariants:

```text
All operations require WorkspaceHandle.
Business callers pass logical path strings.
Absolute path is not accepted unless explicitly allowed for controlled resolution.
Resolved absolute path remains internal typed data.
Result/DomainError is used for business failures.
receipt is not an Event Ledger event.
append does not define event schema.
File Store does not decide policy.
File Store does not define `.feng` layout.
File Store does not expose user-facing session.
```

## Honest Limits

These limits are not hidden:

```text
Atomic writes use write temp + rename, but do not fsync file or parent directory.
Path safety is structural containment, not an OS sandbox.
There is an in-process path lock for cooperating calls, but no cross-process file lock.
Line-range reads are line based with a scan byte guard, not random-access line indexing.
Symlink tests depend on platform support; implementation still rejects symlink escape by default.
```

These limits match the module spec's open questions and do not change the terminal role of File-Native Store.

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
Statements: 87.28%
Branches: 80.00%
Functions: 98.00%
Lines: 92.96%
```

## Conclusion

`File-Native Store` is ready as the second foundation module. It is complete enough for downstream modules to build on directly: Event Ledger can use append receipts, Artifact Registry can store content through this layer, Context Compiler can perform guarded reads, and Hatch Builder can rely on workspace-contained file operations.

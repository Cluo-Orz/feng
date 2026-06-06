# Policy & Capability Boundary Development Review

## Scope

Implemented `Policy & Capability Boundary` as feng's action-decision layer.

Files:

```text
src/policy-boundary/*
tests/policy-boundary/*
src/domain/result.ts
src/index.ts
```

Reread before implementation:

```text
docs/detailed-design/modules/policy-capability-boundary/spec.md
docs/detailed-design/modules/policy-capability-boundary/rounds/round-01.md
docs/detailed-design/modules/policy-capability-boundary/rounds/round-02.md
docs/detailed-design/modules/policy-capability-boundary/rounds/round-03.md
docs/detailed-design/top-level-module-design.md
docs/development-reviews/file-native-store.md
docs/development-reviews/event-ledger-projection.md
docs/development-reviews/artifact-registry.md
```

Reference code reviewed:

```text
opencode/packages/core/src/permission.ts
opencode/packages/core/src/permission/schema.ts
opencode/packages/core/src/permission/saved.ts
opencode/packages/core/src/policy.ts
opencode/packages/core/src/tool/registry.ts
hermes-agent/apps/shared/src/json-rpc-gateway.ts
```

## Implementation

The module now provides:

```text
Capability/action request/domain types
Policy decision evaluation
Rule matching and default verdicts
Honest boundary declarations
Approval receipts
Scoped capability grants
Grant revocation and replay
Artifact read/export/upstream/publish privacy checks
Policy event payload normalization for Event Ledger
Policy decision explanation through policy stream replay
```

The implementation intentionally stays a decision layer. It does not execute tools, perform OS sandboxing, materialize artifact content, publish hatch packages, route feedback admission, or implement approval UI.

## Design Fit

Top-level fit is acceptable:

```text
Policy allow is not action execution.
Policy deny/unsupported are explicit results.
Command execution without host sandbox is unsupported, not silently downgraded.
File actions still rely on File Store containment and symlink/path guards.
Artifact privacy decisions use Artifact Registry metadata, not full content.
Grant scope is tightened to the approved request and does not default across workspace/grow/runtime/target world.
Revocation is append-only and historical decisions are not rewritten.
```

This directly supports the concept requirement that feng's running facts remain file-native and inspectable: decisions, approvals, grants, and revocations are policy stream events, and event payloads are normalized to ledger-safe JSON summaries.

## Completeness Check

Implemented without feature stubs:

```text
evaluateAction
explainDecision
recordApproval
createGrant
revokeGrant
listActiveGrants
describeBoundary
requireBoundary
evaluateArtifactAccess
evaluateFeedbackUpstream
evaluateHatchPublish
```

Covered risk cases:

```text
Unknown capability -> unsupported
Missing host sandbox for command.run -> unsupported
Missing required boundary -> DomainError
Scoped grant allows matching caller/request only
Revoked grant no longer affects new decisions
contains_secret artifact cannot cross boundary
contains_user_content/project_private requires redaction or approval
redacted/unavailable artifact read is not silently allowed
Policy allow does not bypass File Store path containment
Policy decision can be replayed/explained from Event Ledger
```

Reserved but not exposed as a public port:

```text
policy_decision_superseded
policy_boundary_declared
```

The current spec does not define public methods for those events. The event names are present so later consumers can add correction/boundary-declaration workflows without changing the stream vocabulary.

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
Tests: 54 passed
Coverage: statements 88.96%, branches 80.86%, functions 97.61%, lines 95.73%
Build: passed
Line-count check: no src/tests TypeScript file over 400 lines
```

## Review Notes

The module is viable as a complete first implementation of the policy boundary concept. The important product risk remains outside this module: real enforcement still depends on downstream modules honoring `PolicyDecision` and on host/tool/runtime adapters providing the boundaries they claim. This is correct for the architecture, but later Tool Runtime, Hatch Builder, Feedback Bridge, and Target World Adapter implementations must treat policy decisions as mandatory references, not optional advice.

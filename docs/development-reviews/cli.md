# CLI Development Review

## Scope

Implemented `src/cli` as feng's local user entrypoint and port-orchestration layer. The CLI parses argv into a `CLICommandIntent`, locates the workspace into a `CLIExecutionContext`, dispatches to the owning module port by command family, renders a privacy/policy-safe `CLIOutputEnvelope`, persists a `CLIInvocationReceipt` plus a CLI audit event under `.feng/cli`, and maps `DomainError` codes to a stable `CLIExitStatus`/exit code.

Included:

- Argv parser (`parse.ts`) producing `CLICommandIntent` with `requestedMode`, `approvalMode`, `displayMode`, family, action, positionals, flags, and resolved workspace root (shortcuts: `--json`, `--quiet`, `--verbose`, `--source-refs`, `--dry-run`, `--debug`, `--mode`, `--approval`, `--workspace`/`--root`).
- Workspace-locating context builder (`context.ts`) — opens the file-native workspace; the context is explicitly **not** a session.
- Fourteen command families (`workspace`, `grow`, `input`, `status`, `explain`, `attempt`, `readiness`, `hatch`, `runtime`, `debug`, `feedback`, `policy`, `artifact`, `skill`) split across `handlers-core.ts` and `handlers-runtime.ts`, each calling a representative real module port (read/list/explain, plus grow creation and user-input admission).
- Privacy/policy-safe renderer (`render.ts`): for `blocked_by_policy`/`blocked_by_privacy` outcomes it strips `data`, `refs`, and `facts`, so even `--json`/machine-readable output never leaks blocked content.
- Receipt persistence + CLI audit event (`storage.ts`, `dispatch.ts`) under `.feng/cli/invocations`, with an invocation index for `listInvocations`.
- `DomainError` → `CLIExitStatus` → exit-code mapping (`exit.ts`).

Excluded by design (delegated to the owning modules):

- The CLI owns no business state and never writes `.feng` business facts directly — it only writes its own invocation receipts.
- User input is always routed through Admission (`receiveUserInput`); the CLI never creates `FeedbackUnit`/`UpstreamProposal`, grow message lists, runtime message lists, readiness verdicts, or hatch packages itself.
- No policy bypass: cross-layer/privileged effects stay inside Policy Boundary and the owning modules.

## Review Findings

No blocking issues after implementation and tests.

Notes from verification:

- The CLI intentionally exposes **representative** operations per family (read/list/explain plus `grow create` and `input submit`) rather than a full command manual. Round-02 of the spec warns against the CLI swallowing business modules or becoming a command-manual; handlers therefore stay thin and delegate.
- `run()` is total for normal flows: parse errors, workspace-open failures, and handler `DomainError`s are converted into an envelope (with a non-zero exit code) instead of throwing. Only infrastructure failures while persisting the receipt (e.g. a corrupted invocation index) return an `Err`, because in a file-native agent an invocation that cannot be durably recorded has not really happened.
- Added file-native fault-injection coverage: corrupting `.feng/cli/invocations/index.json` makes both persistence and `listInvocations` fail with `schema_incompatible`, exercising the storage error-propagation branches.

Residual risks:

- `requestedMode`/`approvalMode` are parsed, recorded on the receipt, and available to handlers, but the current representative handlers do not yet branch on `dry_run`/`replay`/approval prompting. The plumbing is in place; per-command dry-run and interactive approval are follow-up work.
- The CLI audit event is written on the workspace stream (`cli-<workspace>`) since the ledger has no dedicated `cli` stream type; this keeps the change additive and avoids touching the event-ledger contract.

## Boundary Checks

- The CLI does not own business state; it only persists `CLIInvocationReceipt` records and a CLI audit event.
- User input flows through Admission (`receiveUserInput`), never directly into `.feng` business state.
- `FeedbackUnit`/`UpstreamProposal` creation goes through Admission/the Debug & Feedback Bridge (`feedback submit-candidate` calls the bridge, which routes through Admission); the CLI never creates them directly.
- `ready_to_hatch` is only read from Evidence & Readiness, `hatch_package` only from Hatch Builder, runtime explanations only from the Agent Runtime Kernel.
- Machine-readable/`--json` output is produced from the same privacy-stripped envelope; blocked-by-policy/privacy outcomes carry only a reason, never raw refs or data.
- The execution context is workspace-scoped and is not a user session.

## Design Judgments

- Spec-level CLI error names (`workspace_not_found`, `grow_unit_not_found`, `invalid_command`, etc.) are mapped onto the fixed domain error enum rather than introducing new codes; the CLI's value is the `DomainErrorCode` → `CLIExitStatus` mapping table in `exit.ts`, which gives stable, scriptable exit codes.
- Handler files are grouped (`handlers-core` / `handlers-runtime`) to keep every file well under the 400-line limit while preserving one dispatch entry per family.
- The CLI fixture builds on the existing all-module fixture chain and additionally wires a `GrowAttemptRunner` (context compiler + LLM gateway + tool runtime) so that every port the CLI orchestrates is a real implementation, not a stub.
- No neighboring-module source changes were required; the CLI is purely additive and depends only on already-published module ports.

# Agent Runtime Kernel Development Review

## Scope

Implemented `src/agent-runtime-kernel` as the file-native runtime kernel for hatch-produced agent packages.

Included:

- Runtime invocation records, short-term context records, long-term memory read records, turns, message lists, runtime outputs, traces, and feedback candidate hints under `.feng/agent-runtime-kernel`.
- Startup validation for hatch package lifecycle, runtime contract lifecycle, supported agent kernel type, target-world compatibility, long-term memory material, and production package publication.
- Runtime message list compilation owned by Agent Runtime Kernel, not Context Message Compiler.
- Provider-neutral message lists with source map, budget report, and exclusion list artifacts.
- LLM Gateway integration for normal, dry-run, and replay modes.
- Tool Runtime integration for model-requested tool calls while keeping tool validation, policy, execution, and settlement owned by Tool Runtime.
- Target World Adapter integration for world input reads, runtime output normalization, target output validation, target action preparation, and optional dispatch.
- Runtime trace records and artifacts with policy-gated reads.
- Debug feedback candidate hints as local hints only.
- Production version lock checks for hatch package resources and kernel version.

Excluded by design:

- Creating readiness verdicts or hatch readiness from runtime traces.
- Accepting feedback or pushing upstream absorption automatically.
- Treating target world input as a raw prompt transcript.
- Mutating hatch packages, runtime contracts, grow units, or DoD state during runtime execution.
- Treating every hatched result as an LLM loop.
- Letting target actions bypass Target World Adapter or Policy Boundary.
- Calling Context Message Compiler for runtime turn message construction.

## Review Findings

No blocking issues found after implementation and tests.

Issues found and fixed during verification:

- Runtime trace artifact content incorrectly used message list refs as turn refs. Trace content and trace record now both use actual turn refs.
- Runtime message sections did not link back to source map entries. Section `sourceMapEntryIds` now match deterministic source map entry IDs.
- Tool Runtime queued-concurrency waiting could cross from queue timeout into execution timeout under scheduler pressure. The wait loop now respects the queue deadline, and the test now uses an explicit release gate instead of timing assumptions.
- Global branch coverage was below threshold after adding this module. Added focused boundary tests for Agent Runtime Kernel plus storage/file metadata edge tests that exercise real file-native failure modes.

Residual risks:

- Runtime message budgeting is still a rough character-token estimate, not provider tokenizer accounting.
- Production lock verifies package artifact hashes and kernel version, but not semantic compatibility of external host code.
- Replay mode trusts caller-supplied normalized LLM responses; this is intentional for deterministic debugging but should remain debug/replay scoped.
- Feedback candidate hints are deliberately weak signals. Admission and upstream absorption remain separate modules.
- Runtime output schema checks depend on the current Target World Adapter structural contract. Rich target-specific validators will need adapter plugins later.

## Boundary Checks

- `WorldInputEnvelope` is read as file-native input material and summarized into runtime messages; it is not itself the message list.
- Runtime message compilation writes its own `runtime_message_list`, source map, budget report, and exclusion list artifacts.
- LLM policy is checked through `external_service.call` before provider calls.
- Tool calls require a policy context and settle through Tool Runtime; Agent Runtime Kernel does not execute tools directly.
- Runtime output is a candidate until Target World Adapter normalizes and validates it.
- Target action dispatch is optional and goes through Target World Adapter.
- Runtime traces require policy context unless public.
- Feedback hints stay local to runtime and do not mutate Admission Feedback Inbox.
- Production invocations require a local published package and a stable production lock.
- Failed, retracted, superseded, deprecated, or incompatible upstream records are rejected before runtime use.

## Verification

- `npm run typecheck`
- `npx vitest run tests/agent-runtime-kernel`
- `npx vitest run tests/tool-runtime/execution.test.ts`
- `npx vitest run tests/evidence-readiness/edge.test.ts`
- `npx vitest run tests/file-store`
- `npx vitest run tests/context-message-compiler`
- `npm run test:coverage`
- `npm run build`
- `src/**/*.ts` and `tests/**/*.ts` line-count check: no files over 400 lines.

Coverage result after fixes: `76` test files passed, `333` tests passed, global branch coverage `80%`.

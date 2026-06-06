# Tool Runtime Development Review

## Scope

Implemented `src/tool-runtime` as the file-native tool definition, validation, policy, execution, artifact, receipt, and settlement boundary below future grow/runtime orchestration.

Included:

- Tool definition registration, catalog listing, lifecycle transitions, and manifest discovery.
- Tool surface summaries that expose candidate tools without exposing implementation details.
- Input materialization from inline JSON or `ArtifactRef`, schema validation, workspace path guards, unsafe command guards, and credential checks.
- Policy evaluation for declared/requested capabilities before execution.
- Host function implementation adapters with timeout, cancellation, concurrency limits, and optional queueing.
- `tool_result` artifacts, execution receipt artifacts, settlement artifacts, and `.feng/tools/...` records.
- Tool Runtime event stream for discovery, registration, validation, policy, execution, result registration, and settlement.

Excluded by design:

- Prompt/message-list compilation or tool visibility selection inside a message list.
- LLM calls or provider tool-call parsing.
- Skill execution or skill-driven tool registration.
- Grow lifecycle, readiness, hatch, agenda, or feedback mutation.
- Strong OS sandboxing or secret storage.

## Review Findings

No blocking issues found after implementation and tests.

Residual risks:

- Real host implementations are injected adapters; no shell/process tool is bundled yet.
- Command safety is structural only. `command.run` still depends on Policy Boundary and a real host sandbox outside this module.
- Redaction is conservative and generic: when policy returns `allow_with_redaction`, archived output strings are replaced rather than semantically filtered.
- In-process cancellation can signal running implementations, but cooperative implementations must honor `AbortSignal` for fast shutdown.

## Boundary Checks

- Registered tools are not automatically visible.
- Surface-visible tools are not automatically executable.
- Validation success does not imply policy allow.
- Policy allow does not imply tool success.
- Tool-call requests do not mutate grow state or readiness.
- Tool results are artifacts, not message lists.
- Skill-declared tool refs are not treated as registered tools.

## Verification

- `npm run typecheck`
- `npx vitest run tests/tool-runtime`
- `npm run test:coverage`
- `npm run build`
- `src/**/*.ts` and `tests/**/*.ts` line-count check: no files over 400 lines.

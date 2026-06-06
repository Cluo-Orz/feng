# LLM Gateway Development Review

## Scope

Implemented `src/llm-gateway` as the provider boundary below Context Message Compiler and above future grow attempt/runtime orchestration.

Included:

- Provider/model capability summary and capability checks.
- Provider-neutral message resolution from direct messages or `MessageListRef`.
- Provider request summary building with adapter override and default fallback payload.
- Policy decision verification for `network.request` / `external_service.call`.
- Non-streaming provider call flow with retry/fallback and receipt artifacts.
- Streaming provider call flow with normalized stream events and completion/failure receipts.
- Generic OpenAI-style response/stream/error normalization, with adapter override hooks.
- LLM-specific domain error codes and `llm-gateway` artifact producer ownership.

Excluded by design:

- Prompt compilation or message list mutation.
- Tool execution or tool permission settlement.
- Grow lifecycle mutation.
- Readiness/hatch judgment.
- Credential storage.

## Review Findings

No blocking issues found after implementation and tests.

Residual risks:

- Real provider SDK adapters are not implemented here; the gateway is adapter-ready and tested with deterministic adapters.
- Stream retry/fallback is intentionally conservative: after a stream starts yielding normalized output, interruption returns an explicit failure event rather than replaying partial output.
- Provider-specific advanced formats will need adapters to preserve richer metadata beyond the generic OpenAI-compatible normalizer.

## Boundary Checks

- Policy deny/ask/wrong-capability decisions do not call provider adapters.
- `MessageListRef` is materialized from Context Compiler artifacts; Gateway does not invoke compile logic.
- Tool calls are normalized as model output blocks only.
- Provider responses and receipts are not interpreted as readiness evidence.
- `context_length_exceeded` is classified but no context is silently removed.

## Verification

- `npm run typecheck`
- `npx vitest run tests/llm-gateway`
- `npm run test:coverage`
- `npm run build`
- `src/**/*.ts` and `tests/**/*.ts` line-count check: no files over 400 lines.


# Runtime Host & Provider Adapter Development Review

## Scope

This change makes feng **actually runnable** for the first time. Before it, feng was a complete, well-tested library of 20 module ports whose only LLM adapter was the in-test fake — there was no executable entry, no real model adapter, and no composition root. The concept end-state (a file-native agent that can run, perceive, grow, and hatch real things) was therefore not reachable, regardless of how green the unit tests were.

Added (infrastructure, not new design modules):

- `src/providers/openai-compatible.ts` — a real `LLMProviderAdapter` for OpenAI-protocol providers (used here with DeepSeek). It flattens provider-neutral messages into an OpenAI chat-completions payload, POSTs via an **injectable** `fetchImpl` (so it is unit-testable without network), and returns the raw JSON for the gateway's generic normalizer. Non-2xx responses throw a status-bearing error so the gateway's `classifyProviderError` maps them to the right `DomainError`.
- `src/host/config.ts` — env-file + process-env config loader. Resolves `DEEPSEEK_API_KEY`/`OPENAI_API_KEY`/`LLM_API_KEY`, `MODEL`, `OPEN_AI_BASE_URL`, optional `MAX_TOKENS`/`REASONING_MODEL`, and infers the provider name from the base URL.
- `src/host/runtime-host.ts` — the composition root. Opens a workspace and wires **every** module implementation (store, ledger, artifact registry, policy, skills, grow, admission, agenda, evidence, contracts, hatch, target, tool runtime, context compiler, LLM gateway with the real adapter, attempt runner, agent runtime kernel, debug/feedback bridge) plus the CLI ports and `FengCli`.
- `src/host/cli-entry.ts` — `runCli` / `main`: load config → build host → run argv → print the rendered envelope → return the CLI exit code; config errors return code 78.
- `bin/feng.mjs` + `package.json` `bin` — the `feng` executable.

## Verification (live, not just unit)

- Live DeepSeek round-trip **through feng's own gateway** (policy decision → provider HTTP → normalized response → file-native receipt artifact) returned `finishReason: stop`, content block `"pong"`, plus a `reasoning_summary` block, and wrote a receipt artifact. This proves the model wiring against the real provider, not a stub.
- `feng` bin end-to-end: `feng grow create …` then `feng grow list --json` created and listed a grow unit, persisting under `.feng/`.
- `npm run typecheck`, `npm run build`, `npm run test:coverage` (93 files / 436 tests, global branch 80.1%). Every new file ≤ 400 lines.

## Review Findings

- The configured model `deepseek-v4-pro` is a **reasoning** model: it spends completion tokens on hidden reasoning and can return empty `content` under a tight `max_tokens`. The adapter defaults `max_tokens` to a generous value and the gateway's normalizer already surfaces both `content` and `reasoning_content`, so reasoning models work without special-casing.
- The adapter deliberately implements only `send` + `getCapabilities` + `listModels`; response/stream normalization is left to the gateway's provider-neutral normalizer, which already understands OpenAI-shaped responses. This keeps the adapter small and avoids duplicating normalization.
- `fetchImpl` is injectable specifically so unit tests never touch the network; the live path uses Node's global `fetch`.

Residual risks / follow-ups:

- `cli-entry.main()` argv pre-scan (for `--workspace`/`--env-file`) is exercised only via the live bin, not unit tests; its branches are the main uncovered spot in `src/host`. Global coverage still passes.
- Streaming is not yet wired end-to-end through the host (the adapter advertises streaming capability but the host uses non-streaming `send`). Not needed for the current grow/hatch/novel scenario.
- The host builds one workspace-scoped instance; multi-workspace orchestration (the nested feng→xiaoshuo→libai scenario) will construct one host per directory.

## Boundary Checks

- The host changes no module contracts; it only composes existing factories, so all prior boundary guarantees hold.
- The provider adapter sits strictly behind the LLM gateway; it never touches the file store, policy, or artifacts directly — the gateway still owns receipts, policy verification, and event logging.
- Secrets: the API key is read from the environment/`.env` at startup and passed only to the adapter's `Authorization` header. The request-summary preview already redacts long tokens. No key is written into `.feng` facts.

## Design Judgments

- `providers/` and `host/` are infrastructure layers, not new entries in the fixed 20-module detailed design. They are the missing "composition + I/O edge" that the design always implied (every module takes its dependencies by injection) but never instantiated for production.
- Building the real entrypoint is the prerequisite for the user's supervision scenario and for the concept end-state; it was prioritized over adding more breadth to already-complete modules. This is the first concrete step toward a feng that can self-grow a `xiaoshuo` command and write a novel.

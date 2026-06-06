# Context & Message Compiler Development Review

Date: 2026-06-06

## Scope

This review covers the Context & Message Compiler module implementation, tests, and its fit against the detailed design spec.

Reviewed artifacts:

- `docs/detailed-design/modules/context-message-compiler/spec.md`
- `src/context-message-compiler/*`
- `tests/context-message-compiler/*`
- Dependency ports from Artifact Registry, Skill Registry, Grow Unit Manager, Admission & Feedback Inbox, and Agenda & DoD Manager.

## Top-Level Judgment

The implementation matches the intended module role: it compiles file-native grow facts into the next provider-neutral message list without calling an LLM, executing tools, deciding readiness, changing admission, changing agenda state, or activating skills.

The module produces durable records and artifacts for:

- `ContextCompilePlan`
- `compiled_message_list`
- source map
- budget report
- exclusion list
- compile report
- message list invalidation record

The implementation links the latest message list back to the grow unit through the existing Grow Unit Manager port, but it does not mutate grow lifecycle.

## Local Review

Important boundaries verified:

- Every compile creates a new `MessageListId`.
- Recompile creates a new message list and does not rewrite the old compiled artifact.
- Explanations read source map, budget report, exclusion list, and compile report artifacts.
- Active skills are only candidates; attempt intent controls visible skills.
- Admitted input is only visible when the attempt intent selected it.
- Tool summaries are only read-only visibility hints; unsafe tool surfaces are excluded.
- Redacted, retracted, unavailable, missing, and privacy-blocked artifacts do not enter message text.
- Budget pressure creates truncation and/or exclusion records while leaving original artifacts untouched.
- `compiled_message_list` artifact ownership is enforced by Artifact Registry producer policy.

## Fixes During Review

Review found one correctness issue before finalization:

`bounded_body` skill mode initially trusted successful `loadSkillBody` results without re-checking the returned `privacyClass`. This could have allowed a `contains_secret`, `unknown`, or `redacted` skill body into the message list if Skill Registry returned content.

Fix:

- Context Compiler now excludes successfully loaded skill bodies with `contains_secret`, `unknown`, or `redacted` privacy metadata.
- Added helper-level coverage asserting the secret body text does not enter the built section.

## Verification

Commands run:

- `npm run typecheck`
- `npx vitest run tests/context-message-compiler`
- `npm run test:coverage`
- `npm run build`
- source/test line-count check for `*.ts` files under `src` and `tests`

Final verification result:

- Typecheck passed.
- Context tests passed: 3 files, 15 tests.
- Full coverage passed: 25 files, 125 tests, branch coverage 80.09%.
- Build passed.
- No source/test TypeScript file exceeds 400 lines.

## Residual Risks

The provider-neutral message shape is intentionally minimal. LLM Gateway can later lower it into provider-specific request schemas.

Budget uses a rough character-token model. That is acceptable at this layer because provider-specific token accounting belongs with LLM Gateway capability summaries.

Tool visibility currently depends on caller-supplied `ToolSurfaceSummary`. This matches the current spec because Tool Runtime does not exist yet.

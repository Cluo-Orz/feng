# Admission & Feedback Inbox Development Review

## Scope

Implemented `Admission & Feedback Inbox` as the eighth module in the file-native grow kernel.

The module now provides:

- Durable inbox item receipt, normalization, heuristic classification, admission decisions, and pending listing.
- Feedback unit creation, evidence linking, status transitions, redaction, listing, and event-stream recovery.
- Upstream proposal creation with redacted summary refs and policy gating.
- Upstream result recording that moves feedback to `accepted_upstream`, `rejected`, `waiting_evidence`, or `waiting_human`.
- Admission summary and explanation APIs.

## Top-Level Review

Reread:

- `docs/detailed-design/modules/admission-feedback-inbox/spec.md`
- `docs/detailed-design/top-level-module-design.md`
- Prior dependency reviews for Grow Unit Manager, Artifact Registry, Policy Boundary, and Skill Registry.

Result:

- The implementation preserves the top-level invariant that received input does not enter the model context.
- The module does not call an LLM, execute tools, compile message lists, judge readiness, or mutate grow lifecycle.
- Large/private content is stored as `ArtifactRef`; events carry refs and summaries.
- Feedback starts as `candidate`, not `accepted_local`.
- Upstream movement stops at `UpstreamProposal`; `accepted_upstream` only happens through `recordUpstreamResult`.
- Unknown privacy is blocked from upstream movement.

## Local Review

Key implementation decisions:

- Split the module into small files so each business file stays under 400 lines.
- Kept `InboxItemId` and `UpstreamProposalId` local to this module until later modules prove they need global domain IDs.
- Made terminal inbox statuses immutable: `admitted`, `rejected`, `quarantined`, and `redacted` cannot be silently rewritten.
- Required `local_only` to follow `waiting_policy`, so it means "do not propagate upstream" rather than a generic admission.
- Required `proposed_upstream` and `accepted_upstream` feedback transitions to carry an upstream proposal ref.
- Rebuild feedback records from `feedback_unit` event streams when projection JSON is missing.

Intentional spec adjustment:

- `decideAdmission("propose_upstream")` marks an inbox item as `waiting_policy` and requires a redacted artifact ref, but it does not itself create an upstream proposal or policy decision. Actual upstream movement is centralized in `createUpstreamProposal`, where the target grow unit and policy context are available.

This is stricter than the spec wording and avoids making inbox admission a cross-layer propagation side effect.

## Verification

Commands run:

- `npm run typecheck`
- `npm run test:coverage`
- `npm run build`
- TS line-count check for `src` and `tests`

Final coverage:

- 95 tests passed.
- Statements: 88.54%
- Branches: 80.02%
- Functions: 97.58%
- Lines: 97.18%

Line-count result:

- No `src` or `tests` TypeScript file exceeds 400 lines.

## Residual Risk

- Branch coverage is just over the global threshold; later modules may lower the global percentage and require more tests.
- Inbox item records are not rebuilt from grow-unit stream yet. Feedback records are recoverable, which was the explicit spec requirement.
- `default_feedback_router` is represented as active skill refs and optional context summary only. It still cannot execute or directly change status.
- True directory watching, debug bridge ingestion, and context visibility decisions remain for later modules.

## Conclusion

The implementation satisfies the module's role as the input and feedback admission boundary. It supports the future multi-layer loop without letting runtime feedback directly pollute upstream grow state.

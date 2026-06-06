# Hatch Builder Development Review

## Scope

Implemented `src/hatch-builder` as the file-native hatch package planning, packaging, verification, local publishing, lifecycle, and explanation layer.

Included:

- Hatch request recording under `.feng/hatch-builder/requests`.
- Build plan creation under `.feng/hatch-builder/build-plans`.
- Hatch package record creation under `.feng/hatch-builder/packages`.
- Verification reports under `.feng/hatch-builder/verifications`.
- Build plans gated by `ready_to_hatch` evidence, locked runtime contracts, version conflict checks, and `hatch.publish` policy.
- Required base resources for locked runtime contract and readiness verdict artifacts.
- Optional request resources, active grow-unit skills, skill bodies, and skill assets.
- Resource exclusion for raw message lists, traces, unaccepted candidates, archived/retracted/unavailable/redacted/deleted artifacts, unknown privacy, secret-like material, missing content hashes, and policy-blocked export.
- `artifact.export` policy decisions for external export or private/user-content resources.
- Self-contained hatch package artifacts with manifest and resource snapshots.
- UTF-8, binary/base64, and external-handle resource packaging.
- Hatch package verification for readable package artifacts, ready verdicts, locked contracts, included resource readability, and secret-like packaged content.
- Local publish lifecycle gated by package verification and `hatch.publish`.
- Package retraction and supersession lifecycle transitions.
- Package listing, package explanation, and resource inclusion/exclusion explanations.

Excluded by design:

- Running the hatched runtime or target agent.
- Installing generated commands into a host environment.
- Remote publication or automatic update distribution.
- Mutating Runtime Contract Registry, Evidence Readiness, Skill Registry, or Artifact Registry ownership rules.
- Treating hatch as a directory copy of grow state.
- Packaging raw grow message lists, traces, or candidate noise.
- Auto-approving private/user-content export.

## Review Findings

No blocking issues found after implementation and tests.

Issues found and fixed during coverage work:

- Package verification originally did not exercise malformed hatch package documents. Tests now verify malformed package artifacts fail verification and cannot be published.
- Resource explanation had sparse optional fields by design, but lacked direct coverage. Tests now verify `none` and `unknown` explanations for sparse exclusions.
- Package build now has direct coverage for late version conflicts after plan creation, so build-time checks do not rely only on plan-time checks.

Residual risks:

- Package verification is structural and content-safety oriented. It does not prove the hatched runtime is semantically good in a target world.
- External handles are snapshotted as handles plus hashes; remote content availability remains outside Hatch Builder.
- Local publish means locally available package state only. Host installation remains a later runtime/install boundary.
- The package manifest is sufficient for file-native audit and local handoff, but future installer work may need a stricter manifest schema.

## Boundary Checks

- Hatch Builder is the only module that creates `hatch_package` artifacts.
- Build plan creation requires a ready evidence verdict and locked runtime contract.
- Retracted contracts and archived grow units cannot hatch.
- Package version conflicts are checked at both plan and package build time.
- Required resource exclusions block package build with typed errors.
- Secret-like material blocks resource packaging or package verification.
- Raw compiled/runtime message lists and attempt/runtime traces are excluded.
- Unaccepted candidate outputs are excluded.
- Redacted, unavailable, retracted, deleted, and archived artifacts are excluded or blocked.
- Private/user-content external export requires `artifact.export` allow.
- Local publish requires successful verification and `hatch.publish` allow.
- Retracted and failed packages cannot be published.
- Package lifecycle transitions are recorded as file-native records and ledger events.

## Verification

- `npm run typecheck`
- `npx vitest run tests/hatch-builder`
- `npm run test:coverage`
- `npm run build`
- `src/**/*.ts` and `tests/**/*.ts` line-count check: no files over 400 lines.

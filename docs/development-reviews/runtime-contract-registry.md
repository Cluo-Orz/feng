# Runtime Contract Registry Development Review

## Scope

Implemented `src/runtime-contract-registry` as the file-native runtime contract version, validation, readiness-verification, lifecycle-lock, and explanation layer.

Included:

- Runtime contract candidate and registered record creation.
- File-native records under `.feng/runtime-contracts` for contracts, contract index, completeness reports, and hatch verification reports.
- `runtime_contract` artifact creation owned only by Runtime Contract Registry.
- Contract materialization from Artifact Registry without treating the contract artifact as a hatch package.
- Runtime kernel support for `standard_agent_kernel`, `custom_agent_kernel`, `non_llm_runtime`, and `hybrid_runtime`.
- Explicit contract shape for input, output/event, action boundary, debug, feedback, failure, observability, and version compatibility.
- Optional dialogue input represented as contract data, not as the default interaction form.
- Version add/compare/deprecate/retract lifecycle operations without editing locked or retracted records in place.
- Completeness validation that checks structure, evidence artifact lifecycle, readable contract artifact content, and secret-like material.
- Hatch verification against Evidence & Readiness verdicts, capability boundary support, and readiness blockers.
- Hatch lock gate that requires latest successful verification plus explicit `hatch.publish` policy allowance.
- Summary and explanation APIs for runtime contract, kernel choice, version compatibility, and missing contract cases.

Excluded by design:

- Building hatch packages.
- Installing runtime commands.
- Running target agents or target-world adapters.
- Creating target-world-specific runtime implementation code.
- Sending upstream feedback.
- Treating validation as `ready_to_hatch`.
- Locking a contract as a side effect of validation.
- Storing secrets or secret-like material inside runtime contract artifacts.

## Review Findings

No blocking issues found after implementation and tests.

One issue was found and fixed during coverage work:

- `validateRuntimeContract` materialized the runtime contract artifact but did not reject non-available or non-string content. This could let a redacted/unavailable contract artifact pass structure validation. The validation path now returns `artifact_unavailable` unless the contract artifact is readable string content.

Residual risks:

- Capability support currently relies on Policy Boundary's declared environment summary; richer host/target-world capability discovery should remain a later integration.
- Runtime contract completeness is structural. Semantic quality still depends on upstream grow attempts, validators, and Evidence & Readiness records.
- `incompatible` lifecycle exists for the contract state model, but no public operation promotes a contract to incompatible yet.
- Version compatibility comparison is field-diff based; migration planning belongs to a future hatch/runtime compatibility workflow.

## Boundary Checks

- `runtime_contract` artifacts cannot be produced by arbitrary modules.
- A runtime contract ref is separate from a hatch package ref.
- Locked and retracted contracts cannot be edited in place.
- Missing structure creates completeness reports instead of hatch-ready status.
- Readiness verdict lookup failure returns `readiness_missing`.
- Non-ready readiness verdict produces a failed verification report, not a hard hatch.
- Unsupported capabilities return `capability_unsupported`.
- Contract artifact redaction/unavailability blocks materialization and validation.
- Redacted/unavailable/retracted evidence artifacts block validation.
- Hatch lock requires latest successful verification and explicit `hatch.publish` allow.
- Default or denied hatch publish policy cannot lock the contract.

## Verification

- `npm run typecheck`
- `npx vitest run tests/runtime-contract-registry`
- `npm run test:coverage`
- `npm run build`
- `src/**/*.ts` and `tests/**/*.ts` line-count check: no files over 400 lines.

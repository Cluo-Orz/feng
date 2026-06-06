# Target World Adapter Development Review

## Scope

Implemented `src/target-world-adapter` as the file-native target-world boundary, adapter compatibility, world envelope, target action preparation, validation, failure mapping, and debug signal layer.

Included:

- Target world descriptors under `.feng/target-world-adapter/worlds`.
- Adapter definitions and lifecycle records under `.feng/target-world-adapter/adapters`.
- Runtime contract compatibility reports under `.feng/target-world-adapter/compatibility`.
- Normalized world input envelopes under `.feng/target-world-adapter/world-inputs`.
- Normalized runtime output envelopes under `.feng/target-world-adapter/world-outputs`.
- Target action requests and dispatch lifecycle under `.feng/target-world-adapter/actions`.
- Target validation reports under `.feng/target-world-adapter/validations`.
- Target failure mappings under `.feng/target-world-adapter/failures`.
- Debug signals under `.feng/target-world-adapter/debug-signals`.
- Artifact Registry integration for descriptor, normalized envelope, action payload, validation report, and debug signal artifacts.
- Event Ledger integration through the `target_world` stream.
- Policy Capability Boundary checks for target action approval and debug trace upload.
- Runtime Contract Registry and Hatch Builder checks before accepting package-bound input, output, validation, or debug flows.

Excluded by design:

- Running the hatched agent runtime or LLM loop.
- Executing target-world actions inside a game engine, novel workspace, music tool, or other host.
- Treating raw target state as the next LLM message list.
- Treating target validation reports as evidence readiness verdicts.
- Treating debug signals as accepted feedback or upstream proposals.
- Mutating grow-unit lifecycle, hatch package lifecycle, readiness verdicts, feedback inbox adoption, or upstream absorption.
- Generating unlimited runtime forms for target agents.
- Converting every target-world interaction into dialogue.

## Review Findings

No blocking issues found after implementation and tests.

Issues found and fixed during coverage work:

- Debug signal upload policy branches needed direct coverage. Tests now cover local debug signals, allowed uploads, and blocked uploads.
- Action dispatch needed explicit coverage for policy-waiting and cancelled terminal behavior. Tests now verify waiting actions cannot dispatch and terminal actions cannot be dispatched again.
- Compatibility checks originally leaned on happy-path adapter matching. Tests now cover inactive adapters, missing shared I/O kinds, forbidden action conflicts, and unsupported runtime kernels.

Residual risks:

- Compatibility is structural and contract-based. It does not prove target behavior is semantically good in a live engine or creative workflow.
- External enforcement is represented as a boundary marker and reference. Actual host-side enforcement remains outside this module.
- Normalization preserves file-native envelopes and artifacts, but target-specific schema validation will need stricter adapter plugins later.
- Debug signals remain local records unless policy allows upload. Converting them into accepted feedback is intentionally left to Admission Feedback Inbox.

## Boundary Checks

- `WorldInputEnvelope` is not a message list. Raw target state is kept as referenced artifact material and normalized into a separate envelope artifact.
- `WorldOutputEnvelope` is not an executed target action. Runtime output must pass target and contract checks before action preparation.
- `TargetActionRequest` is not dispatched by creation. Dispatch requires a validated request from policy approval or explicit external enforcement.
- `ValidationReport` is not a readiness verdict. Readiness remains owned by Evidence Readiness.
- `DebugSignal` is not feedback acceptance. Feedback remains owned by Admission Feedback Inbox.
- Retracted or failed hatch packages cannot drive package-bound target flows.
- Runtime contract mismatch blocks world input, runtime output, validation, and debug signal flows.
- Target action kinds must be supported by the target world and permitted by the runtime contract when the contract defines an action boundary.
- Debug trace upload requires `debug_trace.upload` policy allow.
- All records and artifacts are persisted as files under `.feng/target-world-adapter`.

## Verification

- `npm run typecheck`
- `npx vitest run tests/target-world-adapter`
- `npm run test:coverage`
- `npm run build`
- `src/**/*.ts` and `tests/**/*.ts` line-count check: no files over 400 lines.

Note: the first full coverage run hit the pre-existing `tool-runtime` queued concurrency timeout flake; an immediate rerun passed with global branch coverage at `80.01%`.

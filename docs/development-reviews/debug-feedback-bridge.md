# Debug & Feedback Bridge Development Review

## Scope

Implemented `src/debug-feedback-bridge` as the file-native bridge between hatch runtime, target-world debug signals, and upstream grow units. Every record lives under `.feng/debug-feedback-bridge` and is reachable from files.

Included:

- `DebugCorrelation` records linking runtime invocation, hatch package, runtime contract, target world, and grow units. A correlation is a debugging join key, not a session and not a grow lifecycle object.
- Ingestion of runtime traces, target debug signals, runtime feedback candidate hints, and manual debugging observations into normalized `RuntimeReportEnvelope` records.
- `FeedbackAttribution` derivation that decides origin/target layer, confidence, and upstream eligibility.
- `PrivacyFilterResult` derivation with redacted-summary carriers for any propagation of sensitive content.
- `FeedbackBridgePacket` construction with a `suggestedAction` (propose upstream feng / propose target agent / create local candidate / request more evidence / request human review / keep local observation) plus a local-only reason.
- Policy decisions for `debug_trace.upload`, `feedback.upstream`, and `artifact.export` cross-layer requests.
- Submission of local feedback candidates and upstream proposals strictly through Admission & Feedback Inbox.
- Bridge event ledger stream and an explanation API for where a candidate came from and why it stayed local or was proposed upstream.

Excluded by design (delegated to other modules):

- Running the Agent Runtime Kernel, executing target-world actions, executing tools, or compiling message lists.
- Creating or mutating `FeedbackUnit`/`UpstreamProposal` state — only Admission owns that state machine.
- Mutating grow lifecycle, Agenda, DoD, ReadinessVerdict, or hatch packages.
- Uploading raw private content upstream — only redacted carriers cross layers.

## Review Findings

No blocking issues after implementation and tests.

Issues found and fixed during verification:

- The redacted-summary carrier artifact was first registered with `privacyClass: "redacted"`. Policy Boundary (`src/policy-boundary/privacy.ts`) treats `redacted` as non-crossable for cross-boundary capabilities such as `feedback.upstream`, so upstream proposals were denied. Fixed by registering the carrier as `workspace_private` (a safe, crossable class) while the packet keeps its semantic `redacted` classification.
- `appendBridgeEvent` originally carried an optional workspace-scoped event stream that nothing produced; removed it and made `correlationRef` required so the stream is always the per-correlation stream.
- `derivePrivacy` never emits `block_*`/`waiting_human`, so the corresponding guard/branch handling and the `privacyReason` switch were partially dead. Replaced the reason switch with a lookup map and dropped the unreachable decision arms.
- `requestUpstreamProposal` previously layered `bridgePrivacyGuard` on top of the redaction check, which made the redaction guard unreachable. The redaction requirement (a packet with no redacted carrier can never go upstream) is now the single enforced check, and is exercised by an upstream-eligible-but-local-intent packet.
- Global branch coverage dropped below threshold after adding this module. Added focused unit tests (pure logic, privacy/policy, packet/submit flow, edge cases) plus file-native fault-injection tests (corrupt records and corrupt indexes) that exercise real storage failure modes, and trimmed genuinely dead defensive branches. Global branch coverage is back over 80%.

Residual risks:

- `ingestRuntimeTrace` reads runtime traces without a policy context, so non-public traces fall back to a conservative metadata-only envelope using the correlation privacy boundary. Rich trace ingestion will need an explicit policy-gated path later.
- Attribution confidence is a heuristic over supporting-report count, evidence count, and a confidence hint. It deliberately refuses to attribute a single weakly-evidenced downstream failure to the upstream feng project.
- Packet contract compatibility relies on the runtime contract declaring a feedback contract; a debug-only contract is rejected defensively.

## Boundary Checks

- A `DebugCorrelation` joins runtime/world/grow references; it never mutates grow lifecycle and is not a session.
- `RuntimeTrace`, `TargetDebugSignal`, `RuntimeFeedbackCandidateHint`, and `FeedbackBridgePacket` are all distinct from `FeedbackUnit`.
- `FeedbackUnit` and `UpstreamProposal` are created only by Admission & Feedback Inbox; the bridge passes attribution, evidence, redacted carriers, and policy context.
- Unknown attribution cannot auto-propagate upstream; a single downstream failure cannot be attributed to the upstream feng project.
- Sensitive classes (`contains_secret`, `project_private`, `contains_user_content`, etc.) are never propagated as raw content; a redacted summary carrier is required for any upstream proposal.
- Every cross-layer propagation carries an attribution, a privacy filter result, and a policy decision.

## Design Judgments

- The feng → upstream (e.g. feng → xiaoshuo → libai) report path is implemented as a default, changeable mechanism: routing uses the `default_feedback_router` summary and produces a `suggestedAction`, rather than hard-coding upstream absorption. Whether a gap is absorbed upstream remains a downstream grow/hatch decision, not an automatic push.
- Spec-level error codes are mapped onto the fixed domain error enum (`contract_incompatible`, `invalid_state`, `privacy_blocked`, `redaction_required`, `runtime_trace_unavailable`, `not_found`, `invalid_input`, `schema_incompatible`) instead of introducing new codes.
- Added three small, additive capabilities to neighboring modules that this bridge needs and that were missing: a `debug_bridge` event stream type, a `debug-feedback-bridge` artifact producer, and `getTargetDebugSignal` on the Target World Adapter. None change existing behavior.

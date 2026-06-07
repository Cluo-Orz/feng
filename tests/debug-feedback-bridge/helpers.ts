import { createDebugFeedbackBridge, type DebugFeedbackBridge } from "../../src/debug-feedback-bridge/index.js";
import type { ArtifactRef, GrowUnitRef, HatchPackageRef, PrivacyLevel, RuntimeContractRef, TargetWorldRef } from "../../src/domain/index.js";
import type { PolicyContext } from "../../src/policy-boundary/index.js";
import type { DebugCorrelationRef } from "../../src/debug-feedback-bridge/index.js";
import type { WorldInputEnvelopeRef } from "../../src/target-world-adapter/index.js";
import type { TempWorkspace } from "../file-store/helpers.js";
import {
  makeAgentRuntimeFixture,
  readyAgentRuntime,
  type AgentRuntimeFixture
} from "../agent-runtime-kernel/helpers.js";
import { audit, policy, registerTextArtifact, source, version } from "../hatch-builder/helpers.js";

export interface BridgeFixture extends AgentRuntimeFixture {
  readonly bridge: DebugFeedbackBridge;
}

export function makeBridgeFixture(workspace: TempWorkspace): BridgeFixture {
  const fixture = makeAgentRuntimeFixture(workspace);
  return {
    ...fixture,
    bridge: createDebugFeedbackBridge({
      workspace: fixture.workspace,
      store: fixture.store,
      ledger: fixture.ledger,
      artifactRegistry: fixture.artifacts,
      policyBoundary: fixture.policy,
      skillRegistry: fixture.skills,
      runtimeContractRegistry: fixture.contracts,
      hatchBuilder: fixture.hatch,
      targetWorldAdapter: fixture.target,
      agentRuntimeKernel: fixture.agentRuntime,
      admissionInbox: fixture.admission,
      producer: "debug-bridge-test"
    })
  };
}

export function allowAll(): PolicyContext {
  return policy([{ capability: "*", resource: "*", verdict: "allow" }]);
}

export interface CorrelationSetup {
  readonly correlationRef: DebugCorrelationRef;
  readonly originGrowUnitRef: GrowUnitRef;
  readonly targetGrowUnitRef: GrowUnitRef;
  readonly runtimeContractRef: RuntimeContractRef;
  readonly hatchPackageRef: HatchPackageRef;
  readonly targetWorldRef: TargetWorldRef;
  readonly worldInputRef: WorldInputEnvelopeRef;
}

export async function setupCorrelation(
  fixture: BridgeFixture,
  options: { readonly privacyBoundary?: PrivacyLevel } = {}
): Promise<{ ok: true; value: CorrelationSetup } | { ok: false; error: { message: string } }> {
  const ready = await readyAgentRuntime(fixture, true);
  if (!ready.ok) return { ok: false, error: { message: ready.error.message } };
  const pkg = await fixture.hatch.getHatchPackage(ready.value.hatchPackageRef);
  if (!pkg.ok) return { ok: false, error: { message: pkg.error.message } };
  const origin = await makeGrow(fixture, "origin-debug-grow");
  if (!origin.ok) return origin;
  const target = await makeGrow(fixture, "upstream-feng-grow");
  if (!target.ok) return target;
  const opened = await fixture.bridge.openDebugCorrelation({
    originGrowUnitRef: origin.value,
    targetGrowUnitRef: target.value,
    hatchPackageRef: ready.value.hatchPackageRef,
    runtimeContractRef: pkg.value.runtimeContractRef,
    targetWorldRef: ready.value.targetWorldRef,
    mode: "feedback_reporting",
    privacyBoundary: options.privacyBoundary ?? "workspace_private",
    source: source(fixture, "system"),
    audit: audit("open debug correlation")
  });
  if (!opened.ok) return { ok: false, error: { message: opened.error.message } };
  return {
    ok: true,
    value: {
      correlationRef: opened.value,
      originGrowUnitRef: origin.value,
      targetGrowUnitRef: target.value,
      runtimeContractRef: pkg.value.runtimeContractRef,
      hatchPackageRef: ready.value.hatchPackageRef,
      targetWorldRef: ready.value.targetWorldRef,
      worldInputRef: ready.value.worldInputRef
    }
  };
}

export async function openAnother(fixture: BridgeFixture, setup: CorrelationSetup): Promise<DebugCorrelationRef> {
  const origin = await makeGrow(fixture, "second-origin-grow");
  if (!origin.ok) throw new Error(origin.error.message);
  const opened = await fixture.bridge.openDebugCorrelation({
    originGrowUnitRef: origin.value,
    hatchPackageRef: setup.hatchPackageRef,
    runtimeContractRef: setup.runtimeContractRef,
    targetWorldRef: setup.targetWorldRef,
    mode: "developer_debug",
    privacyBoundary: "workspace_private",
    source: source(fixture, "system"),
    audit: audit("open second correlation")
  });
  if (!opened.ok) throw new Error(opened.error.message);
  return opened.value;
}

export async function makeGrow(
  fixture: BridgeFixture,
  title: string
): Promise<{ ok: true; value: GrowUnitRef } | { ok: false; error: { message: string } }> {
  const grow = await fixture.grow.createGrowUnit({
    title,
    goalBoundarySummary: `Grow unit ${title}.`,
    targetBehaviorSummary: "Behaves as a feng grow unit.",
    source: source(fixture, "system"),
    version,
    audit: audit("create grow")
  });
  return grow.ok ? { ok: true, value: grow.value } : { ok: false, error: { message: grow.error.message } };
}

export async function evidence(fixture: BridgeFixture, content: string, privacy?: PrivacyLevel): Promise<ArtifactRef> {
  const ref = await registerTextArtifact(fixture, { content, ...(privacy === undefined ? {} : { privacy }) });
  if (!ref.ok) throw new Error(ref.error.message);
  return ref.value;
}

export async function observe(
  fixture: BridgeFixture,
  correlationRef: DebugCorrelationRef,
  options: {
    readonly summary?: string;
    readonly privacyClass?: PrivacyLevel;
    readonly evidenceRefs?: readonly ArtifactRef[];
  } = {}
) {
  return fixture.bridge.ingestManualObservation(correlationRef, {
    summary: options.summary ?? "manual observation of runtime behavior",
    privacyClass: options.privacyClass ?? "workspace_private",
    evidenceRefs: options.evidenceRefs ?? [],
    source: source(fixture, "user"),
    audit: audit("manual observation")
  });
}

export interface RuntimeArtifacts {
  readonly invocationRef: import("../../src/agent-runtime-kernel/index.js").RuntimeInvocationRef;
  readonly traceRef: import("../../src/agent-runtime-kernel/index.js").RuntimeTraceRef;
  readonly signalRef: import("../../src/target-world-adapter/index.js").TargetDebugSignalRef;
  readonly hintRef: import("../../src/agent-runtime-kernel/index.js").RuntimeFeedbackCandidateHintRef;
}

export async function runtimeArtifacts(
  fixture: BridgeFixture,
  setup: CorrelationSetup
): Promise<{ ok: true; value: RuntimeArtifacts } | { ok: false; error: { message: string } }> {
  const invocation = await fixture.agentRuntime.startRuntimeInvocation({
    hatchPackageRef: setup.hatchPackageRef,
    targetWorldRef: setup.targetWorldRef,
    mode: "debug",
    modelSelection: { provider: "fake", model: "fake-model" },
    source: source(fixture, "runtime"),
    version,
    audit: audit("start runtime")
  });
  if (!invocation.ok) return { ok: false, error: { message: invocation.error.message } };
  const turn = await fixture.agentRuntime.runRuntimeTurn(invocation.value, setup.worldInputRef, { policyContext: allowAll() });
  if (!turn.ok) return { ok: false, error: { message: turn.error.message } };
  const traceRef = await fixture.agentRuntime.recordRuntimeTrace(invocation.value);
  if (!traceRef.ok) return { ok: false, error: { message: traceRef.error.message } };
  const signal = await fixture.target.recordTargetDebugSignal({
    targetWorldRef: setup.targetWorldRef,
    runtimeContractRef: setup.runtimeContractRef,
    hatchPackageRef: setup.hatchPackageRef,
    signalKind: "failure_trace",
    summary: "boss failed to dodge in rage phase",
    privacyClass: "workspace_private",
    feedbackCandidateHint: "adapter mapped action incorrectly",
    source: source(fixture, "target_world"),
    audit: audit("record debug signal")
  });
  if (!signal.ok) return { ok: false, error: { message: signal.error.message } };
  const hint = await fixture.agentRuntime.recordFeedbackCandidateHint({
    runtimeInvocationRef: invocation.value,
    runtimeTraceRef: traceRef.value,
    targetWorldRef: setup.targetWorldRef,
    summary: "runtime produced a feedback candidate hint",
    attributionHint: "target_agent_project decision gap",
    evidenceRefs: [signal.value.artifactRef],
    privacyClass: "workspace_private",
    debugModeOnly: true,
    source: source(fixture, "runtime"),
    audit: audit("record hint")
  });
  if (!hint.ok) return { ok: false, error: { message: hint.error.message } };
  return {
    ok: true,
    value: { invocationRef: invocation.value, traceRef: traceRef.value, signalRef: signal.value.debugSignalRef, hintRef: hint.value }
  };
}

export { audit, makeAgentRuntimeFixture, policy, readyAgentRuntime, registerTextArtifact, source, version };
export type { AgentRuntimeFixture };


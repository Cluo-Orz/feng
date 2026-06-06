import { createTargetWorldAdapter, type TargetWorldAdapter } from "../../src/target-world-adapter/index.js";
import type { HatchPackageRef, TargetWorldRef } from "../../src/domain/index.js";
import type { Result } from "../../src/domain/result.js";
import type { TargetWorldAdapterRef } from "../../src/target-world-adapter/index.js";
import type { TempWorkspace } from "../file-store/helpers.js";
import {
  allowHatchPublish,
  audit,
  hatchInput,
  lockedContractSetup,
  makeHatchFixture,
  policy,
  registerTextArtifact,
  source,
  version,
  type HatchFixture
} from "../hatch-builder/helpers.js";

export interface TargetFixture extends HatchFixture {
  readonly target: TargetWorldAdapter;
}

export type TargetHatchSetup = Parameters<typeof hatchInput>[1];

export function makeTargetFixture(workspace: TempWorkspace): TargetFixture {
  const fixture = makeHatchFixture(workspace);
  return {
    ...fixture,
    target: createTargetWorldAdapter({
      workspace: fixture.workspace,
      store: fixture.store,
      ledger: fixture.ledger,
      artifactRegistry: fixture.artifacts,
      policyBoundary: fixture.policy,
      runtimeContractRegistry: fixture.contracts,
      hatchBuilder: fixture.hatch,
      evidenceReadiness: fixture.evidence,
      producer: "target-test"
    })
  };
}

export async function buildTargetPackage(
  fixture: TargetFixture,
  setup: TargetHatchSetup
): Promise<Result<HatchPackageRef>> {
  const request = await fixture.hatch.requestHatch(hatchInput(fixture, setup, {
    packageName: "target-boss-agent",
    requestedVersion: { schemaVersion: "9.0.0", producerVersion: "target-test" }
  }));
  if (!request.ok) return request;
  const plan = await fixture.hatch.buildHatchPlan(request.value, allowHatchPublish());
  if (!plan.ok) return plan;
  return fixture.hatch.buildHatchPackage(plan.value.hatchBuildPlanRef);
}

export async function registerGameWorld(fixture: TargetFixture): Promise<Result<{
  readonly targetWorldRef: TargetWorldRef;
  readonly adapterRef: TargetWorldAdapterRef;
}>> {
  const targetWorld = await fixture.target.registerTargetWorld({
    name: "Boss Arena",
    kind: "game_engine",
    description: "Game arena that sends boss tick state and accepts bounded boss action events.",
    inputKinds: ["tick_state"],
    outputKinds: ["action_event"],
    actionKinds: ["move", "attack"],
    validationKinds: ["scenario_check"],
    debugSignalKinds: ["failure_trace", "state_snapshot"],
    privacyBoundary: "workspace_private",
    environmentBoundary: "local game engine process",
    capabilityRequirements: ["runtime.target_action"],
    source: source(fixture, "system"),
    version,
    audit: audit("register target world")
  });
  if (!targetWorld.ok) return targetWorld;
  const adapter = await fixture.target.registerAdapter({
    targetWorldRef: targetWorld.value,
    name: "Boss Arena Adapter",
    supportedRuntimeKernelTypes: ["non_llm_runtime", "standard_agent_kernel"],
    supportedInputKinds: ["tick_state"],
    supportedOutputKinds: ["action_event"],
    supportedActionKinds: ["move", "attack"],
    supportedValidationKinds: ["scenario_check"],
    hostIntegrationSummary: "Adapter maps tick snapshots and boss action events.",
    compatibility: "Boss runtime compatible.",
    policyBoundarySummary: "runtime.target_action required for dispatch.",
    source: source(fixture, "system"),
    version,
    audit: audit("register target adapter")
  });
  if (!adapter.ok) return adapter;
  const active = await fixture.target.changeAdapterLifecycle(adapter.value, "active", "activate target adapter");
  return active.ok ? { ok: true as const, value: { targetWorldRef: targetWorld.value, adapterRef: adapter.value } } : active;
}

export { allowHatchPublish, audit, hatchInput, lockedContractSetup, policy, registerTextArtifact, source, version };

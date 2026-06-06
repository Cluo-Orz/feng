import { createHatchBuilder, type HatchBuilder, type HatchRequestInput } from "../../src/hatch-builder/index.js";
import type { ArtifactRef, GrowUnitRef, RuntimeContractRef, SkillRef } from "../../src/domain/index.js";
import type { Result } from "../../src/domain/result.js";
import type { TempWorkspace } from "../file-store/helpers.js";
import {
  allowHatchPublish,
  audit,
  contractInput,
  createGrowAgendaDod,
  makeContractFixture,
  policy,
  readyVerdict,
  source,
  version,
  type ContractFixture
} from "../runtime-contract-registry/helpers.js";

export interface HatchFixture extends ContractFixture {
  readonly hatch: HatchBuilder;
}

export function makeHatchFixture(workspace: TempWorkspace): HatchFixture {
  const fixture = makeContractFixture(workspace);
  return {
    ...fixture,
    hatch: createHatchBuilder({
      workspace: fixture.workspace,
      store: fixture.store,
      ledger: fixture.ledger,
      artifactRegistry: fixture.artifacts,
      policyBoundary: fixture.policy,
      growUnitManager: fixture.grow,
      evidenceReadiness: fixture.evidence,
      runtimeContractRegistry: fixture.contracts,
      skillRegistry: fixture.skills,
      producer: "hatch-test"
    })
  };
}

export async function lockedContractSetup(fixture: HatchFixture) {
  const setup = await createGrowAgendaDod(fixture);
  if (!setup.ok) return setup;
  const verdict = await readyVerdict(fixture, setup.value.growUnitRef, setup.value.dodRef);
  if (!verdict.ok) return verdict;
  const contract = await fixture.contracts.registerRuntimeContract(contractInput(fixture, setup.value.growUnitRef, {
    evidenceRefs: verdict.value.evidenceArtifactRefs,
    readinessVerdictRef: verdict.value.readinessVerdictRef
  }));
  if (!contract.ok) return contract;
  const verified = await fixture.contracts.verifyRuntimeContractForHatch(contract.value, verdict.value.readinessVerdictRef);
  if (!verified.ok) return verified;
  const locked = await fixture.contracts.lockRuntimeContractForHatch(contract.value, {
    reason: "lock for hatch builder tests",
    policyContext: allowHatchPublish()
  });
  if (!locked.ok) return locked;
  return {
    ok: true as const,
    value: {
      growUnitRef: setup.value.growUnitRef,
      readinessVerdictRef: verdict.value.readinessVerdictRef,
      runtimeContractRef: contract.value
    }
  };
}

export function hatchInput(
  fixture: HatchFixture,
  setup: { readonly growUnitRef: GrowUnitRef; readonly readinessVerdictRef: HatchRequestInput["readinessVerdictRef"]; readonly runtimeContractRef: RuntimeContractRef },
  extra: Partial<HatchRequestInput> = {}
): HatchRequestInput {
  return {
    growUnitRef: setup.growUnitRef,
    readinessVerdictRef: setup.readinessVerdictRef,
    runtimeContractRef: setup.runtimeContractRef,
    requestedVersion: version,
    packageName: "boss-agent",
    targetPackageKind: "non_llm_runtime",
    publishMode: "local_release",
    reason: "hatch boss agent",
    requestedBy: "hatch-test",
    source: source(fixture, "system"),
    audit: audit("hatch request"),
    ...extra
  };
}

export async function registerTextArtifact(
  fixture: HatchFixture,
  input: { readonly content: string; readonly privacy?: Parameters<typeof fixture.artifacts.registerArtifact>[0]["privacyClass"]; readonly kind?: Parameters<typeof fixture.artifacts.registerArtifact>[0]["kind"]; readonly producer?: Parameters<typeof fixture.artifacts.registerArtifact>[0]["producerModule"] }
): Promise<Result<ArtifactRef>> {
  return fixture.artifacts.registerArtifact({
    kind: input.kind ?? "source_material",
    content: input.content,
    mediaType: "text/plain",
    encoding: "utf8",
    source: source(fixture, "system"),
    version,
    audit: audit("register hatch artifact"),
    privacyClass: input.privacy ?? "workspace_private",
    retentionClass: "grow_scoped",
    producerModule: input.producer ?? "human"
  });
}

export async function registerActiveSkill(
  fixture: HatchFixture,
  growUnitRef: GrowUnitRef,
  assetRefs: readonly ArtifactRef[] = []
): Promise<{ readonly ok: true; readonly value: SkillRef } | { readonly ok: false; readonly error: unknown }> {
  const skill = await fixture.skills.registerSkill({
    name: "boss-skill",
    family: "boss",
    version,
    sourceKind: "workspace_local",
    source: source(fixture, "system"),
    scope: { workspace: fixture.workspace.id, growUnit: growUnitRef.id },
    description: "Boss decision skill.",
    triggerSummary: "Used by boss hatch package.",
    body: "Use tick state and emit bounded boss actions.",
    assetRefs,
    declaredCapabilities: ["runtime.target_action"],
    privacyClass: "workspace_private",
    audit: audit("register skill")
  });
  if (!skill.ok) return skill;
  const activated = await fixture.skills.activateSkill(skill.value, {
    scope: { workspace: fixture.workspace.id, growUnit: growUnitRef.id },
    reason: "activate for hatch",
    activatedBy: "hatch-test",
    source: source(fixture, "system"),
    audit: audit("activate skill"),
    policyContext: policy([{ capability: "skill.activate", resource: "*", verdict: "allow" }])
  });
  return activated.ok ? { ok: true as const, value: skill.value } : activated;
}

export { allowHatchPublish, audit, contractInput, createGrowAgendaDod, policy, readyVerdict, source, version };

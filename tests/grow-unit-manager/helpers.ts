import {
  createArtifactRegistry,
  type ArtifactRegistry
} from "../../src/artifact-registry/index.js";
import {
  makeAttemptId,
  makeHatchPackageId,
  makeMessageListId,
  makeRef,
  type VersionDescriptor
} from "../../src/domain/index.js";
import { createEventLedger, type EventLedger } from "../../src/event-ledger/index.js";
import {
  createGrowUnitManager,
  type CreateGrowUnitInput,
  type GrowUnitManager,
  type GrowUnitReasonInput
} from "../../src/grow-unit-manager/index.js";
import { createPolicyBoundary, type PolicyBoundary, type PolicyContext } from "../../src/policy-boundary/index.js";
import { createSkillRegistry, type SkillRegistry } from "../../src/skill-registry/index.js";
import { audit, source } from "../event-ledger/helpers.js";
import type { TempWorkspace } from "../file-store/helpers.js";

export interface GrowUnitFixture extends TempWorkspace {
  readonly ledger: EventLedger;
  readonly artifacts: ArtifactRegistry;
  readonly policy: PolicyBoundary;
  readonly skills: SkillRegistry;
  readonly grow: GrowUnitManager;
}

export const version: VersionDescriptor = { schemaVersion: "1", producerVersion: "test" };

export function makeGrowUnitFixture(workspace: TempWorkspace): GrowUnitFixture {
  const ledger = createEventLedger(workspace.store, {
    workspace: workspace.workspace,
    producer: "grow-unit-test"
  });
  const artifacts = createArtifactRegistry(workspace.store, {
    workspace: workspace.workspace,
    ledger,
    producer: "grow-unit-test"
  });
  const policy = createPolicyBoundary({ ledger, artifactRegistry: artifacts, producer: "grow-unit-test" });
  const skills = createSkillRegistry(workspace.store, {
    workspace: workspace.workspace,
    ledger,
    artifactRegistry: artifacts,
    policyBoundary: policy,
    producer: "grow-unit-test"
  });
  return {
    ...workspace,
    ledger,
    artifacts,
    policy,
    skills,
    grow: createGrowUnitManager(workspace.store, {
      workspace: workspace.workspace,
      ledger,
      artifactRegistry: artifacts,
      policyBoundary: policy,
      skillRegistry: skills,
      producer: "grow-unit-test"
    })
  };
}

export function createInput(fixture: GrowUnitFixture, extra: Partial<CreateGrowUnitInput> = {}): CreateGrowUnitInput {
  return {
    title: "boss-agent",
    goalBoundarySummary: "Grow a boss decision agent for a 2D action game.",
    targetBehaviorSummary: "Read target-world state and emit bounded boss actions.",
    source: source(fixture.workspace),
    version,
    audit: audit("create grow unit"),
    ...extra
  };
}

export function reasonInput(fixture: GrowUnitFixture, reason = "test mutation"): GrowUnitReasonInput {
  return {
    reason,
    source: source(fixture.workspace),
    audit: audit(reason)
  };
}

export function allowArchivePolicy(): PolicyContext {
  return {
    caller: "grow-unit-manager",
    environment: {
      hostSandboxAvailable: false,
      networkAvailable: false,
      externalEnforcementAvailable: false,
      secretStoreAvailable: false
    },
    rules: [{ capability: "file.delete", resource: "grow-unit:*", verdict: "allow" }]
  };
}

export async function validationReport(fixture: GrowUnitFixture, content = "{\"ok\":true}") {
  return fixture.artifacts.registerArtifact({
    kind: "validation_report",
    content,
    mediaType: "application/json",
    encoding: "utf8",
    source: source(fixture.workspace),
    version,
    audit: audit("register readiness verdict"),
    privacyClass: "workspace_private",
    retentionClass: "grow_scoped",
    producerModule: "grow-attempt-runner"
  });
}

export async function activeWorkspaceSkill(fixture: GrowUnitFixture) {
  const skill = await fixture.skills.registerSkill({
    name: "grow-loop-skill",
    family: "grow-loop-skill",
    version,
    sourceKind: "workspace_local",
    source: source(fixture.workspace),
    scope: { workspace: fixture.workspace.id },
    description: "Keeps grow loop facts organized.",
    triggerSummary: "Use while coordinating grow loop state.",
    body: "# Grow Loop Skill\nDo not inline body in snapshots.",
    privacyClass: "workspace_private",
    audit: audit("register grow skill")
  });
  if (!skill.ok) return skill;
  const activated = await fixture.skills.activateSkill(skill.value, {
    scope: { workspace: fixture.workspace.id },
    reason: "activate workspace skill",
    activatedBy: "test",
    source: source(fixture.workspace),
    audit: audit("activate grow skill"),
    policyContext: {
      caller: "skill-registry",
      environment: {
        hostSandboxAvailable: false,
        networkAvailable: false,
        externalEnforcementAvailable: false,
        secretStoreAvailable: false
      },
      rules: [{ capability: "skill.activate", resource: "*", verdict: "allow" }]
    }
  });
  return activated.ok ? skill : activated;
}

export const attemptRef = () => makeRef("attempt", makeAttemptId("attempt-1"));
export const messageListRef = () => makeRef("message_list", makeMessageListId("message-list-1"));
export const hatchPackageRef = () => makeRef("hatch_package", makeHatchPackageId("hatch-1"));

import {
  createArtifactRegistry,
  type ArtifactRegistry
} from "../../src/artifact-registry/index.js";
import { createEventLedger, type EventLedger } from "../../src/event-ledger/index.js";
import { createPolicyBoundary, type PolicyBoundary, type PolicyContext } from "../../src/policy-boundary/index.js";
import {
  createSkillRegistry,
  type RegisterSkillInput,
  type SkillActivationInput,
  type SkillRegistry
} from "../../src/skill-registry/index.js";
import type { VersionDescriptor } from "../../src/domain/index.js";
import type { TempWorkspace } from "../file-store/helpers.js";
import { audit, source } from "../event-ledger/helpers.js";

export interface SkillFixture extends TempWorkspace {
  readonly ledger: EventLedger;
  readonly artifacts: ArtifactRegistry;
  readonly policy: PolicyBoundary;
  readonly skills: SkillRegistry;
}

export function makeSkillFixture(workspace: TempWorkspace): SkillFixture {
  const ledger = createEventLedger(workspace.store, {
    workspace: workspace.workspace,
    producer: "skill-registry-test"
  });
  const artifacts = createArtifactRegistry(workspace.store, {
    workspace: workspace.workspace,
    ledger,
    producer: "skill-registry-test"
  });
  const policy = createPolicyBoundary({ ledger, artifactRegistry: artifacts, producer: "skill-registry-test" });
  return {
    ...workspace,
    ledger,
    artifacts,
    policy,
    skills: createSkillRegistry(workspace.store, {
      workspace: workspace.workspace,
      ledger,
      artifactRegistry: artifacts,
      policyBoundary: policy,
      producer: "skill-registry-test"
    })
  };
}

export const version1: VersionDescriptor = { schemaVersion: "1", producerVersion: "test" };
export const version2: VersionDescriptor = { schemaVersion: "2", producerVersion: "test" };

export function registerInput(fixture: SkillFixture, extra: Partial<RegisterSkillInput> = {}): RegisterSkillInput {
  return {
    name: "novel-style",
    family: "novel-style",
    version: version1,
    sourceKind: "workspace_local",
    source: source(fixture.workspace),
    scope: { workspace: fixture.workspace.id },
    description: "Style guidance for writing scenes.",
    triggerSummary: "Use when drafting novel scenes or polishing prose.",
    body: "# Novel Style\nNever inline this body into lifecycle events.",
    mediaType: "text/markdown",
    encoding: "utf8",
    privacyClass: "workspace_private",
    audit: audit("register skill"),
    declaredCapabilities: ["artifact.read"],
    ...extra
  };
}

export function allowSkillPolicyContext(): PolicyContext {
  return {
    caller: "skill-registry",
    environment: {
      hostSandboxAvailable: false,
      networkAvailable: false,
      externalEnforcementAvailable: false,
      secretStoreAvailable: false
    },
    rules: [{ capability: "skill.activate", resource: "*", verdict: "allow" }]
  };
}

export function activationInput(
  fixture: SkillFixture,
  extra: Partial<SkillActivationInput> = {}
): SkillActivationInput {
  return {
    scope: { workspace: fixture.workspace.id },
    reason: "activate for tests",
    activatedBy: "developer",
    source: source(fixture.workspace),
    audit: audit("activate skill"),
    policyContext: allowSkillPolicyContext(),
    ...extra
  };
}

import {
  createArtifactRegistry,
  type ArtifactRegistry,
  type RegisterArtifactInput
} from "../../src/artifact-registry/index.js";
import { createAdmissionFeedbackInbox, type AdmissionFeedbackInbox, type ReceivePayloadInput } from "../../src/admission-feedback-inbox/index.js";
import { type AuditDescriptor, type PolicyDecisionId, type SourceDescriptor, type VersionDescriptor } from "../../src/domain/index.js";
import { createEventLedger, type EventLedger } from "../../src/event-ledger/index.js";
import { createGrowUnitManager, type GrowUnitManager } from "../../src/grow-unit-manager/index.js";
import { createPolicyBoundary, type PolicyBoundary, type PolicyContext } from "../../src/policy-boundary/index.js";
import { createSkillRegistry, type SkillRegistry } from "../../src/skill-registry/index.js";
import type { TempWorkspace } from "../file-store/helpers.js";

export interface AdmissionFixture extends TempWorkspace {
  readonly ledger: EventLedger;
  readonly artifacts: ArtifactRegistry;
  readonly policy: PolicyBoundary;
  readonly skills: SkillRegistry;
  readonly grow: GrowUnitManager;
  readonly admission: AdmissionFeedbackInbox;
}

export const version: VersionDescriptor = { schemaVersion: "1", producerVersion: "test" };

export function makeAdmissionFixture(workspace: TempWorkspace): AdmissionFixture {
  const ledger = createEventLedger(workspace.store, { workspace: workspace.workspace, producer: "admission-test" });
  const artifacts = createArtifactRegistry(workspace.store, {
    workspace: workspace.workspace,
    ledger,
    producer: "admission-test",
    defaultPreviewChars: 120
  });
  const policy = createPolicyBoundary({ ledger, artifactRegistry: artifacts, producer: "admission-test" });
  const skills = createSkillRegistry(workspace.store, {
    workspace: workspace.workspace,
    ledger,
    artifactRegistry: artifacts,
    policyBoundary: policy,
    producer: "admission-test"
  });
  const grow = createGrowUnitManager(workspace.store, {
    workspace: workspace.workspace,
    ledger,
    artifactRegistry: artifacts,
    policyBoundary: policy,
    skillRegistry: skills,
    producer: "admission-test"
  });
  return {
    ...workspace,
    ledger,
    artifacts,
    policy,
    skills,
    grow,
    admission: createAdmissionFeedbackInbox(workspace.store, {
      workspace: workspace.workspace,
      ledger,
      artifactRegistry: artifacts,
      policyBoundary: policy,
      skillRegistry: skills,
      growUnitManager: grow,
      producer: "admission-test"
    })
  };
}

export async function createGrow(fixture: AdmissionFixture, title = "boss-agent") {
  return fixture.grow.createGrowUnit({
    title,
    goalBoundarySummary: `Grow ${title} until it has a bounded runtime contract.`,
    targetBehaviorSummary: "Receive world facts and emit bounded behavior.",
    source: source(fixture, "system"),
    version,
    audit: audit("create grow")
  });
}

export function receiveInput(
  fixture: AdmissionFixture,
  content: string,
  extra: Partial<ReceivePayloadInput> = {}
): ReceivePayloadInput {
  return {
    content,
    mediaType: "text/plain",
    encoding: "utf8",
    privacyClass: "workspace_private",
    version,
    source: source(fixture, "user"),
    audit: audit("receive input"),
    ...extra
  };
}

export function textArtifactInput(
  fixture: AdmissionFixture,
  content: string,
  extra: Partial<RegisterArtifactInput> = {}
): RegisterArtifactInput {
  return {
    kind: "summary",
    content,
    mediaType: "text/plain",
    encoding: "utf8",
    source: source(fixture, "system"),
    version,
    audit: audit("register test artifact"),
    privacyClass: "public",
    retentionClass: "grow_scoped",
    producerModule: "human",
    ...extra
  };
}

export async function activateDefaultRouter(fixture: AdmissionFixture) {
  return fixture.skills.ensureDefaultFeedbackRouter({
    version,
    source: source(fixture, "system"),
    scope: { workspace: fixture.workspace.id, systemDefault: true },
    description: "Routes feedback as candidates only.",
    triggerSummary: "Use for feedback routing proposals.",
    body: "# Default Feedback Router\nNever inline this body.",
    privacyClass: "workspace_private",
    audit: audit("ensure default router"),
    activate: {
      scope: { workspace: fixture.workspace.id, systemDefault: true },
      reason: "activate default router",
      activatedBy: "test",
      source: source(fixture, "system"),
      audit: audit("activate default router"),
      policyContext: allowSkillPolicy()
    }
  });
}

export function allowSkillPolicy(): PolicyContext {
  return policyContext([{ capability: "skill.activate", resource: "*", verdict: "allow" }]);
}

export function allowUpstreamPolicy(): PolicyContext {
  return policyContext([{ capability: "feedback.upstream", resource: "*", verdict: "allow" }]);
}

export function policyContext(rules: PolicyContext["rules"] = []): PolicyContext {
  return {
    caller: "admission-feedback-inbox",
    environment: {
      hostSandboxAvailable: false,
      networkAvailable: false,
      externalEnforcementAvailable: false,
      secretStoreAvailable: false
    },
    rules
  };
}

export function source(fixture: AdmissionFixture, kind: SourceDescriptor["kind"]): SourceDescriptor {
  return {
    kind,
    origin: "admission-test",
    workspace: fixture.workspace.id,
    userProvided: kind === "user",
    receivedAt: "2026-06-06T00:00:00.000Z",
    privacyLevel: "workspace_private"
  };
}

export function audit(reason: string): AuditDescriptor {
  return { createdAt: "2026-06-06T00:00:00.000Z", createdBy: "admission-test", reason };
}

export const policyId = (value: string): PolicyDecisionId => value as PolicyDecisionId;

import {
  createAdmissionFeedbackInbox,
  type AdmissionFeedbackInbox,
  type ReceivePayloadInput
} from "../../src/admission-feedback-inbox/index.js";
import { createAgendaDoDManager, type AgendaDoDManager } from "../../src/agenda-dod-manager/index.js";
import { createArtifactRegistry, type ArtifactRegistry, type RegisterArtifactInput } from "../../src/artifact-registry/index.js";
import type { AuditDescriptor, SourceDescriptor, VersionDescriptor } from "../../src/domain/index.js";
import { createEventLedger, type EventLedger } from "../../src/event-ledger/index.js";
import { createGrowUnitManager, type GrowUnitManager } from "../../src/grow-unit-manager/index.js";
import { createPolicyBoundary, type PolicyBoundary, type PolicyContext } from "../../src/policy-boundary/index.js";
import { createSkillRegistry, type SkillRegistry } from "../../src/skill-registry/index.js";
import type { TempWorkspace } from "../file-store/helpers.js";

export interface AgendaFixture extends TempWorkspace {
  readonly ledger: EventLedger;
  readonly artifacts: ArtifactRegistry;
  readonly policy: PolicyBoundary;
  readonly skills: SkillRegistry;
  readonly grow: GrowUnitManager;
  readonly admission: AdmissionFeedbackInbox;
  readonly agenda: AgendaDoDManager;
}

export const version: VersionDescriptor = { schemaVersion: "1", producerVersion: "agenda-test" };

export function makeAgendaFixture(workspace: TempWorkspace): AgendaFixture {
  const ledger = createEventLedger(workspace.store, { workspace: workspace.workspace, producer: "agenda-test" });
  const artifacts = createArtifactRegistry(workspace.store, {
    workspace: workspace.workspace,
    ledger,
    producer: "agenda-test",
    defaultPreviewChars: 160
  });
  const policy = createPolicyBoundary({ ledger, artifactRegistry: artifacts, producer: "agenda-test" });
  const skills = createSkillRegistry(workspace.store, {
    workspace: workspace.workspace,
    ledger,
    artifactRegistry: artifacts,
    policyBoundary: policy,
    producer: "agenda-test"
  });
  const grow = createGrowUnitManager(workspace.store, {
    workspace: workspace.workspace,
    ledger,
    artifactRegistry: artifacts,
    policyBoundary: policy,
    skillRegistry: skills,
    producer: "agenda-test"
  });
  const admission = createAdmissionFeedbackInbox(workspace.store, {
    workspace: workspace.workspace,
    ledger,
    artifactRegistry: artifacts,
    policyBoundary: policy,
    skillRegistry: skills,
    growUnitManager: grow,
    producer: "agenda-test"
  });
  return {
    ...workspace,
    ledger,
    artifacts,
    policy,
    skills,
    grow,
    admission,
    agenda: createAgendaDoDManager(workspace.store, {
      workspace: workspace.workspace,
      ledger,
      artifactRegistry: artifacts,
      policyBoundary: policy,
      skillRegistry: skills,
      growUnitManager: grow,
      admissionInbox: admission,
      producer: "agenda-test"
    })
  };
}

export async function createGrowAndAgenda(fixture: AgendaFixture, title = "boss-agent") {
  const grow = await fixture.grow.createGrowUnit({
    title,
    goalBoundarySummary: `Grow ${title} with bounded inputs, outputs, and DoD evidence.`,
    targetBehaviorSummary: "Receive world or authoring facts and emit bounded agent behavior.",
    source: source(fixture, "system"),
    version,
    audit: audit("create grow")
  });
  if (!grow.ok) return grow;
  const agenda = await fixture.agenda.createAgenda(grow.value, {
    goalBoundarySummary: `Agenda for ${title}`,
    currentFocus: "clarify target behavior and evidence",
    source: source(fixture, "system"),
    version,
    audit: audit("create agenda")
  });
  return agenda.ok ? grow : agenda;
}

export function artifactInput(
  fixture: AgendaFixture,
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
    audit: audit("register artifact"),
    privacyClass: "workspace_private",
    retentionClass: "grow_scoped",
    producerModule: "human",
    ...extra
  };
}

export function receiveInput(fixture: AgendaFixture, content: string): ReceivePayloadInput {
  return {
    content,
    mediaType: "text/plain",
    encoding: "utf8",
    normalizedSummary: content,
    privacyClass: "workspace_private",
    version,
    source: source(fixture, "user"),
    audit: audit("receive input")
  };
}

export async function activateWorkspaceSkill(fixture: AgendaFixture) {
  const skill = await fixture.skills.registerSkill({
    name: "boss-grow-context",
    family: "grow-context",
    version,
    sourceKind: "workspace_local",
    source: source(fixture, "system"),
    scope: { workspace: fixture.workspace.id },
    description: "Summarizes boss grow context.",
    triggerSummary: "Use when building agenda attempt intent.",
    body: "# Boss Grow Context\nNever inline this body.",
    privacyClass: "workspace_private",
    audit: audit("register skill")
  });
  if (!skill.ok) return skill;
  const activated = await fixture.skills.activateSkill(skill.value, {
    scope: { workspace: fixture.workspace.id },
    reason: "activate skill",
    activatedBy: "test",
    source: source(fixture, "system"),
    audit: audit("activate skill"),
    policyContext: allowSkillPolicy()
  });
  return activated.ok ? skill : activated;
}

export function source(fixture: AgendaFixture, kind: SourceDescriptor["kind"]): SourceDescriptor {
  return {
    kind,
    origin: "agenda-test",
    workspace: fixture.workspace.id,
    userProvided: kind === "user",
    receivedAt: "2026-06-06T00:00:00.000Z",
    privacyLevel: "workspace_private"
  };
}

export function audit(reason: string): AuditDescriptor {
  return { createdAt: "2026-06-06T00:00:00.000Z", createdBy: "agenda-test", reason };
}

export function allowSkillPolicy(): PolicyContext {
  return policyContext([{ capability: "skill.activate", resource: "*", verdict: "allow" }]);
}

export function allowArchivePolicy(): PolicyContext {
  return policyContext([{ capability: "file.delete", resource: "grow-unit:*", verdict: "allow" }]);
}

function policyContext(rules: NonNullable<PolicyContext["rules"]>): PolicyContext {
  return {
    caller: "agenda-test",
    environment: {
      hostSandboxAvailable: false,
      networkAvailable: false,
      externalEnforcementAvailable: false,
      secretStoreAvailable: false
    },
    rules
  };
}

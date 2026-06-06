import { createAdmissionFeedbackInbox, type AdmissionFeedbackInbox } from "../../src/admission-feedback-inbox/index.js";
import { createAgendaDoDManager, type AgendaDoDManager, type DoDRef } from "../../src/agenda-dod-manager/index.js";
import { createArtifactRegistry, type ArtifactRegistry, type RegisterArtifactInput } from "../../src/artifact-registry/index.js";
import type { AuditDescriptor, GrowUnitRef, SourceDescriptor, VersionDescriptor } from "../../src/domain/index.js";
import { createEventLedger, type EventLedger } from "../../src/event-ledger/index.js";
import { createEvidenceReadiness, type EvidenceReadiness } from "../../src/evidence-readiness/index.js";
import { createGrowUnitManager, type GrowUnitManager } from "../../src/grow-unit-manager/index.js";
import { createPolicyBoundary, type PolicyBoundary, type PolicyContext } from "../../src/policy-boundary/index.js";
import { createSkillRegistry, type SkillRegistry } from "../../src/skill-registry/index.js";
import type { TempWorkspace } from "../file-store/helpers.js";

export interface EvidenceFixture extends TempWorkspace {
  readonly ledger: EventLedger;
  readonly artifacts: ArtifactRegistry;
  readonly policy: PolicyBoundary;
  readonly skills: SkillRegistry;
  readonly grow: GrowUnitManager;
  readonly admission: AdmissionFeedbackInbox;
  readonly agenda: AgendaDoDManager;
  readonly evidence: EvidenceReadiness;
}

export const version: VersionDescriptor = { schemaVersion: "1", producerVersion: "evidence-test" };

export function makeEvidenceFixture(workspace: TempWorkspace): EvidenceFixture {
  const ledger = createEventLedger(workspace.store, { workspace: workspace.workspace, producer: "evidence-test" });
  const artifacts = createArtifactRegistry(workspace.store, {
    workspace: workspace.workspace,
    ledger,
    producer: "evidence-test",
    defaultPreviewChars: 160
  });
  const policy = createPolicyBoundary({ ledger, artifactRegistry: artifacts, producer: "evidence-test" });
  const skills = createSkillRegistry(workspace.store, {
    workspace: workspace.workspace,
    ledger,
    artifactRegistry: artifacts,
    policyBoundary: policy,
    producer: "evidence-test"
  });
  const grow = createGrowUnitManager(workspace.store, {
    workspace: workspace.workspace,
    ledger,
    artifactRegistry: artifacts,
    policyBoundary: policy,
    skillRegistry: skills,
    producer: "evidence-test"
  });
  const admission = createAdmissionFeedbackInbox(workspace.store, {
    workspace: workspace.workspace,
    ledger,
    artifactRegistry: artifacts,
    policyBoundary: policy,
    skillRegistry: skills,
    growUnitManager: grow,
    producer: "evidence-test"
  });
  const agenda = createAgendaDoDManager(workspace.store, {
    workspace: workspace.workspace,
    ledger,
    artifactRegistry: artifacts,
    policyBoundary: policy,
    skillRegistry: skills,
    growUnitManager: grow,
    admissionInbox: admission,
    producer: "evidence-test"
  });
  return {
    ...workspace,
    ledger,
    artifacts,
    policy,
    skills,
    grow,
    admission,
    agenda,
    evidence: createEvidenceReadiness({
      workspace: workspace.workspace,
      store: workspace.store,
      ledger,
      artifactRegistry: artifacts,
      policyBoundary: policy,
      growUnitManager: grow,
      admissionInbox: admission,
      agendaDoDManager: agenda,
      producer: "evidence-test"
    })
  };
}

export async function createGrowAgendaAndDoD(fixture: EvidenceFixture) {
  const grow = await fixture.grow.createGrowUnit({
    title: "boss-agent",
    goalBoundarySummary: "Grow a boss agent with bounded runtime inputs and outputs.",
    targetBehaviorSummary: "Read world state and emit legal boss actions.",
    source: source(fixture, "system"),
    version,
    audit: audit("create grow")
  });
  if (!grow.ok) return grow;
  const agenda = await fixture.agenda.createAgenda(grow.value, {
    goalBoundarySummary: "Boss agent must be validated against target behavior.",
    currentFocus: "define and satisfy hatch readiness DoD",
    source: source(fixture, "system"),
    version,
    audit: audit("create agenda")
  });
  if (!agenda.ok) return agenda;
  const dod = await defineBossDoD(fixture, grow.value);
  return dod.ok ? { ok: true as const, value: { growUnitRef: grow.value, dodRef: dod.value } } : dod;
}

export function defineBossDoD(fixture: EvidenceFixture, growUnitRef: GrowUnitRef) {
  return fixture.agenda.defineDoD(growUnitRef, {
    statement: "Boss agent emits legal attack or move intents for sample world states.",
    scope: "target world boss runtime contract",
    evidenceRequirement: "validation report proving legal action choices on sample world states",
    validationIntent: "external or tool validation report, not model self claim",
    source: source(fixture, "system"),
    version,
    audit: audit("define dod")
  });
}

export function source(fixture: EvidenceFixture, kind: SourceDescriptor["kind"]): SourceDescriptor {
  return {
    kind,
    origin: "evidence-test",
    workspace: fixture.workspace.id,
    userProvided: kind === "user",
    receivedAt: "2026-06-06T00:00:00.000Z",
    privacyLevel: "workspace_private"
  };
}

export function audit(reason: string): AuditDescriptor {
  return { createdAt: "2026-06-06T00:00:00.000Z", createdBy: "evidence-test", reason };
}

export function allowPolicy(): PolicyContext {
  return policyContext([{ capability: "artifact.read", resource: "artifact:*", verdict: "allow" }]);
}

export function denyPolicy(): PolicyContext {
  return policyContext([{ capability: "artifact.read", resource: "artifact:*", verdict: "deny" }]);
}

export function policyContext(rules: NonNullable<PolicyContext["rules"]>): PolicyContext {
  return {
    caller: "evidence-readiness",
    environment: {
      hostSandboxAvailable: false,
      networkAvailable: false,
      externalEnforcementAvailable: false,
      secretStoreAvailable: false
    },
    rules
  };
}

export function reportArtifactInput(
  fixture: EvidenceFixture,
  content = "{\"passed\":true}",
  extra: Partial<RegisterArtifactInput> = {}
): RegisterArtifactInput {
  return {
    kind: "validation_report",
    content,
    mediaType: "application/json",
    encoding: "utf8",
    source: source(fixture, "tool"),
    version,
    audit: audit("register validation report"),
    privacyClass: "workspace_private",
    retentionClass: "grow_scoped",
    producerModule: "grow-attempt-runner",
    ...extra
  };
}

export function support(dodRef: DoDRef) {
  return [{ relation: "supports" as const, relatedDoDRef: dodRef, criticality: "normal" as const, reason: "matches DoD" }];
}

export function contradict(dodRef: DoDRef) {
  return [{ relation: "contradicts" as const, relatedDoDRef: dodRef, criticality: "critical" as const, reason: "breaks DoD" }];
}

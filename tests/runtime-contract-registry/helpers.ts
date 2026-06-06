import { createAdmissionFeedbackInbox, type AdmissionFeedbackInbox } from "../../src/admission-feedback-inbox/index.js";
import { createAgendaDoDManager, type AgendaDoDManager, type DoDRef } from "../../src/agenda-dod-manager/index.js";
import { createArtifactRegistry, type ArtifactRegistry } from "../../src/artifact-registry/index.js";
import type { AuditDescriptor, GrowUnitRef, SourceDescriptor, VersionDescriptor } from "../../src/domain/index.js";
import { createEventLedger, type EventLedger } from "../../src/event-ledger/index.js";
import { createEvidenceReadiness, type EvidenceReadiness, type ReadinessVerdictRecord } from "../../src/evidence-readiness/index.js";
import { createGrowUnitManager, type GrowUnitManager } from "../../src/grow-unit-manager/index.js";
import { createPolicyBoundary, type PolicyBoundary, type PolicyContext } from "../../src/policy-boundary/index.js";
import {
  actionBoundaryRef,
  compatibilityRef,
  createRuntimeContractRegistry,
  debugRef,
  failureRef,
  feedbackRef,
  inputRef,
  makeActionBoundaryId,
  makeCompatibilityId,
  makeDebugContractId,
  makeFailureContractId,
  makeFeedbackContractId,
  makeInputContractId,
  makeObservabilityContractId,
  makeOutputContractId,
  observabilityRef,
  outputRef,
  type RuntimeContractInput,
  type RuntimeContractRegistry,
  type RuntimeContractShape
} from "../../src/runtime-contract-registry/index.js";
import { createSkillRegistry, type SkillRegistry } from "../../src/skill-registry/index.js";
import type { TempWorkspace } from "../file-store/helpers.js";

export interface ContractFixture extends TempWorkspace {
  readonly ledger: EventLedger;
  readonly artifacts: ArtifactRegistry;
  readonly policy: PolicyBoundary;
  readonly skills: SkillRegistry;
  readonly grow: GrowUnitManager;
  readonly admission: AdmissionFeedbackInbox;
  readonly agenda: AgendaDoDManager;
  readonly evidence: EvidenceReadiness;
  readonly contracts: RuntimeContractRegistry;
}

export const version: VersionDescriptor = { schemaVersion: "1.0.0", producerVersion: "contract-test" };

export function makeContractFixture(workspace: TempWorkspace): ContractFixture {
  const ledger = createEventLedger(workspace.store, { workspace: workspace.workspace, producer: "contract-test" });
  const artifacts = createArtifactRegistry(workspace.store, { workspace: workspace.workspace, ledger, producer: "contract-test" });
  const policy = createPolicyBoundary({ ledger, artifactRegistry: artifacts, producer: "contract-test" });
  const skills = createSkillRegistry(workspace.store, {
    workspace: workspace.workspace,
    ledger,
    artifactRegistry: artifacts,
    policyBoundary: policy,
    producer: "contract-test"
  });
  const grow = createGrowUnitManager(workspace.store, {
    workspace: workspace.workspace,
    ledger,
    artifactRegistry: artifacts,
    policyBoundary: policy,
    skillRegistry: skills,
    producer: "contract-test"
  });
  const admission = createAdmissionFeedbackInbox(workspace.store, {
    workspace: workspace.workspace,
    ledger,
    artifactRegistry: artifacts,
    policyBoundary: policy,
    skillRegistry: skills,
    growUnitManager: grow,
    producer: "contract-test"
  });
  const agenda = createAgendaDoDManager(workspace.store, {
    workspace: workspace.workspace,
    ledger,
    artifactRegistry: artifacts,
    policyBoundary: policy,
    skillRegistry: skills,
    growUnitManager: grow,
    admissionInbox: admission,
    producer: "contract-test"
  });
  const evidence = createEvidenceReadiness({
    workspace: workspace.workspace,
    store: workspace.store,
    ledger,
    artifactRegistry: artifacts,
    policyBoundary: policy,
    growUnitManager: grow,
    admissionInbox: admission,
    agendaDoDManager: agenda,
    producer: "contract-test"
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
    evidence,
    contracts: createRuntimeContractRegistry({
      workspace: workspace.workspace,
      store: workspace.store,
      ledger,
      artifactRegistry: artifacts,
      policyBoundary: policy,
      growUnitManager: grow,
      evidenceReadiness: evidence,
      skillRegistry: skills,
      producer: "contract-test"
    })
  };
}

export async function createGrowAgendaDod(fixture: ContractFixture) {
  const grow = await fixture.grow.createGrowUnit({
    title: "boss-agent",
    goalBoundarySummary: "Grow a boss agent with runtime contract.",
    targetBehaviorSummary: "Read tick state and emit bounded boss actions.",
    source: source(fixture, "system"),
    version,
    audit: audit("create grow")
  });
  if (!grow.ok) return grow;
  const agenda = await fixture.agenda.createAgenda(grow.value, {
    goalBoundarySummary: "runtime contract must be validated",
    currentFocus: "contract readiness",
    source: source(fixture, "system"),
    version,
    audit: audit("create agenda")
  });
  if (!agenda.ok) return agenda;
  const dod = await fixture.agenda.defineDoD(grow.value, {
    statement: "runtime contract can drive legal boss actions",
    scope: "runtime contract hatch gate",
    evidenceRequirement: "validation report supports runtime contract",
    validationIntent: "external validation",
    source: source(fixture, "system"),
    version,
    audit: audit("define dod")
  });
  return dod.ok ? { ok: true as const, value: { growUnitRef: grow.value, dodRef: dod.value } } : dod;
}

export async function readyVerdict(fixture: ContractFixture, growUnitRef: GrowUnitRef, dodRef: DoDRef) {
  const evidence = await fixture.evidence.recordEvidenceCandidate({
    growUnitRef,
    sourceKind: "validation_report",
    summary: "runtime contract validation passed",
    content: "{\"passed\":true}",
    artifactKind: "validation_report",
    relationHints: [{ relation: "supports", relatedDoDRef: dodRef, criticality: "normal", reason: "validated" }],
    quality: { trustLevel: "strong" },
    source: source(fixture, "tool"),
    version,
    audit: audit("record evidence")
  });
  if (!evidence.ok) return evidence;
  const accepted = await fixture.evidence.acceptEvidenceForEvaluation(evidence.value, {
    reason: "accept evidence",
    source: source(fixture, "system"),
    audit: audit("accept evidence"),
    policyContext: allowArtifactRead()
  });
  if (!accepted.ok) return accepted;
  const assessment = await fixture.evidence.assessReadiness(growUnitRef, {
    evidenceRefs: [evidence.value],
    source: source(fixture, "system"),
    audit: audit("assess")
  });
  if (!assessment.ok) return assessment;
  return fixture.evidence.produceReadinessVerdict(assessment.value.readinessAssessmentRef);
}

export function contractInput(
  fixture: ContractFixture,
  growUnitRef: GrowUnitRef,
  extra: Partial<RuntimeContractInput> = {}
): RuntimeContractInput {
  return {
    growUnitRef,
    name: "boss-runtime-contract",
    version,
    runtimeKernelType: "non_llm_runtime",
    shape: completeShape(false),
    capabilityRequirements: ["runtime.target_action"],
    source: source(fixture, "system"),
    audit: audit("runtime contract"),
    ...extra
  };
}

export function completeShape(dialogueInputSupport: boolean): RuntimeContractShape {
  return {
    input: {
      inputContractRef: inputRef(makeInputContractId("input-1")),
      inputModes: dialogueInputSupport ? ["dialogue_turn", "tick_state"] : ["tick_state"],
      inputSchemas: ["BossTickState"],
      stateSnapshotRequirements: ["position", "phase"],
      artifactInputRules: ["runtime_contract only reads declared material"],
      dialogueInputSupport,
      streamingInputSupport: false,
      batchInputSupport: false,
      timingSemantics: "per tick",
      privacyRules: ["workspace_private only"]
    },
    output: {
      outputContractRef: outputRef(makeOutputContractId("output-1")),
      outputModes: ["action_event"],
      outputSchemas: ["BossAction"],
      eventSchemas: ["BossActionEvent"],
      artifactOutputRules: [],
      actionOutputRules: ["bounded boss actions only"],
      streamingOutputSupport: false,
      partialOutputSemantics: "no partial actions",
      privacyRules: ["no secret output"]
    },
    actionBoundary: {
      actionBoundaryRef: actionBoundaryRef(makeActionBoundaryId("action-1")),
      allowedActionKinds: ["move", "attack"],
      forbiddenActionKinds: ["spawn_unbounded"],
      requiredCapabilities: ["runtime.target_action"],
      targetWorldActionSummary: "emit boss action events",
      externalServiceSummary: "none",
      fileAccessSummary: "read packaged contract only",
      networkAccessSummary: "none",
      humanApprovalRequirements: [],
      boundaryDeclaration: "target actions stay inside boss runtime",
      policyDecisionRefs: []
    },
    debug: {
      debugContractRef: debugRef(makeDebugContractId("debug-1")),
      debugModes: ["off", "local_trace", "developer_debug"],
      traceLevel: "summary",
      traceEventKinds: ["decision"],
      correlationRules: ["tick id"],
      messageListExposureRules: ["none"],
      toolResultExposureRules: ["none"],
      targetWorldStateExposureRules: ["redacted state summary"],
      privacyRules: ["local trace by default"],
      uploadPolicyRequirement: "debug_trace.upload requires policy"
    },
    feedback: {
      feedbackContractRef: feedbackRef(makeFeedbackContractId("feedback-1")),
      feedbackEntryKinds: ["runtime_trace"],
      feedbackUnitShape: "summary plus trace refs",
      attributionRules: ["runtime invocation id"],
      originLayerRules: ["target_agent_project"],
      targetLayerRules: ["current_project"],
      evidenceRequirements: ["trace ref"],
      redactionRules: ["redact target state"],
      upstreamProposalRules: ["policy required"],
      defaultFeedbackRouterCompatibility: "compatible",
      policyDecisionRefs: []
    },
    failure: {
      failureContractRef: failureRef(makeFailureContractId("failure-1")),
      errorCodes: ["invalid_state", "timeout"],
      retryability: "host decides",
      timeoutSemantics: "single tick deadline",
      cancellationSemantics: "cancel between ticks",
      partialResultSemantics: "no partial action",
      fallbackSemantics: "idle action",
      recoveryRequirements: ["trace failure"],
      traceRequirements: ["error code"]
    },
    observability: {
      observabilityContractRef: observabilityRef(makeObservabilityContractId("obs-1")),
      requiredTraceRefs: [],
      runtimeTraceKinds: ["decision_trace"],
      metricSummaries: ["latency"],
      eventCorrelationRules: ["tick id"],
      artifactRetentionRules: ["hatch scoped"],
      privacyRules: ["no raw secret"]
    },
    compatibility: {
      compatibilityRef: compatibilityRef(makeCompatibilityId("compat-1")),
      version,
      compatibleWith: ["1.x"],
      breakingChanges: [],
      migrationNotes: "none",
      deprecationPolicy: "supersede with new version"
    }
  };
}

export function allowArtifactRead(): PolicyContext {
  return policy([{ capability: "artifact.read", resource: "*", verdict: "allow" }]);
}

export function allowHatchPublish(): PolicyContext {
  return policy([{ capability: "hatch.publish", resource: "*", verdict: "allow" }]);
}

export function policy(rules: NonNullable<PolicyContext["rules"]>): PolicyContext {
  return {
    caller: "runtime-contract-registry",
    environment: {
      hostSandboxAvailable: false,
      networkAvailable: true,
      externalEnforcementAvailable: false,
      secretStoreAvailable: false
    },
    rules
  };
}

export function source(fixture: ContractFixture, kind: SourceDescriptor["kind"]): SourceDescriptor {
  return {
    kind,
    origin: "contract-test",
    workspace: fixture.workspace.id,
    userProvided: kind === "user",
    receivedAt: "2026-06-06T00:00:00.000Z",
    privacyLevel: "workspace_private"
  };
}

export function audit(reason: string): AuditDescriptor {
  return { createdAt: "2026-06-06T00:00:00.000Z", createdBy: "contract-test", reason };
}

export type ReadyVerdictResult = ReadinessVerdictRecord;

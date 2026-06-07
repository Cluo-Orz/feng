import type { FileNativeStore } from "../file-store/index.js";
import type { EventLedger } from "../event-ledger/index.js";
import type { ArtifactRegistry } from "../artifact-registry/index.js";
import type { PolicyBoundary } from "../policy-boundary/index.js";
import type { SkillRegistry } from "../skill-registry/index.js";
import type { GrowUnitManager } from "../grow-unit-manager/index.js";
import type { AdmissionFeedbackInbox } from "../admission-feedback-inbox/index.js";
import type { AgendaDoDManager } from "../agenda-dod-manager/index.js";
import type { EvidenceReadiness } from "../evidence-readiness/index.js";
import type { GrowAttemptRunner } from "../grow-attempt-runner/index.js";
import type { HatchBuilder } from "../hatch-builder/index.js";
import type { AgentRuntimeKernel } from "../agent-runtime-kernel/index.js";
import type { DebugFeedbackBridge } from "../debug-feedback-bridge/index.js";
import type { LLMModelSelection } from "../llm-gateway/index.js";

export interface CLIPorts {
  readonly store: FileNativeStore;
  readonly ledger: EventLedger;
  readonly artifactRegistry: ArtifactRegistry;
  readonly policyBoundary: PolicyBoundary;
  readonly skillRegistry: SkillRegistry;
  readonly growUnitManager: GrowUnitManager;
  readonly admissionInbox: AdmissionFeedbackInbox;
  readonly agendaManager: AgendaDoDManager;
  readonly evidenceReadiness: EvidenceReadiness;
  readonly attemptRunner: GrowAttemptRunner;
  readonly hatchBuilder: HatchBuilder;
  readonly agentRuntimeKernel: AgentRuntimeKernel;
  readonly debugFeedbackBridge: DebugFeedbackBridge;
}

export interface FengCliOptions {
  readonly ports: CLIPorts;
  readonly producer: string;
  readonly defaultModelSelection?: LLMModelSelection;
  readonly now?: () => string;
  readonly newId?: () => string;
}

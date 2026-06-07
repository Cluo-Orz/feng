import { createNodeFileNativeStore, type FileNativeStore, type WorkspaceHandle } from "../file-store/index.js";
import { createEventLedger, type EventLedger } from "../event-ledger/index.js";
import { createArtifactRegistry, type ArtifactRegistry } from "../artifact-registry/index.js";
import { createPolicyBoundary, type PolicyBoundary } from "../policy-boundary/index.js";
import { createSkillRegistry, type SkillRegistry } from "../skill-registry/index.js";
import { createGrowUnitManager, type GrowUnitManager } from "../grow-unit-manager/index.js";
import { createAdmissionFeedbackInbox, type AdmissionFeedbackInbox } from "../admission-feedback-inbox/index.js";
import { createAgendaDoDManager, type AgendaDoDManager } from "../agenda-dod-manager/index.js";
import { createEvidenceReadiness, type EvidenceReadiness } from "../evidence-readiness/index.js";
import { createRuntimeContractRegistry, type RuntimeContractRegistry } from "../runtime-contract-registry/index.js";
import { createHatchBuilder, type HatchBuilder } from "../hatch-builder/index.js";
import { createTargetWorldAdapter, type TargetWorldAdapter } from "../target-world-adapter/index.js";
import { createToolRuntime, type RegisterToolInput, type ToolImplementation, type ToolRuntime } from "../tool-runtime/index.js";
import { createLLMGateway, type LLMGateway } from "../llm-gateway/index.js";
import { createContextMessageCompiler, type ContextMessageCompiler } from "../context-message-compiler/index.js";
import { createGrowAttemptRunner, type GrowAttemptRunner } from "../grow-attempt-runner/index.js";
import { createAgentRuntimeKernel, type AgentRuntimeKernel } from "../agent-runtime-kernel/index.js";
import { createDebugFeedbackBridge, type DebugFeedbackBridge } from "../debug-feedback-bridge/index.js";
import { createFengCli, type CLIPorts, type FengCli } from "../cli/index.js";
import { createOpenAICompatibleAdapter, type FetchLike } from "../providers/index.js";
import type { LLMProviderAdapter } from "../llm-gateway/index.js";
import type { FengConfig } from "./config.js";

export interface FengHost {
  readonly config: FengConfig;
  readonly workspace: WorkspaceHandle;
  readonly store: FileNativeStore;
  readonly ledger: EventLedger;
  readonly artifacts: ArtifactRegistry;
  readonly policy: PolicyBoundary;
  readonly skills: SkillRegistry;
  readonly grow: GrowUnitManager;
  readonly admission: AdmissionFeedbackInbox;
  readonly agenda: AgendaDoDManager;
  readonly evidence: EvidenceReadiness;
  readonly contracts: RuntimeContractRegistry;
  readonly hatch: HatchBuilder;
  readonly target: TargetWorldAdapter;
  readonly toolRuntime: ToolRuntime;
  readonly llmGateway: LLMGateway;
  readonly contextCompiler: ContextMessageCompiler;
  readonly attemptRunner: GrowAttemptRunner;
  readonly agentRuntimeKernel: AgentRuntimeKernel;
  readonly debugFeedbackBridge: DebugFeedbackBridge;
  readonly adapter: LLMProviderAdapter;
  readonly ports: CLIPorts;
  readonly cli: FengCli;
}

export interface CreateFengHostInput {
  readonly config: FengConfig;
  readonly producer?: string;
  readonly fetchImpl?: FetchLike;
  readonly toolImplementations?: readonly ToolImplementation[];
  readonly toolDefinitions?: readonly RegisterToolInput[];
  readonly adapter?: LLMProviderAdapter;
}

export async function createFengHost(input: CreateFengHostInput): Promise<FengHost> {
  const producer = input.producer ?? "feng-host";
  const store = createNodeFileNativeStore();
  const opened = await store.openWorkspace({ root: input.config.workspaceRoot });
  if (!opened.ok) throw new Error(`could not open workspace ${input.config.workspaceRoot}: ${opened.error.message}`);
  const workspace = opened.value;

  const ledger = createEventLedger(store, { workspace, producer });
  const artifacts = createArtifactRegistry(store, { workspace, ledger, producer });
  const policy = createPolicyBoundary({ ledger, artifactRegistry: artifacts, producer });
  const skills = createSkillRegistry(store, { workspace, ledger, artifactRegistry: artifacts, policyBoundary: policy, producer });
  const grow = createGrowUnitManager(store, {
    workspace, ledger, artifactRegistry: artifacts, policyBoundary: policy, skillRegistry: skills, producer
  });
  const admission = createAdmissionFeedbackInbox(store, {
    workspace, ledger, artifactRegistry: artifacts, policyBoundary: policy, skillRegistry: skills, growUnitManager: grow, producer
  });
  const agenda = createAgendaDoDManager(store, {
    workspace, ledger, artifactRegistry: artifacts, policyBoundary: policy, skillRegistry: skills,
    growUnitManager: grow, admissionInbox: admission, producer
  });
  const evidence = createEvidenceReadiness({
    workspace, store, ledger, artifactRegistry: artifacts, policyBoundary: policy,
    growUnitManager: grow, admissionInbox: admission, agendaDoDManager: agenda, producer
  });
  const contracts = createRuntimeContractRegistry({
    workspace, store, ledger, artifactRegistry: artifacts, policyBoundary: policy,
    growUnitManager: grow, evidenceReadiness: evidence, skillRegistry: skills, producer
  });
  const hatch = createHatchBuilder({
    workspace, store, ledger, artifactRegistry: artifacts, policyBoundary: policy, growUnitManager: grow,
    evidenceReadiness: evidence, runtimeContractRegistry: contracts, skillRegistry: skills, producer
  });
  const target = createTargetWorldAdapter({
    workspace, store, ledger, artifactRegistry: artifacts, policyBoundary: policy,
    runtimeContractRegistry: contracts, hatchBuilder: hatch, evidenceReadiness: evidence, producer
  });

  const adapter = input.adapter ?? createOpenAICompatibleAdapter({
    provider: input.config.provider.provider,
    apiKey: input.config.provider.apiKey,
    baseUrl: input.config.provider.baseUrl,
    model: input.config.provider.model,
    maxTokens: input.config.provider.maxTokens,
    reasoningModel: input.config.provider.reasoningModel,
    ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl })
  });

  const toolRuntime = createToolRuntime({
    workspace, store, ledger, artifactRegistry: artifacts, policyBoundary: policy, skillRegistry: skills,
    producer, implementations: input.toolImplementations ?? []
  });
  const contextCompiler = createContextMessageCompiler(store, {
    workspace, ledger, artifactRegistry: artifacts, policyBoundary: policy, skillRegistry: skills,
    growUnitManager: grow, admissionInbox: admission, agendaDoDManager: agenda, producer, defaultBudgetTokens: 8_000
  });
  const llmGateway = createLLMGateway({
    workspace, ledger, artifactRegistry: artifacts, policyBoundary: policy,
    contextCompiler, producer, adapters: [adapter]
  });
  const attemptRunner = createGrowAttemptRunner({
    workspace, store, ledger, artifactRegistry: artifacts, policyBoundary: policy, growUnitManager: grow,
    admissionInbox: admission, agendaDoDManager: agenda, contextCompiler, llmGateway, toolRuntime, producer
  });
  const agentRuntimeKernel = createAgentRuntimeKernel({
    workspace, store, ledger, artifactRegistry: artifacts, policyBoundary: policy, runtimeContractRegistry: contracts,
    hatchBuilder: hatch, llmGateway, toolRuntime, targetWorldAdapter: target, producer, runtimeKernelVersion: `${producer}@1`
  });
  const debugFeedbackBridge = createDebugFeedbackBridge({
    workspace, store, ledger, artifactRegistry: artifacts, policyBoundary: policy, skillRegistry: skills,
    runtimeContractRegistry: contracts, hatchBuilder: hatch, targetWorldAdapter: target,
    agentRuntimeKernel, admissionInbox: admission, producer
  });

  const ports: CLIPorts = {
    store, ledger, artifactRegistry: artifacts, policyBoundary: policy, skillRegistry: skills,
    growUnitManager: grow, admissionInbox: admission, agendaManager: agenda, evidenceReadiness: evidence,
    attemptRunner, hatchBuilder: hatch, agentRuntimeKernel, debugFeedbackBridge
  };
  const cli = createFengCli({
    ports,
    producer,
    defaultModelSelection: { provider: input.config.provider.provider, model: input.config.provider.model }
  }, input.config.workspaceRoot);

  return {
    config: input.config, workspace, store, ledger, artifacts, policy, skills, grow, admission, agenda,
    evidence, contracts, hatch, target, toolRuntime, llmGateway, contextCompiler, attemptRunner,
    agentRuntimeKernel, debugFeedbackBridge, adapter, ports, cli
  };
}

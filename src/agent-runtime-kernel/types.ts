import type {
  ArtifactRef,
  AuditDescriptor,
  HatchPackageRef,
  MessageListRef,
  PolicyDecisionId,
  PrivacyLevel,
  RuntimeContractRef,
  SourceDescriptor,
  TargetWorldRef,
  VersionDescriptor
} from "../domain/index.js";
import type { Result } from "../domain/result.js";
import type { WorkspaceHandle, FileNativeStore, WriteReceipt } from "../file-store/index.js";
import type { ArtifactRegistry } from "../artifact-registry/index.js";
import type { EventAppendReceipt, EventLedger } from "../event-ledger/index.js";
import type { PolicyBoundary, PolicyContext } from "../policy-boundary/index.js";
import type {
  LLMGateway,
  LLMModelSelection,
  LLMRequestId,
  LLMRequiredCapabilities,
  NormalizedLLMResponse,
  RetryPolicy,
  FallbackPolicy
} from "../llm-gateway/index.js";
import type {
  JsonValue,
  ToolCallId,
  ToolCatalogQuery,
  ToolRuntime,
  ToolSettlement
} from "../tool-runtime/index.js";
import type { HatchBuilder } from "../hatch-builder/index.js";
import type { RuntimeContractRegistry } from "../runtime-contract-registry/index.js";
import type {
  ExternalEnforcementDeclaration,
  TargetActionRequestRef,
  TargetDebugSignalRef,
  TargetFailureMappingRef,
  TargetWorldAdapter,
  WorldInputEnvelopeRef,
  WorldOutputEnvelopeRef,
  WorldOutputKind
} from "../target-world-adapter/index.js";
import type {
  RuntimeFeedbackCandidateHintId,
  RuntimeInvocationId,
  RuntimeOutputId,
  RuntimeTraceId,
  RuntimeTurnId,
  ShortTermContextId,
  LongTermMemoryReadId
} from "./brand.js";
import type {
  LongTermMemoryReadRef,
  RuntimeFeedbackCandidateHintRef,
  RuntimeInvocationRef,
  RuntimeOutputRef,
  RuntimeTraceRef,
  RuntimeTurnRef,
  ShortTermContextRef
} from "./refs.js";
import type { RuntimeMessageListExplanation } from "./message-types.js";
export type {
  RuntimeBudgetReport,
  RuntimeExclusionList,
  RuntimeMessageListExplanation,
  RuntimeMessageListRecord,
  RuntimeMessageSection,
  RuntimeMessageSectionKind,
  RuntimeSourceMap
} from "./message-types.js";

export type RuntimeMode = "production" | "debug" | "dry_run" | "replay";
export type RuntimeInvocationStatus =
  | "created" | "running" | "waiting_tool" | "waiting_target" | "completed"
  | "failed" | "cancelled" | "interrupted";
export type RuntimeTurnStatus =
  | "created" | "message_compiled" | "llm_completed" | "tool_settled"
  | "output_recorded" | "completed" | "failed" | "dry_run";
export type RuntimeOutputStatus =
  | "candidate" | "contract_valid" | "contract_invalid" | "dispatched" | "failed" | "redacted";

export interface ProductionVersionLock {
  readonly hatchPackageRef: HatchPackageRef;
  readonly runtimeContractRef: RuntimeContractRef;
  readonly runtimeKernelVersion: string;
  readonly packageResourceHashes: readonly string[];
  readonly skillVersionSummaries: readonly string[];
  readonly lockedAt: string;
}

export interface RuntimeInvocation {
  readonly runtimeInvocationId: RuntimeInvocationId;
  readonly runtimeInvocationRef: RuntimeInvocationRef;
  readonly hatchPackageRef: HatchPackageRef;
  readonly runtimeContractRef: RuntimeContractRef;
  readonly targetWorldRef: TargetWorldRef;
  readonly mode: RuntimeMode;
  readonly status: RuntimeInvocationStatus;
  readonly worldInputRefs: readonly WorldInputEnvelopeRef[];
  readonly runtimeMessageListRefs: readonly MessageListRef[];
  readonly llmRequestRefs: readonly LLMRequestId[];
  readonly providerReceiptRefs: readonly ArtifactRef[];
  readonly toolSettlementRefs: readonly ArtifactRef[];
  readonly targetActionRequestRefs: readonly TargetActionRequestRef[];
  readonly runtimeOutputRefs: readonly RuntimeOutputRef[];
  readonly runtimeTraceRef?: RuntimeTraceRef;
  readonly feedbackCandidateHintRefs: readonly RuntimeFeedbackCandidateHintRef[];
  readonly shortTermContextRef: ShortTermContextRef;
  readonly longTermMemoryReadRefs: readonly LongTermMemoryReadRef[];
  readonly modelSelection: LLMModelSelection;
  readonly requiredCapabilities: LLMRequiredCapabilities;
  readonly toolCatalogQuery?: ToolCatalogQuery;
  readonly productionLock?: ProductionVersionLock;
  readonly maxTurns: number;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly correlationId?: string;
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
  readonly recordVersion: number;
}

export interface ShortTermContext {
  readonly shortTermContextId: ShortTermContextId;
  readonly shortTermContextRef: ShortTermContextRef;
  readonly runtimeInvocationRef: RuntimeInvocationRef;
  readonly turnRefs: readonly RuntimeTurnRef[];
  readonly worldInputRefs: readonly WorldInputEnvelopeRef[];
  readonly runtimeOutputRefs: readonly RuntimeOutputRef[];
  readonly toolSettlementRefs: readonly ArtifactRef[];
  readonly targetActionRefs: readonly TargetActionRequestRef[];
  readonly summary: string;
  readonly retentionPolicy: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly updatedAt: string;
  readonly recordVersion: number;
}

export interface LongTermMemoryRead {
  readonly memoryReadId: LongTermMemoryReadId;
  readonly memoryReadRef: LongTermMemoryReadRef;
  readonly hatchPackageRef: HatchPackageRef;
  readonly runtimeContractRef: RuntimeContractRef;
  readonly sourceArtifactRefs: readonly ArtifactRef[];
  readonly scope: string;
  readonly summary: string;
  readonly policyDecisionId?: PolicyDecisionId;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly createdAt: string;
}

export interface RuntimeTurn {
  readonly runtimeTurnId: RuntimeTurnId;
  readonly runtimeTurnRef: RuntimeTurnRef;
  readonly runtimeInvocationRef: RuntimeInvocationRef;
  readonly turnIndex: number;
  readonly worldInputRef: WorldInputEnvelopeRef;
  readonly runtimeMessageListRef: MessageListRef;
  readonly llmRequestRef?: LLMRequestId;
  readonly providerReceiptRef?: ArtifactRef;
  readonly toolCallRefs: readonly ToolCallId[];
  readonly toolSettlementRefs: readonly ArtifactRef[];
  readonly targetActionRequestRefs: readonly TargetActionRequestRef[];
  readonly runtimeOutputRef?: RuntimeOutputRef;
  readonly status: RuntimeTurnStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface RuntimeOutput {
  readonly runtimeOutputId: RuntimeOutputId;
  readonly runtimeOutputRef: RuntimeOutputRef;
  readonly runtimeInvocationRef: RuntimeInvocationRef;
  readonly runtimeTurnRef: RuntimeTurnRef;
  readonly runtimeContractRef: RuntimeContractRef;
  readonly worldOutputEnvelopeRef: WorldOutputEnvelopeRef;
  readonly artifactRef: ArtifactRef;
  readonly status: RuntimeOutputStatus;
  readonly validationSummary: string;
  readonly privacyClass: PrivacyLevel;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly createdAt: string;
  readonly recordVersion: number;
}

export interface RuntimeTrace {
  readonly runtimeTraceId: RuntimeTraceId;
  readonly runtimeTraceRef: RuntimeTraceRef;
  readonly runtimeInvocationRef: RuntimeInvocationRef;
  readonly hatchPackageRef: HatchPackageRef;
  readonly runtimeContractRef: RuntimeContractRef;
  readonly targetWorldRef: TargetWorldRef;
  readonly turnRefs: readonly RuntimeTurnRef[];
  readonly runtimeMessageListRefs: readonly MessageListRef[];
  readonly providerReceiptRefs: readonly ArtifactRef[];
  readonly toolSettlementRefs: readonly ArtifactRef[];
  readonly targetActionRequestRefs: readonly TargetActionRequestRef[];
  readonly runtimeOutputRefs: readonly RuntimeOutputRef[];
  readonly debugSignalRefs: readonly TargetDebugSignalRef[];
  readonly failureMappingRefs: readonly TargetFailureMappingRef[];
  readonly artifactRef: ArtifactRef;
  readonly contentHash: string;
  readonly privacyClass: PrivacyLevel;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly createdAt: string;
  readonly recordVersion: number;
}

export interface RuntimeFeedbackCandidateHint {
  readonly hintId: RuntimeFeedbackCandidateHintId;
  readonly hintRef: RuntimeFeedbackCandidateHintRef;
  readonly runtimeInvocationRef: RuntimeInvocationRef;
  readonly runtimeTraceRef: RuntimeTraceRef;
  readonly targetWorldRef: TargetWorldRef;
  readonly summary: string;
  readonly attributionHint: string;
  readonly evidenceRefs: readonly ArtifactRef[];
  readonly privacyClass: PrivacyLevel;
  readonly debugModeOnly: boolean;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly createdAt: string;
  readonly recordVersion: number;
}

export interface StartRuntimeInvocationInput {
  readonly hatchPackageRef: HatchPackageRef;
  readonly targetWorldRef: TargetWorldRef;
  readonly mode: RuntimeMode;
  readonly modelSelection: LLMModelSelection;
  readonly requiredCapabilities?: LLMRequiredCapabilities;
  readonly toolCatalogQuery?: ToolCatalogQuery;
  readonly longTermMemoryArtifactRefs?: readonly ArtifactRef[];
  readonly maxTurns?: number;
  readonly correlationId?: string;
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
}

export interface RuntimeTurnOptions {
  readonly policyContext?: PolicyContext;
  readonly outputKind?: WorldOutputKind;
  readonly dispatchTargetActions?: boolean;
  readonly externalEnforcement?: ExternalEnforcementDeclaration;
  readonly maxToolCalls?: number;
  readonly timeoutMs?: number;
  readonly retryPolicy?: RetryPolicy;
  readonly fallbackPolicy?: FallbackPolicy;
  readonly replayResponse?: NormalizedLLMResponse;
}

export interface RuntimeInvocationReceipt {
  readonly runtimeInvocationRef: RuntimeInvocationRef;
  readonly from: RuntimeInvocationStatus;
  readonly to: RuntimeInvocationStatus;
  readonly reason: string;
  readonly traceRef?: RuntimeTraceRef;
  readonly recordWriteReceipt?: WriteReceipt;
  readonly eventReceipt?: EventAppendReceipt;
}

export interface RuntimeInvocationExplanation {
  readonly runtimeInvocationRef: RuntimeInvocationRef;
  readonly summary: string;
  readonly facts: readonly string[];
  readonly traceRef?: RuntimeTraceRef;
}

export interface RuntimeFeedbackCandidateHintPage {
  readonly records: readonly RuntimeFeedbackCandidateHint[];
  readonly total: number;
}

export interface TargetActionCandidate {
  readonly actionKind: string;
  readonly actionPayload: unknown;
  readonly resourceSummary: string;
  readonly requiredCapabilities?: readonly string[];
}

export interface AgentRuntimeKernelOptions {
  readonly workspace: WorkspaceHandle;
  readonly store: FileNativeStore;
  readonly ledger: EventLedger;
  readonly artifactRegistry: ArtifactRegistry;
  readonly policyBoundary: PolicyBoundary;
  readonly runtimeContractRegistry: RuntimeContractRegistry;
  readonly hatchBuilder: HatchBuilder;
  readonly llmGateway: LLMGateway;
  readonly toolRuntime: ToolRuntime;
  readonly targetWorldAdapter: TargetWorldAdapter;
  readonly producer: string;
  readonly runtimeKernelVersion?: string;
  readonly defaultBudgetTokens?: number;
}

export interface AgentRuntimeKernel {
  readonly startRuntimeInvocation: (input: StartRuntimeInvocationInput) => Promise<Result<RuntimeInvocationRef>>;
  readonly runRuntimeTurn: (
    invocationRef: RuntimeInvocationRef,
    worldInputRef: WorldInputEnvelopeRef,
    options?: RuntimeTurnOptions
  ) => Promise<Result<RuntimeTurn>>;
  readonly completeRuntimeInvocation: (
    invocationRef: RuntimeInvocationRef,
    reason: string
  ) => Promise<Result<RuntimeInvocationReceipt>>;
  readonly cancelRuntimeInvocation: (
    invocationRef: RuntimeInvocationRef,
    reason: string
  ) => Promise<Result<RuntimeInvocationReceipt>>;
  readonly compileRuntimeMessageList: (
    input: { readonly invocationRef: RuntimeInvocationRef; readonly turnRef: RuntimeTurnRef; readonly worldInputRef: WorldInputEnvelopeRef }
  ) => Promise<Result<MessageListRef>>;
  readonly explainRuntimeMessageList: (ref: MessageListRef) => Promise<Result<RuntimeMessageListExplanation>>;
  readonly recordRuntimeTrace: (invocationRef: RuntimeInvocationRef) => Promise<Result<RuntimeTraceRef>>;
  readonly readRuntimeTrace: (
    ref: RuntimeTraceRef,
    options?: { readonly policyContext?: PolicyContext; readonly reason?: string }
  ) => Promise<Result<RuntimeTrace>>;
  readonly explainRuntimeInvocation: (ref: RuntimeInvocationRef) => Promise<Result<RuntimeInvocationExplanation>>;
  readonly recordFeedbackCandidateHint: (
    input: Omit<RuntimeFeedbackCandidateHint, "hintId" | "hintRef" | "createdAt" | "recordVersion">
  ) => Promise<Result<RuntimeFeedbackCandidateHintRef>>;
  readonly listFeedbackCandidateHints: (
    invocationRef: RuntimeInvocationRef
  ) => Promise<Result<RuntimeFeedbackCandidateHintPage>>;
}

export interface RefIndex<T> { readonly refs: readonly T[]; }
export interface MessageListIndex { readonly refs: readonly MessageListRef[]; }

import type { BrandedString } from "../domain/brand.js";
import type {
  ArtifactRef,
  AttemptId,
  AttemptLifecycle,
  AttemptRef,
  AuditDescriptor,
  DomainRef,
  GrowUnitRef,
  MessageListRef,
  PolicyDecisionId,
  PrivacyLevel,
  SourceDescriptor,
  VersionDescriptor
} from "../domain/index.js";
import type { Result } from "../domain/result.js";
import type { ArtifactRegistry, RetentionClass } from "../artifact-registry/index.js";
import type { EventAppendReceipt, EventLedger } from "../event-ledger/index.js";
import type { FileNativeStore, WorkspaceHandle, WriteReceipt } from "../file-store/index.js";
import type { PolicyBoundary, PolicyContext } from "../policy-boundary/index.js";
import type { GrowUnitManager, GrowUnitStateSnapshot } from "../grow-unit-manager/index.js";
import type { AdmissionFeedbackInbox, AdmissionSummary } from "../admission-feedback-inbox/index.js";
import type {
  AgendaDoDManager,
  AgendaSummary,
  AttemptIntentRecord,
  AttemptIntentRef,
  DoDRef,
  GapRef
} from "../agenda-dod-manager/index.js";
import type { ContextMessageCompiler, ToolSurfaceSummary as ContextToolSurfaceSummary } from "../context-message-compiler/index.js";
import type {
  LLMGateway,
  LLMModelSelection,
  LLMRequiredCapabilities,
  LLMRequestId,
  NormalizedLLMResponse,
  NormalizedStreamEvent
} from "../llm-gateway/index.js";
import type {
  ToolCallId,
  ToolCatalogQuery,
  ToolRuntime,
  ToolSettlement
} from "../tool-runtime/index.js";

export type AttemptInputSnapshotId = BrandedString<"AttemptInputSnapshotId">;
export type AttemptExecutionPlanId = BrandedString<"AttemptExecutionPlanId">;
export type AttemptTurnId = BrandedString<"AttemptTurnId">;
export type CandidateOutputId = BrandedString<"CandidateOutputId">;
export type AttemptCheckpointId = BrandedString<"AttemptCheckpointId">;
export type AttemptTraceId = BrandedString<"AttemptTraceId">;
export type AttemptOutcomeSummaryId = BrandedString<"AttemptOutcomeSummaryId">;

export interface AttemptInputSnapshotRef { readonly kind: "attempt_input_snapshot"; readonly id: AttemptInputSnapshotId; readonly uri?: string; }
export interface AttemptExecutionPlanRef { readonly kind: "attempt_execution_plan"; readonly id: AttemptExecutionPlanId; readonly uri?: string; }
export interface AttemptTurnRef { readonly kind: "attempt_turn"; readonly id: AttemptTurnId; readonly uri?: string; }
export interface CandidateOutputRef { readonly kind: "candidate_output"; readonly id: CandidateOutputId; readonly uri?: string; }
export interface AttemptCheckpointRef { readonly kind: "attempt_checkpoint"; readonly id: AttemptCheckpointId; readonly uri?: string; }
export interface AttemptOutcomeSummaryRef { readonly kind: "attempt_outcome_summary"; readonly id: AttemptOutcomeSummaryId; readonly uri?: string; }

export type AttemptLocalRef =
  | AttemptInputSnapshotRef
  | AttemptExecutionPlanRef
  | AttemptTurnRef
  | CandidateOutputRef
  | AttemptCheckpointRef
  | AttemptOutcomeSummaryRef;

export type AttemptExitReason =
  | "completed_no_tool_calls"
  | "completed_after_tool_settlement"
  | "stop_condition_reached"
  | "max_turns_reached"
  | "max_tool_calls_reached"
  | "context_compile_failed"
  | "llm_failed"
  | "tool_failed"
  | "policy_blocked"
  | "approval_required"
  | "input_invalid"
  | "retry_budget_exhausted"
  | "cancelled_by_user"
  | "interrupted_by_process"
  | "artifact_unavailable"
  | "unknown_failure";

export interface AttemptRecord {
  readonly attemptId: AttemptId;
  readonly attemptRef: AttemptRef;
  readonly growUnitRef: GrowUnitRef;
  readonly attemptIntentRef: AttemptIntentRef;
  readonly status: AttemptLifecycle;
  readonly executionPlanRef?: AttemptExecutionPlanRef;
  readonly inputSnapshotRef?: AttemptInputSnapshotRef;
  readonly turnRefs: readonly AttemptTurnRef[];
  readonly checkpointRefs: readonly AttemptCheckpointRef[];
  readonly messageListRefs: readonly MessageListRef[];
  readonly llmRequestRefs: readonly LLMRequestId[];
  readonly providerReceiptRefs: readonly ArtifactRef[];
  readonly toolCallRefs: readonly ToolCallId[];
  readonly toolSettlementRefs: readonly ArtifactRef[];
  readonly candidateOutputRefs: readonly CandidateOutputRef[];
  readonly attemptTraceRef?: ArtifactRef;
  readonly outcomeSummaryRef?: AttemptOutcomeSummaryRef;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly exitReason?: AttemptExitReason;
  readonly correlationId?: string;
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
  readonly recordVersion: number;
  readonly modelSelectionHint?: LLMModelSelection;
  readonly requiredCapabilitiesHint?: LLMRequiredCapabilities;
  readonly toolCatalogQueryHint?: ToolCatalogQuery;
}

export interface AttemptInputSnapshot {
  readonly snapshotId: AttemptInputSnapshotId;
  readonly snapshotRef: AttemptInputSnapshotRef;
  readonly attemptRef: AttemptRef;
  readonly growUnitSnapshotRef: ArtifactRef;
  readonly admissionSummaryRef: ArtifactRef;
  readonly agendaSummaryRef: ArtifactRef;
  readonly attemptIntentRef: AttemptIntentRef;
  readonly activeDoDRefs: readonly DoDRef[];
  readonly openGapRefs: readonly GapRef[];
  readonly toolSurfaceSummaryRef: ArtifactRef;
  readonly skillCandidateSummaryRef: ArtifactRef;
  readonly policyBoundarySummaryRef: ArtifactRef;
  readonly artifactCandidateRefs: readonly ArtifactRef[];
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
  readonly createdAt: string;
}

export interface AttemptTimeoutPolicy {
  readonly attemptTimeoutMs?: number;
  readonly turnTimeoutMs?: number;
  readonly toolTimeoutMs?: number;
}

export interface AttemptRetryPolicy {
  readonly maxRetries: number;
  readonly retryOnExitReasons: readonly AttemptExitReason[];
}

export interface AttemptToolUsePolicy {
  readonly mode: "allow_model_tool_calls" | "disable_model_tool_calls";
  readonly continueAfterToolFailure: boolean;
}

export type AttemptStreamingPreference = "disabled" | "preferred";

export interface AttemptExecutionPlan {
  readonly executionPlanId: AttemptExecutionPlanId;
  readonly executionPlanRef: AttemptExecutionPlanRef;
  readonly attemptRef: AttemptRef;
  readonly attemptIntentRef: AttemptIntentRef;
  readonly modelSelection: LLMModelSelection;
  readonly requiredCapabilities: LLMRequiredCapabilities;
  readonly modelRequirementSummary: string;
  readonly toolUsePolicy: AttemptToolUsePolicy;
  readonly maxTurns: number;
  readonly maxToolCalls: number;
  readonly timeoutPolicy: AttemptTimeoutPolicy;
  readonly retryPolicy: AttemptRetryPolicy;
  readonly streamingPreference: AttemptStreamingPreference;
  readonly stopCondition: string;
  readonly toolCatalogQuery: ToolCatalogQuery;
  readonly policyDecisionRefs: readonly PolicyDecisionId[];
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly createdAt: string;
}

export type AttemptTurnStatus =
  | "compiled"
  | "calling_llm"
  | "waiting_tool"
  | "settled"
  | "completed"
  | "failed"
  | "interrupted"
  | "cancelled";

export interface AttemptTurnRecord {
  readonly turnId: AttemptTurnId;
  readonly turnRef: AttemptTurnRef;
  readonly attemptRef: AttemptRef;
  readonly turnIndex: number;
  readonly messageListRef: MessageListRef;
  readonly llmRequestRef?: LLMRequestId;
  readonly providerReceiptRef?: ArtifactRef;
  readonly normalizedResponseRef?: ArtifactRef;
  readonly toolCallRefs: readonly ToolCallId[];
  readonly toolSettlementRefs: readonly ArtifactRef[];
  readonly candidateOutputRefs: readonly CandidateOutputRef[];
  readonly status: AttemptTurnStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export type CandidateOutputKind =
  | "model_text"
  | "structured_output"
  | "file_patch_candidate"
  | "runtime_contract_candidate"
  | "skill_candidate"
  | "tool_plan_candidate"
  | "validation_instruction_candidate"
  | "unknown";

export interface CandidateOutputRecord {
  readonly candidateOutputId: CandidateOutputId;
  readonly candidateOutputRef: CandidateOutputRef;
  readonly attemptRef: AttemptRef;
  readonly growUnitRef: GrowUnitRef;
  readonly sourceTurnRef: AttemptTurnRef;
  readonly artifactRef: ArtifactRef;
  readonly kind: CandidateOutputKind;
  readonly summary: string;
  readonly parentRefs: readonly ArtifactRef[];
  readonly privacyClass: PrivacyLevel;
  readonly retentionClass: RetentionClass;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly createdAt: string;
}

export type AttemptCheckpointPhase =
  | "after_snapshot"
  | "after_compile"
  | "after_llm_response"
  | "after_tool_settlement"
  | "after_candidate_output"
  | "before_retry"
  | "before_interrupt"
  | "final";

export interface AttemptCheckpoint {
  readonly checkpointId: AttemptCheckpointId;
  readonly checkpointRef: AttemptCheckpointRef;
  readonly attemptRef: AttemptRef;
  readonly phase: AttemptCheckpointPhase;
  readonly status: AttemptLifecycle;
  readonly lastCompletedTurnRef?: AttemptTurnRef;
  readonly latestMessageListRef?: MessageListRef;
  readonly latestProviderReceiptRef?: ArtifactRef;
  readonly latestToolSettlementRefs: readonly ArtifactRef[];
  readonly latestCandidateOutputRefs: readonly CandidateOutputRef[];
  readonly traceFragmentRef?: ArtifactRef;
  readonly resumeInstructionSummary: string;
  readonly createdAt: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface AttemptTraceArtifact {
  readonly attemptTraceId: AttemptTraceId;
  readonly attemptRef: AttemptRef;
  readonly growUnitRef: GrowUnitRef;
  readonly inputSnapshotRef?: AttemptInputSnapshotRef;
  readonly executionPlanRef?: AttemptExecutionPlanRef;
  readonly turnRefs: readonly AttemptTurnRef[];
  readonly checkpointRefs: readonly AttemptCheckpointRef[];
  readonly eventRefs: readonly string[];
  readonly messageListRefs: readonly MessageListRef[];
  readonly providerReceiptRefs: readonly ArtifactRef[];
  readonly toolSettlementRefs: readonly ArtifactRef[];
  readonly candidateOutputRefs: readonly CandidateOutputRef[];
  readonly exitReason?: AttemptExitReason;
  readonly contentHash: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface AttemptOutcomeSummary {
  readonly outcomeSummaryId: AttemptOutcomeSummaryId;
  readonly outcomeSummaryRef: AttemptOutcomeSummaryRef;
  readonly attemptRef: AttemptRef;
  readonly growUnitRef: GrowUnitRef;
  readonly status: AttemptLifecycle;
  readonly exitReason: AttemptExitReason;
  readonly completedTurnCount: number;
  readonly candidateOutputRefs: readonly CandidateOutputRef[];
  readonly toolSettlementRefs: readonly ArtifactRef[];
  readonly providerReceiptRefs: readonly ArtifactRef[];
  readonly attemptTraceRef: ArtifactRef;
  readonly observedIssueSummaries: readonly string[];
  readonly evidenceCandidateRefs: readonly ArtifactRef[];
  readonly nextModuleHints: readonly string[];
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly createdAt: string;
}

export interface CreateAttemptInput {
  readonly growUnitRef: GrowUnitRef;
  readonly attemptIntentRef: AttemptIntentRef;
  readonly modelSelection?: LLMModelSelection;
  readonly requiredCapabilities?: LLMRequiredCapabilities;
  readonly toolCatalogQuery?: ToolCatalogQuery;
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
  readonly correlationId?: string;
}

export interface RunAttemptOptions {
  readonly policyContext: PolicyContext;
  readonly modelSelection?: LLMModelSelection;
  readonly requiredCapabilities?: LLMRequiredCapabilities;
  readonly toolCatalogQuery?: ToolCatalogQuery;
  readonly maxTurns?: number;
  readonly maxToolCalls?: number;
  readonly timeoutPolicy?: AttemptTimeoutPolicy;
  readonly retryPolicy?: Partial<AttemptRetryPolicy>;
  readonly streamingPreference?: AttemptStreamingPreference;
  readonly toolUsePolicy?: Partial<AttemptToolUsePolicy>;
  readonly source?: SourceDescriptor;
  readonly version?: VersionDescriptor;
  readonly audit?: AuditDescriptor;
  readonly correlationId?: string;
}

export interface AttemptPage {
  readonly records: readonly AttemptRecord[];
  readonly total: number;
  readonly nextCursor?: string;
  readonly truncated: boolean;
}

export interface AttemptQuery {
  readonly growUnitRef?: GrowUnitRef;
  readonly status?: AttemptLifecycle;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface AttemptExplanation {
  readonly attemptRef: AttemptRef;
  readonly summary: string;
  readonly facts: readonly string[];
  readonly latestCheckpoint?: AttemptCheckpoint;
  readonly traceRef?: ArtifactRef;
}

export interface GrowAttemptRunnerOptions {
  readonly workspace: WorkspaceHandle;
  readonly store: FileNativeStore;
  readonly ledger: EventLedger;
  readonly artifactRegistry: ArtifactRegistry;
  readonly policyBoundary: PolicyBoundary;
  readonly growUnitManager: GrowUnitManager;
  readonly admissionInbox: AdmissionFeedbackInbox;
  readonly agendaDoDManager: AgendaDoDManager;
  readonly contextCompiler: ContextMessageCompiler;
  readonly llmGateway: LLMGateway;
  readonly toolRuntime: ToolRuntime;
  readonly producer: string;
}

export interface GrowAttemptRunner {
  readonly createAttempt: (input: CreateAttemptInput) => Promise<Result<AttemptRef>>;
  readonly runAttempt: (attemptRef: AttemptRef, options: RunAttemptOptions) => Promise<Result<AttemptOutcomeSummary>>;
  readonly resumeAttempt: (attemptRef: AttemptRef, options: RunAttemptOptions) => Promise<Result<AttemptOutcomeSummary>>;
  readonly cancelAttempt: (attemptRef: AttemptRef, reason: string) => Promise<Result<AttemptRecord>>;
  readonly interruptAttempt: (attemptRef: AttemptRef, reason: string) => Promise<Result<AttemptCheckpoint>>;
  readonly readAttempt: (attemptRef: AttemptRef) => Promise<Result<AttemptRecord>>;
  readonly readAttemptTrace: (attemptRef: AttemptRef) => Promise<Result<AttemptTraceArtifact>>;
  readonly listAttempts: (query?: AttemptQuery) => Promise<Result<AttemptPage>>;
  readonly explainAttempt: (attemptRef: AttemptRef) => Promise<Result<AttemptExplanation>>;
}

export interface AttemptIndex { readonly attemptRefs: readonly AttemptRef[]; }

export interface AttemptPreparedInputs {
  readonly growUnitSnapshot: GrowUnitStateSnapshot;
  readonly admissionSummary: AdmissionSummary;
  readonly agendaSummary: AgendaSummary;
  readonly attemptIntent: AttemptIntentRecord;
  readonly toolSurfaceRef: ArtifactRef;
  readonly contextToolSurface: readonly ContextToolSurfaceSummary[];
  readonly toolSettlementArtifacts: readonly ArtifactRef[];
  readonly domainSourceRefs: readonly DomainRef[];
}

export interface LLMCallResult {
  readonly requestId: LLMRequestId;
  readonly response: NormalizedLLMResponse;
  readonly streamEvents: readonly NormalizedStreamEvent[];
}

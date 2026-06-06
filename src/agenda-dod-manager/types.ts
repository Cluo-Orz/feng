import type { BrandedString } from "../domain/brand.js";
import type {
  ArtifactRef,
  AuditDescriptor,
  FeedbackUnitRef,
  GrowLifecycle,
  GrowUnitRef,
  PolicyDecisionId,
  SkillRef,
  SourceDescriptor,
  VersionDescriptor
} from "../domain/index.js";
import type { Result } from "../domain/result.js";
import type { EventAppendReceipt, EventLedger } from "../event-ledger/index.js";
import type { FileNativeStore, WorkspaceHandle, WriteReceipt } from "../file-store/index.js";
import type { ArtifactRegistry } from "../artifact-registry/index.js";
import type { PolicyBoundary } from "../policy-boundary/index.js";
import type { SkillRegistry } from "../skill-registry/index.js";
import type { GrowUnitManager } from "../grow-unit-manager/index.js";
import type {
  AdmissionFeedbackInbox,
  InboxItemRef,
  UpstreamProposalRef
} from "../admission-feedback-inbox/index.js";

export type AgendaId = BrandedString<"AgendaId">;
export type AgendaItemId = BrandedString<"AgendaItemId">;
export type GapId = BrandedString<"GapId">;
export type DoDId = BrandedString<"DoDId">;
export type AttemptIntentId = BrandedString<"AttemptIntentId">;

export interface AgendaRef { readonly kind: "agenda"; readonly id: AgendaId; readonly uri?: string; }
export interface AgendaItemRef { readonly kind: "agenda_item"; readonly id: AgendaItemId; readonly uri?: string; }
export interface GapRef { readonly kind: "gap"; readonly id: GapId; readonly uri?: string; }
export interface DoDRef { readonly kind: "dod"; readonly id: DoDId; readonly uri?: string; }
export interface AttemptIntentRef { readonly kind: "attempt_intent"; readonly id: AttemptIntentId; readonly uri?: string; }

export type AgendaInputRef = ArtifactRef | InboxItemRef | FeedbackUnitRef | UpstreamProposalRef;

export const agendaItemKinds = [
  "clarify_goal",
  "collect_material",
  "define_target_world",
  "define_runtime_contract",
  "produce_candidate",
  "inspect_feedback",
  "validate_candidate",
  "revise_skill_or_context",
  "prepare_hatch",
  "resolve_privacy_or_policy"
] as const;
export type AgendaItemKind = (typeof agendaItemKinds)[number];

export const agendaItemStatuses = [
  "proposed",
  "active",
  "waiting_input",
  "waiting_policy",
  "waiting_feedback",
  "waiting_validation",
  "blocked",
  "completed_for_now",
  "rejected",
  "superseded",
  "retired"
] as const;
export type AgendaItemStatus = (typeof agendaItemStatuses)[number];

export const gapKinds = [
  "missing_goal_boundary",
  "missing_material",
  "missing_permission",
  "missing_policy_decision",
  "missing_validation_environment",
  "target_world_contract_incomplete",
  "runtime_contract_incomplete",
  "candidate_failure",
  "evidence_insufficient",
  "privacy_unknown",
  "version_incompatible"
] as const;
export type GapKind = (typeof gapKinds)[number];

export const gapStatuses = [
  "open",
  "waiting_input",
  "waiting_policy",
  "waiting_validation",
  "retrying",
  "blocked",
  "resolved_for_now",
  "rejected",
  "superseded"
] as const;
export type GapStatus = (typeof gapStatuses)[number];

export const dodLifecycles = ["proposed", "active", "blocked", "retired", "superseded", "incompatible"] as const;
export type DoDLifecycle = (typeof dodLifecycles)[number];

export type Priority = "low" | "medium" | "high" | "critical";

export interface RetryPolicy {
  readonly attemptCount: number;
  readonly retryLimit: number;
  readonly onLimit: "block" | "wait_input" | "wait_validation";
}

export interface AgendaRecord {
  readonly agendaId: AgendaId;
  readonly agendaRef: AgendaRef;
  readonly growUnitRef: GrowUnitRef;
  readonly goalBoundarySummary: string;
  readonly currentFocus: string;
  readonly agendaItemRefs: readonly AgendaItemRef[];
  readonly gapRefs: readonly GapRef[];
  readonly dodRefs: readonly DoDRef[];
  readonly attemptIntentRef?: AttemptIntentRef;
  readonly latestEvaluationRefs: readonly ArtifactRef[];
  readonly recommendedGrowState?: GrowLifecycle;
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly recordVersion: number;
}

export interface AgendaItemRecord {
  readonly agendaItemId: AgendaItemId;
  readonly agendaItemRef: AgendaItemRef;
  readonly growUnitRef: GrowUnitRef;
  readonly kind: AgendaItemKind;
  readonly status: AgendaItemStatus;
  readonly summary: string;
  readonly reason: string;
  readonly inputRefs: readonly AgendaInputRef[];
  readonly relatedGapRefs: readonly GapRef[];
  readonly relatedDoDRefs: readonly DoDRef[];
  readonly expectedOutput: string;
  readonly evidenceRequirementRefs: readonly ArtifactRef[];
  readonly attemptIntentRefs: readonly AttemptIntentRef[];
  readonly priority: Priority;
  readonly retryPolicy: RetryPolicy;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly recordVersion: number;
}

export interface GapRecord {
  readonly gapId: GapId;
  readonly gapRef: GapRef;
  readonly growUnitRef: GrowUnitRef;
  readonly kind: GapKind;
  readonly status: GapStatus;
  readonly summary: string;
  readonly requiredInput: string;
  readonly requiredEvidence: string;
  readonly blockingReason: string;
  readonly relatedAdmissionRefs: readonly InboxItemRef[];
  readonly relatedFeedbackRefs: readonly FeedbackUnitRef[];
  readonly relatedPolicyDecisionRefs: readonly PolicyDecisionId[];
  readonly attemptCount: number;
  readonly retryLimit: number;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly recordVersion: number;
}

export interface DoDItemRecord {
  readonly dodId: DoDId;
  readonly dodRef: DoDRef;
  readonly growUnitRef: GrowUnitRef;
  readonly statement: string;
  readonly scope: string;
  readonly evidenceRequirement: string;
  readonly validationIntent: string;
  readonly targetWorldSummaryRef?: ArtifactRef;
  readonly relatedAgendaItemRefs: readonly AgendaItemRef[];
  readonly relatedGapRefs: readonly GapRef[];
  readonly latestEvaluationRef?: ArtifactRef;
  readonly lifecycle: DoDLifecycle;
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly recordVersion: number;
}

export interface AttemptIntentRecord {
  readonly attemptIntentId: AttemptIntentId;
  readonly attemptIntentRef: AttemptIntentRef;
  readonly growUnitRef: GrowUnitRef;
  readonly purpose: string;
  readonly focusAgendaItemRefs: readonly AgendaItemRef[];
  readonly inputCandidateRefs: readonly AgendaInputRef[];
  readonly requiredContextRefs: readonly ArtifactRef[];
  readonly visibleSkillScopeSummary: readonly ActiveSkillSummary[];
  readonly toolNeedSummary: string;
  readonly policyBoundarySummary: string;
  readonly expectedOutputs: readonly string[];
  readonly expectedEvidence: readonly string[];
  readonly stopCondition: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly createdAt: string;
}

export interface ActiveSkillSummary {
  readonly skillRef: SkillRef;
  readonly name: string;
  readonly family: string;
  readonly version: VersionDescriptor;
}

export interface CreateAgendaInput {
  readonly goalBoundarySummary: string;
  readonly currentFocus?: string;
  readonly recommendedGrowState?: GrowLifecycle;
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
}

export interface ProposeAgendaItemInput {
  readonly kind: AgendaItemKind;
  readonly summary: string;
  readonly reason: string;
  readonly inputRefs?: readonly AgendaInputRef[];
  readonly relatedGapRefs?: readonly GapRef[];
  readonly relatedDoDRefs?: readonly DoDRef[];
  readonly expectedOutput: string;
  readonly evidenceRequirementRefs?: readonly ArtifactRef[];
  readonly priority?: Priority;
  readonly retryPolicy?: Partial<RetryPolicy>;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface AgendaItemUpdateInput {
  readonly status?: AgendaItemStatus;
  readonly summary?: string;
  readonly reason: string;
  readonly relatedGapRefs?: readonly GapRef[];
  readonly relatedDoDRefs?: readonly DoDRef[];
  readonly expectedOutput?: string;
  readonly evidenceRequirementRefs?: readonly ArtifactRef[];
  readonly priority?: Priority;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface RecordGapInput {
  readonly kind: GapKind;
  readonly summary: string;
  readonly requiredInput: string;
  readonly requiredEvidence: string;
  readonly blockingReason: string;
  readonly relatedAdmissionRefs?: readonly InboxItemRef[];
  readonly relatedFeedbackRefs?: readonly FeedbackUnitRef[];
  readonly relatedPolicyDecisionRefs?: readonly PolicyDecisionId[];
  readonly retryLimit?: number;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface GapUpdateInput {
  readonly status?: GapStatus;
  readonly summary?: string;
  readonly requiredInput?: string;
  readonly requiredEvidence?: string;
  readonly blockingReason?: string;
  readonly incrementAttempt?: boolean;
  readonly reason: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface DefineDoDInput {
  readonly statement: string;
  readonly scope: string;
  readonly evidenceRequirement: string;
  readonly validationIntent: string;
  readonly targetWorldSummaryRef?: ArtifactRef;
  readonly relatedAgendaItemRefs?: readonly AgendaItemRef[];
  readonly relatedGapRefs?: readonly GapRef[];
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
}

export interface DoDRevisionInput {
  readonly statement?: string;
  readonly scope?: string;
  readonly evidenceRequirement?: string;
  readonly validationIntent?: string;
  readonly targetWorldSummaryRef?: ArtifactRef;
  readonly relatedAgendaItemRefs?: readonly AgendaItemRef[];
  readonly relatedGapRefs?: readonly GapRef[];
  readonly version?: VersionDescriptor;
  readonly lifecycle?: DoDLifecycle;
  readonly reason: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface AttemptIntentOptions {
  readonly purpose?: string;
  readonly toolNeedSummary?: string;
  readonly policyBoundarySummary?: string;
  readonly stopCondition?: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface AgendaReceipt {
  readonly ref: AgendaRef | AgendaItemRef | GapRef | DoDRef | AttemptIntentRef;
  readonly eventReceipt?: EventAppendReceipt;
  readonly recordWriteReceipt?: WriteReceipt;
}

export interface AgendaSummary {
  readonly growUnitRef: GrowUnitRef;
  readonly currentFocus: string;
  readonly activeAgendaItemCount: number;
  readonly openGapCount: number;
  readonly activeDoDCount: number;
  readonly blockedCount: number;
  readonly recommendedGrowState?: GrowLifecycle;
  readonly latestAgendaItemRefs: readonly AgendaItemRef[];
  readonly latestGapRefs: readonly GapRef[];
  readonly latestDoDRefs: readonly DoDRef[];
  readonly attemptIntentRef?: AttemptIntentRef;
  readonly builtAt: string;
}

export interface AgendaExplanation {
  readonly growUnitRef: GrowUnitRef;
  readonly summary: string;
  readonly facts: readonly string[];
}

export interface AgendaDoDManagerOptions {
  readonly workspace: WorkspaceHandle;
  readonly ledger: EventLedger;
  readonly artifactRegistry: ArtifactRegistry;
  readonly policyBoundary: PolicyBoundary;
  readonly skillRegistry: SkillRegistry;
  readonly growUnitManager: GrowUnitManager;
  readonly admissionInbox: AdmissionFeedbackInbox;
  readonly producer: string;
}

export interface AgendaDoDManager {
  readonly createAgenda: (growUnitRef: GrowUnitRef, input: CreateAgendaInput) => Promise<Result<AgendaRef>>;
  readonly getAgenda: (growUnitRef: GrowUnitRef) => Promise<Result<AgendaRecord>>;
  readonly proposeAgendaItem: (growUnitRef: GrowUnitRef, input: ProposeAgendaItemInput) => Promise<Result<AgendaItemRef>>;
  readonly activateAgendaItem: (agendaItemRef: AgendaItemRef, reason: AgendaItemUpdateInput) => Promise<Result<AgendaReceipt>>;
  readonly updateAgendaItem: (agendaItemRef: AgendaItemRef, update: AgendaItemUpdateInput) => Promise<Result<AgendaReceipt>>;
  readonly retireAgendaItem: (agendaItemRef: AgendaItemRef, reason: AgendaItemUpdateInput) => Promise<Result<AgendaReceipt>>;
  readonly recordGap: (growUnitRef: GrowUnitRef, input: RecordGapInput) => Promise<Result<GapRef>>;
  readonly updateGap: (gapRef: GapRef, update: GapUpdateInput) => Promise<Result<AgendaReceipt>>;
  readonly resolveGapForNow: (gapRef: GapRef, reason: GapUpdateInput) => Promise<Result<AgendaReceipt>>;
  readonly listOpenGaps: (growUnitRef: GrowUnitRef, query?: PageQuery<GapStatus>) => Promise<Result<Page<GapRecord>>>;
  readonly defineDoD: (growUnitRef: GrowUnitRef, input: DefineDoDInput) => Promise<Result<DoDRef>>;
  readonly reviseDoD: (dodRef: DoDRef, revision: DoDRevisionInput) => Promise<Result<AgendaReceipt>>;
  readonly retireDoD: (dodRef: DoDRef, reason: DoDRevisionInput) => Promise<Result<AgendaReceipt>>;
  readonly linkDoDEvaluation: (dodRef: DoDRef, evaluationRef: ArtifactRef, reason: DoDRevisionInput) => Promise<Result<AgendaReceipt>>;
  readonly listActiveDoD: (growUnitRef: GrowUnitRef) => Promise<Result<readonly DoDItemRecord[]>>;
  readonly buildAttemptIntent: (growUnitRef: GrowUnitRef, options: AttemptIntentOptions) => Promise<Result<AttemptIntentRef>>;
  readonly explainAttemptIntent: (attemptIntentRef: AttemptIntentRef) => Promise<Result<AttemptIntentRecord>>;
  readonly buildAgendaSummary: (growUnitRef: GrowUnitRef) => Promise<Result<AgendaSummary>>;
  readonly explainAgendaState: (growUnitRef: GrowUnitRef) => Promise<Result<AgendaExplanation>>;
}

export interface PageQuery<Status extends string = string> {
  readonly status?: Status;
  readonly text?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface Page<T> {
  readonly records: readonly T[];
  readonly total: number;
  readonly nextCursor?: string;
  readonly truncated: boolean;
}

export interface AgendaIndex { readonly agendaRefs: readonly AgendaRef[]; }
export interface AgendaItemIndex { readonly agendaItemRefs: readonly AgendaItemRef[]; }
export interface GapIndex { readonly gapRefs: readonly GapRef[]; }
export interface DoDIndex { readonly dodRefs: readonly DoDRef[]; }
export interface AttemptIntentIndex { readonly attemptIntentRefs: readonly AttemptIntentRef[]; }

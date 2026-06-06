import type {
  ArtifactRef,
  AttemptRef,
  AuditDescriptor,
  CompiledMessageListSummary,
  EventId,
  GrowLifecycle,
  GrowUnitId,
  GrowUnitRef,
  HatchPackageRef,
  HatchPackageSummary,
  MessageListRef,
  ReadinessVerdictSummary,
  SkillRef,
  SourceDescriptor,
  ValidationReportRef,
  VersionDescriptor,
  WorkspaceId
} from "../domain/index.js";
import type { Result } from "../domain/result.js";
import type { ArtifactRegistry } from "../artifact-registry/index.js";
import type { EventAppendReceipt, EventLedger } from "../event-ledger/index.js";
import type { FileNativeStore, WorkspaceHandle, WriteReceipt } from "../file-store/index.js";
import type { PolicyBoundary, PolicyContext, PolicyDecision } from "../policy-boundary/index.js";
import type { SkillRegistry, SkillScope, SkillSourceKind } from "../skill-registry/index.js";

export const growUnitPhases = [
  "intake",
  "clarification",
  "planning",
  "growth",
  "verification",
  "hatch",
  "runtime_feedback",
  "blocked",
  "archived"
] as const;
export type GrowUnitPhase = (typeof growUnitPhases)[number];

export const growUnitSourceKinds = [
  "user_request",
  "runtime_feedback",
  "imported",
  "system_generated",
  "manual"
] as const;
export type GrowUnitSourceKind = (typeof growUnitSourceKinds)[number];

export interface GrowUnitRecord {
  readonly growUnitId: GrowUnitId;
  readonly growUnitRef: GrowUnitRef;
  readonly workspace: WorkspaceId;
  readonly lifecycle: GrowLifecycle;
  readonly title: string;
  readonly goalBoundarySummary: string;
  readonly targetBehaviorSummary: string;
  readonly targetWorldSummaryRef?: ArtifactRef;
  readonly currentPhase: GrowUnitPhase;
  readonly activeAttemptRef?: AttemptRef;
  readonly latestMessageListRef?: MessageListRef;
  readonly latestReadinessVerdictRef?: ArtifactRef;
  readonly latestValidationReportRef?: ValidationReportRef | ArtifactRef;
  readonly latestHatchPackageRef?: HatchPackageRef;
  readonly admissionInboxRef?: ArtifactRef;
  readonly agendaRef?: ArtifactRef;
  readonly skillScopeRef?: ArtifactRef;
  readonly policyScopeRef?: ArtifactRef;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
  readonly recordVersion: number;
}

export interface CreateGrowUnitInput {
  readonly title: string;
  readonly goalBoundarySummary: string;
  readonly targetBehaviorSummary: string;
  readonly targetWorldSummaryRef?: ArtifactRef;
  readonly currentPhase?: GrowUnitPhase;
  readonly admissionInboxRef?: ArtifactRef;
  readonly agendaRef?: ArtifactRef;
  readonly skillScopeRef?: ArtifactRef;
  readonly policyScopeRef?: ArtifactRef;
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
  readonly correlationId?: string;
}

export interface GrowUnitReasonInput {
  readonly reason: string;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly correlationId?: string;
  readonly causationId?: EventId;
  readonly expectedRecordVersion?: number;
  readonly policyContext?: PolicyContext;
}

export interface GrowUnitTransitionInput extends GrowUnitReasonInput {
  readonly to: GrowLifecycle;
  readonly from?: GrowLifecycle;
  readonly currentPhase?: GrowUnitPhase;
}

export interface GrowUnitTransitionReceipt {
  readonly growUnitRef: GrowUnitRef;
  readonly from: GrowLifecycle;
  readonly to: GrowLifecycle;
  readonly reason: string;
  readonly recordVersion: number;
  readonly eventReceipt?: EventAppendReceipt;
  readonly recordWriteReceipt?: WriteReceipt;
  readonly policyDecision?: PolicyDecision;
}

export interface AdmissionStateSummary {
  readonly admissionInboxRef: ArtifactRef;
  readonly statusSummary: string;
  readonly missingInputCount?: number;
  readonly feedbackCandidateCount?: number;
  readonly evidenceRefs?: readonly ArtifactRef[];
}

export interface AgendaStateSummary {
  readonly agendaRef: ArtifactRef;
  readonly statusSummary: string;
  readonly openGapCount?: number;
  readonly dodItemCount?: number;
  readonly blockedCount?: number;
  readonly evidenceRefs?: readonly ArtifactRef[];
}

export interface AttemptLinkSummary {
  readonly attemptRef: AttemptRef;
  readonly statusSummary: string;
  readonly startedAt?: string;
  readonly exitReason?: string;
}

export interface LinkAdmissionInput extends GrowUnitReasonInput {
  readonly admission: AdmissionStateSummary;
  readonly recommendedLifecycle?: GrowLifecycle;
}

export interface LinkAgendaInput extends GrowUnitReasonInput {
  readonly agenda: AgendaStateSummary;
  readonly recommendedLifecycle?: GrowLifecycle;
}

export interface LinkAttemptInput extends GrowUnitReasonInput {
  readonly attempt: AttemptLinkSummary;
}

export interface LinkMessageListInput extends GrowUnitReasonInput {
  readonly compiledBy: "context-message-compiler";
  readonly messageList: CompiledMessageListSummary;
}

export interface ApplyReadinessVerdictInput extends GrowUnitReasonInput {
  readonly readinessVerdictRef: ArtifactRef;
  readonly verdict: ReadinessVerdictSummary;
  readonly validationReportRef?: ValidationReportRef | ArtifactRef;
}

export interface LinkHatchPackageInput extends GrowUnitReasonInput {
  readonly hatchPackageRef: HatchPackageRef;
  readonly hatchSummary?: HatchPackageSummary;
}

export interface UpdateGoalBoundaryInput extends GrowUnitReasonInput {
  readonly goalBoundarySummary: string;
  readonly targetBehaviorSummary?: string;
}

export interface LinkTargetWorldInput extends GrowUnitReasonInput {
  readonly targetWorldSummaryRef: ArtifactRef;
  readonly targetBehaviorSummary?: string;
}

export interface SupersedeGrowUnitInput extends GrowUnitReasonInput {
  readonly supersededBy: GrowUnitRef;
  readonly replacementReason: string;
}

export interface GrowUnitCoordinationReceipt {
  readonly growUnitRef: GrowUnitRef;
  readonly kind: string;
  readonly recordVersion: number;
  readonly eventReceipt?: EventAppendReceipt;
  readonly recordWriteReceipt?: WriteReceipt;
}

export interface ActiveSkillScopeSummary {
  readonly skillRef: SkillRef;
  readonly name: string;
  readonly family: string;
  readonly version: VersionDescriptor;
  readonly sourceKind: SkillSourceKind;
}

export interface GrowUnitStateSnapshot {
  readonly record: GrowUnitRecord;
  readonly eventCount: number;
  readonly lastSequence?: number;
  readonly recoveredAt: string;
  readonly activeRefs: readonly string[];
  readonly activeSkillSummaries: readonly ActiveSkillScopeSummary[];
  readonly staleProjection: boolean;
}

export interface GrowUnitSnapshotOptions {
  readonly includeActiveSkills?: boolean;
  readonly reason: string;
}

export interface GrowUnitStateExplanation {
  readonly growUnitRef: GrowUnitRef;
  readonly lifecycle: GrowLifecycle;
  readonly summary: string;
  readonly facts: readonly string[];
  readonly eventCount: number;
  readonly lastSequence?: number;
}

export interface GrowUnitListQuery {
  readonly lifecycle?: GrowLifecycle;
  readonly text?: string;
  readonly includeArchived?: boolean;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface GrowUnitListPage {
  readonly records: readonly GrowUnitRecord[];
  readonly total: number;
  readonly nextCursor?: string;
  readonly truncated: boolean;
}

export interface GrowUnitIndex {
  readonly growUnitRefs: readonly GrowUnitRef[];
}

export interface GrowUnitManagerOptions {
  readonly workspace: WorkspaceHandle;
  readonly ledger: EventLedger;
  readonly artifactRegistry: ArtifactRegistry;
  readonly policyBoundary: PolicyBoundary;
  readonly skillRegistry: SkillRegistry;
  readonly producer: string;
}

export interface GrowUnitManager {
  readonly createGrowUnit: (input: CreateGrowUnitInput) => Promise<Result<GrowUnitRef>>;
  readonly openGrowUnit: (workspace: WorkspaceHandle) => Promise<Result<GrowUnitStateSnapshot>>;
  readonly getGrowUnit: (growUnitRef: GrowUnitRef) => Promise<Result<GrowUnitRecord>>;
  readonly transitionGrowUnit: (
    growUnitRef: GrowUnitRef,
    input: GrowUnitTransitionInput
  ) => Promise<Result<GrowUnitTransitionReceipt>>;
  readonly archiveGrowUnit: (
    growUnitRef: GrowUnitRef,
    input: GrowUnitReasonInput
  ) => Promise<Result<GrowUnitTransitionReceipt>>;
  readonly blockGrowUnit: (
    growUnitRef: GrowUnitRef,
    input: GrowUnitReasonInput
  ) => Promise<Result<GrowUnitTransitionReceipt>>;
  readonly unblockGrowUnit: (
    growUnitRef: GrowUnitRef,
    input: GrowUnitReasonInput & { readonly to?: GrowLifecycle }
  ) => Promise<Result<GrowUnitTransitionReceipt>>;
  readonly updateGoalBoundary: (
    growUnitRef: GrowUnitRef,
    input: UpdateGoalBoundaryInput
  ) => Promise<Result<GrowUnitCoordinationReceipt>>;
  readonly linkTargetWorld: (
    growUnitRef: GrowUnitRef,
    input: LinkTargetWorldInput
  ) => Promise<Result<GrowUnitCoordinationReceipt>>;
  readonly linkAdmissionState: (
    growUnitRef: GrowUnitRef,
    input: LinkAdmissionInput
  ) => Promise<Result<GrowUnitCoordinationReceipt>>;
  readonly linkAgendaState: (
    growUnitRef: GrowUnitRef,
    input: LinkAgendaInput
  ) => Promise<Result<GrowUnitCoordinationReceipt>>;
  readonly linkAttempt: (
    growUnitRef: GrowUnitRef,
    input: LinkAttemptInput
  ) => Promise<Result<GrowUnitCoordinationReceipt>>;
  readonly linkMessageList: (
    growUnitRef: GrowUnitRef,
    input: LinkMessageListInput
  ) => Promise<Result<GrowUnitCoordinationReceipt>>;
  readonly applyReadinessVerdict: (
    growUnitRef: GrowUnitRef,
    input: ApplyReadinessVerdictInput
  ) => Promise<Result<GrowUnitTransitionReceipt>>;
  readonly linkHatchPackage: (
    growUnitRef: GrowUnitRef,
    input: LinkHatchPackageInput
  ) => Promise<Result<GrowUnitTransitionReceipt>>;
  readonly supersedeGrowUnit: (
    growUnitRef: GrowUnitRef,
    input: SupersedeGrowUnitInput
  ) => Promise<Result<GrowUnitCoordinationReceipt>>;
  readonly buildGrowUnitSnapshot: (
    growUnitRef: GrowUnitRef,
    options: GrowUnitSnapshotOptions
  ) => Promise<Result<GrowUnitStateSnapshot>>;
  readonly explainGrowUnitState: (
    growUnitRef: GrowUnitRef
  ) => Promise<Result<GrowUnitStateExplanation>>;
  readonly listGrowUnits: (query?: GrowUnitListQuery) => Promise<Result<GrowUnitListPage>>;
}

export type GrowUnitManagerDependencies = {
  readonly store: FileNativeStore;
  readonly options: GrowUnitManagerOptions;
};

export function skillScopeForGrowUnit(record: GrowUnitRecord): SkillScope {
  return { workspace: record.workspace, growUnit: record.growUnitId };
}

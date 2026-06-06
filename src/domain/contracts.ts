import type {
  ArtifactId,
  PolicyDecisionId,
  SkillId,
  TargetWorldId,
  ToolId
} from "./ids.js";
import type { RuntimeKernelType, ReadinessVerdict } from "./states.js";
import type {
  ArtifactRef,
  HatchPackageRef,
  MessageListRef,
  RuntimeContractRef,
  SkillRef,
  ToolResultRef,
  ValidationReportRef
} from "./refs.js";
import type { AuditDescriptor, PrivacyLevel, SourceDescriptor, VersionDescriptor } from "./descriptors.js";

export const policyVerdicts = [
  "allow",
  "deny",
  "ask",
  "allow_with_constraints",
  "allow_with_redaction",
  "unsupported"
] as const;

export type PolicyVerdict = (typeof policyVerdicts)[number];

export interface RuntimeContractSummary {
  readonly runtimeContractRef: RuntimeContractRef;
  readonly runtimeKernelType: RuntimeKernelType;
  readonly version: VersionDescriptor;
  readonly inputSummary: string;
  readonly outputSummary: string;
  readonly actionBoundarySummary?: string;
}

export interface TargetWorldContractSummary {
  readonly targetWorldId: TargetWorldId;
  readonly kind: string;
  readonly inputKinds: readonly string[];
  readonly outputKinds: readonly string[];
  readonly privacyLevel: PrivacyLevel;
}

export interface PolicyDecision {
  readonly policyDecisionId: PolicyDecisionId;
  readonly verdict: PolicyVerdict;
  readonly capability: string;
  readonly reason: string;
  readonly constraints?: readonly string[];
  readonly requiredApproval?: string;
  readonly requiredRedaction?: string;
  readonly source?: SourceDescriptor;
  readonly audit?: AuditDescriptor;
}

export interface ReadinessVerdictSummary {
  readonly verdict: ReadinessVerdict;
  readonly reason: string;
  readonly evidenceRefs: readonly ArtifactRef[];
  readonly validationReportRefs?: readonly ValidationReportRef[];
}

export interface CompiledMessageListSummary {
  readonly messageListRef: MessageListRef;
  readonly sourceRefs: readonly ArtifactRef[];
  readonly excludedRefs: readonly ArtifactRef[];
  readonly budgetSummary: string;
}

export interface ToolCallSummary {
  readonly toolId: ToolId;
  readonly name: string;
  readonly inputArtifactId?: ArtifactId;
  readonly policyDecisionId?: PolicyDecisionId;
}

export interface ToolResultSummary {
  readonly toolResultRef: ToolResultRef;
  readonly toolId: ToolId;
  readonly status: "succeeded" | "failed" | "cancelled";
  readonly summary: string;
}

export interface HatchPackageSummary {
  readonly hatchPackageRef: HatchPackageRef;
  readonly runtimeContractRef: RuntimeContractRef;
  readonly runtimeKernelType: RuntimeKernelType;
  readonly version: VersionDescriptor;
  readonly packageSummary: string;
}

export interface FeedbackRoutingDecision {
  readonly targetLayer: "current_project" | "target_agent_project" | "upstream_feng_project" | "external_runtime";
  readonly decision: "local_only" | "candidate_upstream" | "reject" | "needs_evidence" | "needs_human";
  readonly reason: string;
  readonly evidenceRefs: readonly ArtifactRef[];
}

export interface SkillDescriptor {
  readonly skillId: SkillId;
  readonly skillRef?: SkillRef;
  readonly name: string;
  readonly description: string;
  readonly version: VersionDescriptor;
  readonly source: SourceDescriptor;
}

export type ContractSummary =
  | RuntimeContractSummary
  | TargetWorldContractSummary
  | PolicyDecision
  | ReadinessVerdictSummary
  | CompiledMessageListSummary
  | ToolCallSummary
  | ToolResultSummary
  | HatchPackageSummary
  | FeedbackRoutingDecision
  | SkillDescriptor;

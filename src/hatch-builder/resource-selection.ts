import type { ArtifactRef, PolicyDecisionId } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import type { ArtifactRecord } from "../artifact-registry/index.js";
import type { SkillRecord } from "../skill-registry/index.js";
import { hatchErr } from "./errors.js";
import {
  artifactKey,
  exclusionCodeForArtifactLifecycle,
  newHatchExclusionRef,
  newHatchResourceRef,
  secretContentDetected
} from "./logic.js";
import { evaluateHatchPolicy, policyAllows, type HatchRuntime } from "./runtime.js";
import type {
  HatchExclusionReason,
  HatchExclusionRecord,
  HatchRequestInput,
  HatchResource,
  HatchResourceCandidate,
  HatchResourceRole,
  HatchResourceSelection,
  PackagedSkillVersion
} from "./types.js";

interface Candidate extends Required<Pick<HatchResourceCandidate, "role" | "sourceModule" | "required" | "targetPathHint" | "inclusionReason">> {
  readonly artifactRef: ArtifactRef;
}

interface CandidateDecision {
  readonly outcome: HatchResource | HatchExclusionRecord;
  readonly policyDecisionRefs: readonly PolicyDecisionId[];
}

export async function selectHatchResourcesForInput(
  runtime: HatchRuntime,
  input: HatchRequestInput,
  policyContext = input.policyContext
): Promise<Result<HatchResourceSelection>> {
  const base = await baseCandidates(runtime, input);
  if (!base.ok) return base;
  const skillCandidates = await collectSkillCandidates(runtime, input);
  if (!skillCandidates.ok) return skillCandidates;
  const candidates = dedupeCandidates([...base.value, ...skillCandidates.value.candidates]);
  const included: HatchResource[] = [];
  const excluded: HatchExclusionRecord[] = [];
  const policyDecisionRefs: PolicyDecisionId[] = [];
  for (const candidate of candidates) {
    const decision = await decideCandidate(runtime, input, candidate, policyContext);
    if (!decision.ok) return decision;
    policyDecisionRefs.push(...decision.value.policyDecisionRefs);
    if ("resourceRef" in decision.value.outcome) included.push(decision.value.outcome);
    else excluded.push(decision.value.outcome);
  }
  const includedArtifacts = new Set(included.map((item) => item.artifactRef.id));
  const skillVersions = skillCandidates.value.skills.filter((skill) => includedArtifacts.has(skill.bodyRef.id));
  return ok({ includedResources: included, excludedResources: excluded, skillVersions, policyDecisionRefs });
}

async function baseCandidates(runtime: HatchRuntime, input: HatchRequestInput): Promise<Result<readonly Candidate[]>> {
  const contract = await runtime.options.runtimeContractRegistry.getRuntimeContract(input.runtimeContractRef);
  if (!contract.ok) return contract;
  const readiness = await runtime.options.evidenceReadiness.explainReadinessVerdict(input.readinessVerdictRef);
  if (!readiness.ok) return hatchErr({ code: "readiness_missing", message: readiness.error.message });
  const explicit = (input.resourceCandidates ?? []).map((candidate) => normalizeCandidate(candidate, "source_material_snapshot"));
  return ok([
    {
      artifactRef: contract.value.artifactRef,
      role: "runtime_contract",
      sourceModule: "runtime-contract-registry",
      required: true,
      targetPathHint: "runtime-contract.json",
      inclusionReason: "locked runtime contract required by hatch package"
    },
    {
      artifactRef: readiness.value.artifactRef,
      role: "validation_summary",
      sourceModule: "evidence-readiness",
      required: true,
      targetPathHint: "readiness-verdict.json",
      inclusionReason: "ready_to_hatch verdict evidence summary"
    },
    ...explicit
  ]);
}

async function collectSkillCandidates(runtime: HatchRuntime, input: HatchRequestInput): Promise<Result<{
  readonly candidates: readonly Candidate[];
  readonly skills: readonly PackagedSkillVersion[];
}>> {
  const explicit = [];
  for (const ref of input.skillRefs ?? []) {
    const skill = await runtime.options.skillRegistry.getSkill(ref);
    if (!skill.ok) return skill;
    explicit.push(skill.value);
  }
  const active = await runtime.options.skillRegistry.listActiveSkills({
    workspace: runtime.options.workspace.id,
    growUnit: input.growUnitRef.id
  });
  if (!active.ok) return active;
  const records = dedupeSkills([...explicit, ...active.value.skills.map((item) => item.record)]);
  const candidates: Candidate[] = [];
  const skills: PackagedSkillVersion[] = [];
  for (const record of records) {
    candidates.push(skillBodyCandidate(record));
    candidates.push(...record.assetRefs.map((assetRef, index) => skillAssetCandidate(record, assetRef, index)));
    skills.push({
      skillRef: record.skillRef,
      name: record.name,
      family: record.family,
      version: record.version,
      bodyRef: record.bodyRef,
      assetRefs: record.assetRefs,
      declaredCapabilities: record.declaredCapabilities,
      inclusionReason: `selected skill ${record.family}@${record.version.schemaVersion}`,
      ...(record.rollbackTarget === undefined ? {} : { rollbackTarget: record.rollbackTarget })
    });
  }
  return ok({ candidates, skills });
}

async function decideCandidate(
  runtime: HatchRuntime,
  input: HatchRequestInput,
  candidate: Candidate,
  policyContext: HatchRequestInput["policyContext"]
): Promise<Result<CandidateDecision>> {
  const artifact = await runtime.options.artifactRegistry.resolveArtifact(candidate.artifactRef);
  if (!artifact.ok) return ok({ outcome: exclusion(candidate, "unavailable_artifact", "artifact record is unavailable"), policyDecisionRefs: [] });
  const structural = structuralExclusion(candidate, artifact.value);
  if (structural !== undefined) return ok({ outcome: structural, policyDecisionRefs: [] });
  const privacy = await privacyExclusion(runtime, input, candidate, artifact.value, policyContext);
  if (!privacy.ok) return privacy;
  if (privacy.value.exclusion !== undefined) {
    return ok({ outcome: privacy.value.exclusion, policyDecisionRefs: privacy.value.policyDecisionRefs });
  }
  const materialized = await runtime.options.artifactRegistry.materializeArtifact(candidate.artifactRef, {
    reason: "select hatch resource",
    maxBytes: 2 * 1024 * 1024
  });
  if (!materialized.ok) {
    return ok({ outcome: exclusion(candidate, "unavailable_artifact", materialized.error.message), policyDecisionRefs: privacy.value.policyDecisionRefs });
  }
  if (materialized.value.status !== "available") {
    return ok({
      outcome: exclusion(candidate, "unavailable_artifact", `artifact materialization status=${materialized.value.status}`),
      policyDecisionRefs: privacy.value.policyDecisionRefs
    });
  }
  if (typeof materialized.value.content === "string" && secretContentDetected(materialized.value.content)) {
    return ok({ outcome: exclusion(candidate, "contains_secret", "secret-like content detected"), policyDecisionRefs: privacy.value.policyDecisionRefs });
  }
  const contentHash = materialized.value.contentHash ?? artifact.value.contentHash;
  if (contentHash === undefined) {
    return ok({
      outcome: exclusion(candidate, "privacy_unknown", "content hash is required for packaged resources"),
      policyDecisionRefs: privacy.value.policyDecisionRefs
    });
  }
  return ok({
    outcome: {
      resourceRef: newHatchResourceRef(),
      artifactRef: candidate.artifactRef,
      role: candidate.role,
      sourceModule: candidate.sourceModule,
      inclusionReason: candidate.inclusionReason,
      contentHash,
      privacyClass: artifact.value.privacyClass,
      retentionClass: artifact.value.retentionClass,
      targetPathHint: candidate.targetPathHint,
      required: candidate.required,
      source: artifact.value.source,
      audit: artifact.value.audit
    },
    policyDecisionRefs: privacy.value.policyDecisionRefs
  });
}

function structuralExclusion(candidate: Candidate, artifact: ArtifactRecord): HatchExclusionRecord | undefined {
  const lifecycleReason = exclusionCodeForArtifactLifecycle(artifact.lifecycle);
  if (lifecycleReason !== undefined) return exclusion(candidate, lifecycleReason, `artifact lifecycle is ${artifact.lifecycle}`);
  if (artifact.kind === "compiled_message_list" || artifact.kind === "runtime_message_list") {
    return exclusion(candidate, "raw_message_list", "raw message lists are not package resources by default");
  }
  if (artifact.kind === "attempt_trace" || artifact.kind === "runtime_trace") {
    return exclusion(candidate, "raw_attempt_trace", "raw traces are excluded by default");
  }
  if (artifact.kind === "candidate_output") {
    return exclusion(candidate, "unaccepted_candidate", "candidate output is not accepted package content");
  }
  if (artifact.privacyClass === "contains_secret") return exclusion(candidate, "contains_secret", "artifact privacy class contains_secret");
  if (artifact.privacyClass === "unknown") return exclusion(candidate, "privacy_unknown", "artifact privacy is unknown");
  return undefined;
}

async function privacyExclusion(
  runtime: HatchRuntime,
  input: HatchRequestInput,
  candidate: Candidate,
  artifact: ArtifactRecord,
  policyContext: HatchRequestInput["policyContext"]
): Promise<Result<{ readonly exclusion?: HatchExclusionRecord; readonly policyDecisionRefs: readonly PolicyDecisionId[] }>> {
  const needsExportPolicy = input.publishMode === "external_export"
    || artifact.privacyClass === "project_private"
    || artifact.privacyClass === "contains_user_content";
  if (!needsExportPolicy) return ok({ policyDecisionRefs: [] });
  const decision = await evaluateHatchPolicy({
    runtime,
    capability: "artifact.export",
    resourceSummary: `artifact:${artifact.artifactRef.id}`,
    operation: "select hatch resource",
    reason: `select ${candidate.role} for ${input.publishMode}`,
    source: input.source,
    growUnit: input.growUnitRef,
    ...(policyContext === undefined ? {} : { context: policyContext })
  });
  if (!decision.ok) return decision;
  if (policyAllows(decision.value)) return ok({ policyDecisionRefs: [decision.value.policyDecisionId] });
  return ok({
    exclusion: exclusion(candidate, "policy_blocked", decision.value.explanation, [decision.value.policyDecisionId]),
    policyDecisionRefs: [decision.value.policyDecisionId]
  });
}

function normalizeCandidate(candidate: HatchResourceCandidate, fallbackRole: HatchResourceRole): Candidate {
  return {
    artifactRef: candidate.artifactRef,
    role: candidate.role ?? fallbackRole,
    sourceModule: candidate.sourceModule ?? "hatch-request",
    required: candidate.required ?? false,
    targetPathHint: candidate.targetPathHint ?? `resources/${candidate.artifactRef.id}`,
    inclusionReason: candidate.inclusionReason ?? "explicit hatch resource candidate"
  };
}

function skillBodyCandidate(record: SkillRecord): Candidate {
  return {
    artifactRef: record.bodyRef,
    role: "skill_body",
    sourceModule: "skill-registry",
    required: true,
    targetPathHint: `skills/${record.family}/${record.version.schemaVersion}/SKILL.md`,
    inclusionReason: `skill body for ${record.family}@${record.version.schemaVersion}`
  };
}

function skillAssetCandidate(record: SkillRecord, artifactRef: ArtifactRef, index: number): Candidate {
  return {
    artifactRef,
    role: "skill_asset",
    sourceModule: "skill-registry",
    required: false,
    targetPathHint: `skills/${record.family}/${record.version.schemaVersion}/assets/${index}`,
    inclusionReason: `skill asset for ${record.family}@${record.version.schemaVersion}`
  };
}

function exclusion(
  candidate: Candidate,
  reason: HatchExclusionReason,
  detail: string,
  policyDecisionRefs: readonly PolicyDecisionId[] = []
): HatchExclusionRecord {
  return {
    exclusionRef: newHatchExclusionRef(),
    artifactRef: candidate.artifactRef,
    role: candidate.role,
    sourceModule: candidate.sourceModule,
    required: candidate.required,
    reason,
    detail,
    policyDecisionRefs,
    source: { kind: "system", origin: "hatch-builder", userProvided: false, receivedAt: new Date().toISOString(), privacyLevel: "workspace_private" },
    audit: { createdAt: new Date().toISOString(), createdBy: "hatch-builder", reason: detail }
  };
}

function dedupeCandidates(candidates: readonly Candidate[]): readonly Candidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${artifactKey(candidate.artifactRef)}:${candidate.role}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeSkills(records: readonly SkillRecord[]): readonly SkillRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (seen.has(record.skillRef.id)) return false;
    seen.add(record.skillRef.id);
    return true;
  });
}

import { ok, type Result } from "../domain/result.js";
import type { PolicyContext } from "../policy-boundary/index.js";
import { skillErr } from "./errors.js";
import { scopeKey, scopeMatchesFilter, scopeSummary } from "./scope.js";
import type {
  RegisterSkillInput,
  SkillActivation,
  SkillCandidate,
  SkillCandidateContext,
  SkillCatalogQuery,
  SkillLifecycle,
  SkillRecord,
  SkillRegistryOptions,
  SkillSummaryMaterialization
} from "./types.js";

export function validateRegisterInput(input: RegisterSkillInput): Result<void> {
  if (input.name.trim().length === 0) return skillErr({ code: "invalid_input", message: "skill name is required" });
  if (input.description.trim().length === 0) return skillErr({ code: "invalid_input", message: "description is required" });
  if (input.triggerSummary.trim().length === 0) return skillErr({ code: "invalid_input", message: "triggerSummary is required" });
  if (typeof input.body === "string" && input.body.trim().length === 0) {
    return skillErr({ code: "invalid_input", message: "skill body cannot be empty" });
  }
  if (input.body instanceof Uint8Array && input.body.byteLength === 0) {
    return skillErr({ code: "invalid_input", message: "skill body cannot be empty" });
  }
  return ok(undefined);
}

export function initialLifecycle(sourceKind: RegisterSkillInput["sourceKind"]): SkillLifecycle {
  return sourceKind === "grow_generated" || sourceKind === "upstream_proposed" ? "candidate" : "registered";
}

export function activationGuard(record: SkillRecord): Result<void> {
  if (record.lifecycle === "retracted") return skillErr({ code: "skill_retracted", message: "retracted skill cannot be activated" });
  if (record.lifecycle === "incompatible") return skillErr({ code: "skill_incompatible", message: "incompatible skill cannot be activated" });
  if (record.lifecycle === "candidate") return skillErr({ code: "activation_blocked", message: "candidate skill must be registered before activation" });
  return ok(undefined);
}

export function matchesQuery(record: SkillRecord, query: SkillCatalogQuery): boolean {
  if (query.includeRetracted !== true && (record.lifecycle === "retracted" || record.lifecycle === "incompatible")) return false;
  if (query.family !== undefined && record.family !== query.family) return false;
  if (query.lifecycle !== undefined && record.lifecycle !== query.lifecycle) return false;
  if (query.sourceKind !== undefined && record.sourceKind !== query.sourceKind) return false;
  if (!scopeMatchesFilter(query.scope, record.scope)) return false;
  if (query.text === undefined) return true;
  const text = query.text.toLowerCase();
  return [record.name, record.family, record.description, record.triggerSummary]
    .some((value) => value.toLowerCase().includes(text));
}

export function changedFields(from: SkillRecord, to: SkillRecord): readonly string[] {
  const fields: Array<keyof SkillRecord> = [
    "description",
    "triggerSummary",
    "bodyRef",
    "declaredCapabilities",
    "declaredToolRefs",
    "compatibility",
    "privacyClass"
  ];
  return fields.filter((field) => JSON.stringify(from[field]) !== JSON.stringify(to[field]));
}

export function latestActivations(activations: readonly SkillActivation[]): readonly SkillActivation[] {
  const latest = new Map<string, SkillActivation>();
  for (const activation of activations) {
    const key = `${activation.skillRef.id}:${scopeKey(activation.scope)}`;
    const previous = latest.get(key);
    if (previous === undefined || previous.createdAt <= activation.createdAt) latest.set(key, activation);
  }
  return [...latest.values()];
}

export function activationIsActive(activation: SkillActivation): boolean {
  if (activation.status !== "enabled" && activation.status !== "pinned" && activation.status !== "rolled_back") return false;
  if (activation.expiresAt !== undefined && Date.parse(activation.expiresAt) <= Date.now()) return false;
  return true;
}

export function recordUsable(record: SkillRecord): boolean {
  return record.lifecycle !== "retracted" && record.lifecycle !== "incompatible" && record.lifecycle !== "disabled";
}

export function summary(record: SkillRecord): SkillSummaryMaterialization {
  return {
    skillRef: record.skillRef,
    name: record.name,
    family: record.family,
    version: record.version,
    description: record.description,
    triggerSummary: record.triggerSummary,
    declaredCapabilities: record.declaredCapabilities,
    declaredToolRefs: record.declaredToolRefs,
    sourceKind: record.sourceKind,
    lifecycle: record.lifecycle
  };
}

export function candidateFor(
  record: SkillRecord,
  activation: SkillActivation,
  context: SkillCandidateContext
): SkillCandidate | undefined {
  const text = context.text.toLowerCase();
  const searchable = [record.name, record.family, record.description, record.triggerSummary].join("\n").toLowerCase();
  const capabilityMatch = context.requiredCapabilities?.every((capability) =>
    record.declaredCapabilities.includes(capability)
  ) ?? true;
  if (!capabilityMatch) return undefined;
  const textMatch = text.trim().length === 0 || searchable.includes(text);
  if (!textMatch) return undefined;
  const score = (searchable.includes(text) ? 2 : 1) + (record.sourceKind === "system_default" ? 0.5 : 0);
  return {
    record,
    activation,
    reason: `matched ${record.name} in ${scopeSummary(activation.scope)}`,
    score,
    limitations: ["active skill is a candidate; Context Compiler decides message-list visibility"]
  };
}

export function defaultPolicyContext(): PolicyContext {
  return {
    caller: "skill-registry",
    environment: {
      hostSandboxAvailable: false,
      networkAvailable: false,
      externalEnforcementAvailable: false,
      secretStoreAvailable: false
    }
  };
}

export function systemSource(workspace: SkillRegistryOptions["workspace"]["id"]): SkillRecord["source"] {
  return {
    kind: "system",
    origin: "skill-registry",
    workspace,
    userProvided: false,
    receivedAt: new Date().toISOString(),
    privacyLevel: "workspace_private"
  };
}

export function parseJson<T>(content: string, message: string): Result<T> {
  try {
    return ok(JSON.parse(content) as T);
  } catch (cause) {
    return skillErr({ code: "schema_incompatible", message, cause });
  }
}

import { ok, type Result } from "../domain/result.js";
import type { GrowUnitRef, HatchPackageRef } from "../domain/index.js";
import { hatchErr } from "./errors.js";
import { matchesPackageQuery } from "./logic.js";
import type { HatchRuntime } from "./runtime.js";
import type {
  HatchExclusionRef,
  HatchPackageExplanation,
  HatchPackagePage,
  HatchPackageQuery,
  HatchResourceRef,
  ResourceExclusionExplanation,
  ResourceInclusionExplanation
} from "./types.js";

export function getHatchPackageRecord(runtime: HatchRuntime, ref: HatchPackageRef) {
  return runtime.storage.readPackage(ref);
}

export async function listHatchPackageRecords(
  runtime: HatchRuntime,
  growUnitRef: GrowUnitRef,
  query: HatchPackageQuery = {}
): Promise<Result<HatchPackagePage>> {
  const all = await runtime.storage.readAllPackages();
  if (!all.ok) return all;
  const filtered = all.value.filter((record) => record.growUnitRef.id === growUnitRef.id && matchesPackageQuery(record, query));
  const start = query.cursor === undefined ? 0 : Number.parseInt(query.cursor, 10);
  const limit = Math.max(1, query.limit ?? (filtered.length || 1));
  const records = filtered.slice(start, start + limit);
  return ok({
    records,
    total: filtered.length,
    ...(start + limit >= filtered.length ? {} : { nextCursor: String(start + limit) }),
    truncated: start + limit < filtered.length
  });
}

export async function explainHatchPackageRecord(
  runtime: HatchRuntime,
  ref: HatchPackageRef
): Promise<Result<HatchPackageExplanation>> {
  const record = await runtime.storage.readPackage(ref);
  if (!record.ok) return record;
  const plan = await runtime.storage.readBuildPlan(record.value.hatchBuildPlanRef);
  if (!plan.ok) return plan;
  return ok({
    hatchPackageRef: ref,
    summary: `${record.value.packageName}@${record.value.version.schemaVersion} ${record.value.lifecycle}`,
    facts: [
      `runtimeContract=${record.value.runtimeContractRef.id}`,
      `readinessVerdict=${record.value.readinessVerdictRef.id}`,
      `runtimeKernel=${plan.value.runtimeKernelType}`,
      `included=${plan.value.includedResources.length}`,
      `excluded=${plan.value.excludedResources.length}`,
      `skills=${plan.value.skillVersions.length}`,
      `rollback=${record.value.rollbackTarget?.id ?? plan.value.rollbackReason}`,
      `artifact=${record.value.artifactRef.id}`
    ]
  });
}

export async function explainResourceInclusionRecord(
  runtime: HatchRuntime,
  ref: HatchResourceRef
): Promise<Result<ResourceInclusionExplanation>> {
  const found = await findResource(runtime, ref.id);
  if (!found.ok) return found;
  return ok({
    resourceRef: ref,
    summary: found.value.inclusionReason,
    facts: [
      `artifact=${found.value.artifactRef.id}`,
      `role=${found.value.role}`,
      `sourceModule=${found.value.sourceModule}`,
      `privacy=${found.value.privacyClass}`,
      `targetPath=${found.value.targetPathHint}`,
      `required=${found.value.required}`
    ]
  });
}

export async function explainResourceExclusionRecord(
  runtime: HatchRuntime,
  ref: HatchExclusionRef
): Promise<Result<ResourceExclusionExplanation>> {
  const found = await findExclusion(runtime, ref.id);
  if (!found.ok) return found;
  return ok({
    exclusionRef: ref,
    summary: found.value.detail,
    facts: [
      `artifact=${found.value.artifactRef?.id ?? "none"}`,
      `role=${found.value.role ?? "unknown"}`,
      `sourceModule=${found.value.sourceModule ?? "unknown"}`,
      `reason=${found.value.reason}`,
      `required=${found.value.required}`,
      `policy=${found.value.policyDecisionRefs.join(",") || "none"}`
    ]
  });
}

async function findResource(runtime: HatchRuntime, id: string) {
  const plans = await runtime.storage.readAllBuildPlans();
  if (!plans.ok) return plans;
  const resource = plans.value.flatMap((plan) => plan.includedResources).find((item) => item.resourceRef.id === id);
  return resource === undefined
    ? hatchErr({ code: "not_found", message: "hatch resource not found" })
    : ok(resource);
}

async function findExclusion(runtime: HatchRuntime, id: string) {
  const plans = await runtime.storage.readAllBuildPlans();
  if (!plans.ok) return plans;
  const exclusion = plans.value.flatMap((plan) => plan.excludedResources).find((item) => item.exclusionRef.id === id);
  return exclusion === undefined
    ? hatchErr({ code: "not_found", message: "hatch exclusion not found" })
    : ok(exclusion);
}

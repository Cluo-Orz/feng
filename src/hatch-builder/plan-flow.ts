import { ok, type Result } from "../domain/result.js";
import type { RuntimeContractRecord } from "../runtime-contract-registry/index.js";
import { hatchEventTypes } from "./events.js";
import { hatchErr } from "./errors.js";
import {
  defaultPackageName,
  newHatchBuildPlanRef,
  newHatchRequestRef,
  validateHatchRequest
} from "./logic.js";
import { appendHatchGrowEvent, evaluateHatchPolicy, policyAllows, type HatchRuntime } from "./runtime.js";
import { selectHatchResourcesForInput } from "./resource-selection.js";
import type {
  HatchBuildPlan,
  HatchRequestInput,
  HatchRequestRef
} from "./types.js";

export async function requestHatchRecord(runtime: HatchRuntime, input: HatchRequestInput): Promise<Result<HatchRequestRef>> {
  const valid = validateHatchRequest(input);
  if (!valid.ok) return valid;
  const grow = await runtime.options.growUnitManager.getGrowUnit(input.growUnitRef);
  if (!grow.ok) return grow;
  if (grow.value.lifecycle === "archived") return hatchErr({ code: "grow_unit_archived", message: "archived grow unit cannot hatch" });
  const ref = newHatchRequestRef();
  const now = new Date().toISOString();
  const { policyContext: _policyContext, ...storedInput } = input;
  const record = {
    ...storedInput,
    hatchRequestId: ref.id,
    hatchRequestRef: ref,
    packageName: defaultPackageName(input),
    candidateResourceRefs: (input.resourceCandidates ?? []).map((item) => item.artifactRef),
    explicitSkillRefs: input.skillRefs ?? [],
    policyDecisionRefs: [],
    createdAt: now,
    recordVersion: 1
  };
  const write = await runtime.storage.writeRequest(record, "write hatch request");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addRequest(ref);
  if (!indexed.ok) return indexed;
  const event = await appendHatchGrowEvent({
    runtime,
    request: record,
    eventType: hatchEventTypes.requested,
    body: { hatchRequestRef: ref, growUnitRef: input.growUnitRef, runtimeContractRef: input.runtimeContractRef }
  });
  return event.ok ? ok(ref) : event;
}

export async function buildHatchPlanRecord(
  runtime: HatchRuntime,
  ref: HatchRequestRef,
  policyContext?: HatchRequestInput["policyContext"]
): Promise<Result<HatchBuildPlan>> {
  const request = await runtime.storage.readRequest(ref);
  if (!request.ok) return request;
  const readiness = await runtime.options.evidenceReadiness.explainReadinessVerdict(request.value.readinessVerdictRef);
  if (!readiness.ok) return hatchErr({ code: "readiness_missing", message: readiness.error.message });
  if (!readiness.value.summary.startsWith("ready_to_hatch")) {
    return hatchErr({ code: "readiness_failed", message: "readiness verdict is not ready_to_hatch" });
  }
  const contract = await runtime.options.runtimeContractRegistry.getRuntimeContract(request.value.runtimeContractRef);
  if (!contract.ok) return contract;
  if (contract.value.lifecycle === "retracted") return hatchErr({ code: "contract_retracted", message: "retracted contract cannot hatch" });
  if (contract.value.lifecycle !== "locked_for_hatch") {
    return hatchErr({ code: "contract_not_ready", message: "runtime contract must be locked_for_hatch" });
  }
  const conflict = await packageVersionConflict(runtime, request.value.packageName, request.value.requestedVersion.schemaVersion);
  if (!conflict.ok || conflict.value) {
    return conflict.ok ? hatchErr({ code: "package_version_conflict", message: "package version already exists" }) : conflict;
  }
  const policy = await evaluateHatchPolicy({
    runtime,
    capability: "hatch.publish",
    resourceSummary: `hatch-package:${request.value.packageName}@${request.value.requestedVersion.schemaVersion}`,
    operation: "build hatch plan",
    reason: request.value.reason,
    source: request.value.source,
    growUnit: request.value.growUnitRef,
    ...(policyContext === undefined ? {} : { context: policyContext })
  });
  if (!policy.ok) return policy;
  if (!policyAllows(policy.value)) {
    return hatchErr({
      code: policy.value.verdict === "deny" ? "policy_blocked" : "approval_required",
      message: policy.value.explanation
    });
  }
  const selection = await selectHatchResourcesForInput(runtime, request.value, policyContext);
  if (!selection.ok) return selection;
  const planRef = newHatchBuildPlanRef();
  const plan: HatchBuildPlan = {
    hatchBuildPlanId: planRef.id,
    hatchBuildPlanRef: planRef,
    hatchRequestRef: ref,
    growUnitRef: request.value.growUnitRef,
    readinessVerdictRef: request.value.readinessVerdictRef,
    runtimeContractRef: request.value.runtimeContractRef,
    runtimeKernelType: contract.value.runtimeKernelType,
    candidateResourceRefs: request.value.candidateResourceRefs,
    includedResources: selection.value.includedResources,
    excludedResources: selection.value.excludedResources,
    skillVersions: selection.value.skillVersions,
    dependencySummary: buildDependencySummary(selection.value.includedResources.length, selection.value.skillVersions.length),
    debugFeedbackSummary: buildDebugFeedbackSummary(contract.value),
    policyBoundarySummary: `${policy.value.verdict} hatch.publish with ${selection.value.policyDecisionRefs.length} resource decision(s)`,
    versionPlan: request.value.requestedVersion,
    ...(request.value.rollbackTarget === undefined ? {} : { rollbackTarget: request.value.rollbackTarget }),
    rollbackReason: request.value.rollbackTarget === undefined ? "no rollback target requested" : "explicit rollback target requested",
    policyDecisionRefs: [policy.value.policyDecisionId, ...selection.value.policyDecisionRefs],
    source: request.value.source,
    audit: request.value.audit,
    createdAt: new Date().toISOString(),
    recordVersion: 1
  };
  const write = await runtime.storage.writeBuildPlan(plan, "write hatch build plan");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addBuildPlan(planRef);
  if (!indexed.ok) return indexed;
  const event = await appendHatchGrowEvent({
    runtime,
    request: request.value,
    eventType: hatchEventTypes.buildPlanCreated,
    body: { hatchBuildPlanRef: planRef, included: plan.includedResources.length, excluded: plan.excludedResources.length }
  });
  return event.ok ? ok(plan) : event;
}

async function packageVersionConflict(runtime: HatchRuntime, packageName: string, schemaVersion: string): Promise<Result<boolean>> {
  const packages = await runtime.storage.readAllPackages();
  if (!packages.ok) return packages;
  return ok(packages.value.some((record) =>
    record.lifecycle !== "retracted"
    && record.version.schemaVersion === schemaVersion
    && record.packageName === packageName
  ));
}

function buildDependencySummary(resourceCount: number, skillCount: number): string {
  return `${resourceCount} resource(s), ${skillCount} packaged skill version(s)`;
}

function buildDebugFeedbackSummary(contract: RuntimeContractRecord): string {
  const debug = contract.shape.debug?.debugModes.join(",") ?? "debug contract missing";
  const feedback = contract.shape.feedback?.feedbackEntryKinds.join(",") ?? "feedback contract missing";
  return `debug=${debug}; feedback=${feedback}`;
}

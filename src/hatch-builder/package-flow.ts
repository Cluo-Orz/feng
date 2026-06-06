import { ok, type Result } from "../domain/result.js";
import type { ArtifactRef, HatchLifecycle, HatchPackageRef, PrivacyLevel } from "../domain/index.js";
import { hatchEventTypes } from "./events.js";
import { hatchErr } from "./errors.js";
import { newHatchBuildReceiptRef, newHatchPackageRef, newHatchVerificationRef } from "./logic.js";
import {
  appendHatchGrowEvent,
  appendHatchPackageEvent,
  evaluateHatchPolicy,
  policyAllows,
  type HatchRuntime
} from "./runtime.js";
import type {
  HatchBuildPlanRef,
  HatchBuildReceipt,
  HatchLifecycleReceipt,
  HatchPackageCheck,
  HatchPackageDocument,
  HatchPackageManifest,
  HatchPackageRecord,
  HatchPackageVerification,
  HatchPublishReceipt,
  PackagedResourceContent
} from "./types.js";

export async function buildHatchPackageRecord(
  runtime: HatchRuntime,
  planRef: HatchBuildPlanRef
): Promise<Result<HatchPackageRef>> {
  const plan = await runtime.storage.readBuildPlan(planRef);
  if (!plan.ok) return plan;
  const request = await runtime.storage.readRequest(plan.value.hatchRequestRef);
  if (!request.ok) return request;
  const blocked = firstRequiredExclusion(plan.value.excludedResources);
  if (blocked !== undefined) return blocked;
  const conflict = await packageVersionConflict(runtime, request.value.packageName, plan.value.versionPlan.schemaVersion);
  if (!conflict.ok || conflict.value) {
    return conflict.ok ? hatchErr({ code: "package_version_conflict", message: "package version already exists" }) : conflict;
  }
  const resources = await snapshotResources(runtime, plan.value.includedResources);
  if (!resources.ok) return resources;
  const packageRef = newHatchPackageRef();
  const receiptRef = newHatchBuildReceiptRef();
  const contract = await runtime.options.runtimeContractRegistry.getRuntimeContract(plan.value.runtimeContractRef);
  if (!contract.ok) return contract;
  const readiness = await runtime.options.evidenceReadiness.explainReadinessVerdict(plan.value.readinessVerdictRef);
  if (!readiness.ok) return hatchErr({ code: "readiness_missing", message: readiness.error.message });
  const evidence = await runtime.options.evidenceReadiness.buildEvidenceSummary(plan.value.growUnitRef);
  if (!evidence.ok) return evidence;
  const createdAt = new Date().toISOString();
  const manifest: HatchPackageManifest = {
    packageName: request.value.packageName,
    packageVersion: plan.value.versionPlan,
    hatchPackageRef: packageRef,
    growUnitRef: plan.value.growUnitRef,
    runtimeContractRef: plan.value.runtimeContractRef,
    runtimeKernelType: plan.value.runtimeKernelType,
    readinessVerdictRef: plan.value.readinessVerdictRef,
    evidenceSummary: `${readiness.value.summary}; acceptedEvidence=${evidence.value.accepted}`,
    includedResources: plan.value.includedResources,
    excludedResources: plan.value.excludedResources,
    skillVersions: plan.value.skillVersions,
    dependencySummary: plan.value.dependencySummary,
    capabilitySummary: contract.value.capabilityRequirements.join(",") || "no declared capability",
    debugContractSummary: contract.value.shape.debug?.debugModes.join(",") ?? "debug not applicable",
    feedbackContractSummary: contract.value.shape.feedback?.feedbackEntryKinds.join(",") ?? "feedback not applicable",
    failureContractSummary: contract.value.shape.failure?.errorCodes.join(",") ?? "failure contract missing",
    buildReceipts: [receiptRef],
    policyDecisionRefs: plan.value.policyDecisionRefs,
    ...(plan.value.rollbackTarget === undefined ? {} : { rollbackTarget: plan.value.rollbackTarget }),
    rollbackReason: plan.value.rollbackReason,
    createdAt,
    source: plan.value.source,
    audit: plan.value.audit
  };
  const document: HatchPackageDocument = { manifest, resources: resources.value };
  const artifact = await runtime.options.artifactRegistry.registerArtifact({
    kind: "hatch_package",
    content: JSON.stringify(document, null, 2),
    mediaType: "application/vnd.feng.hatch-package+json",
    encoding: "utf8",
    source: plan.value.source,
    version: plan.value.versionPlan,
    audit: plan.value.audit,
    privacyClass: packagePrivacy(plan.value.includedResources.map((item) => item.privacyClass)),
    retentionClass: "hatch_scoped",
    producerModule: "hatch-builder"
  });
  if (!artifact.ok) return artifact;
  const receipt: HatchBuildReceipt = {
    buildReceiptRef: receiptRef,
    hatchBuildPlanRef: planRef,
    hatchPackageRef: packageRef,
    artifactRef: artifact.value,
    includedCount: plan.value.includedResources.length,
    excludedCount: plan.value.excludedResources.length,
    builtAt: createdAt
  };
  const record: HatchPackageRecord = {
    hatchPackageId: packageRef.id,
    hatchPackageRef: packageRef,
    packageName: request.value.packageName,
    hatchRequestRef: plan.value.hatchRequestRef,
    hatchBuildPlanRef: planRef,
    growUnitRef: plan.value.growUnitRef,
    runtimeContractRef: plan.value.runtimeContractRef,
    readinessVerdictRef: plan.value.readinessVerdictRef,
    version: plan.value.versionPlan,
    lifecycle: "packaged",
    artifactRef: artifact.value,
    manifestRef: artifact.value,
    includedResourceRefs: plan.value.includedResources.map((item) => item.artifactRef),
    excludedResourceRefs: plan.value.excludedResources.map((item) => item.exclusionRef),
    policyDecisionRefs: plan.value.policyDecisionRefs,
    validationSummaryRefs: validationSummaryRefs(plan.value.includedResources),
    buildReceiptRef: receipt.buildReceiptRef,
    ...(plan.value.rollbackTarget === undefined ? {} : { rollbackTarget: plan.value.rollbackTarget }),
    source: plan.value.source,
    audit: plan.value.audit,
    createdAt,
    updatedAt: createdAt,
    recordVersion: 1
  };
  const write = await runtime.storage.writePackage(record, "write hatch package record");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addPackage(packageRef);
  if (!indexed.ok) return indexed;
  const growEvent = await appendHatchGrowEvent({
    runtime,
    request: request.value,
    eventType: hatchEventTypes.built,
    body: { hatchPackageRef: packageRef, artifactRef: artifact.value, buildReceiptRef: receipt.buildReceiptRef }
  });
  if (!growEvent.ok) return growEvent;
  const packageEvent = await appendHatchPackageEvent({
    runtime,
    record,
    eventType: hatchEventTypes.built,
    body: { hatchPackageRef: packageRef, artifactRef: artifact.value, included: receipt.includedCount, excluded: receipt.excludedCount }
  });
  return packageEvent.ok ? ok(packageRef) : packageEvent;
}

export async function verifyHatchPackageRecord(
  runtime: HatchRuntime,
  ref: HatchPackageRef
): Promise<Result<HatchPackageVerification>> {
  const record = await runtime.storage.readPackage(ref);
  if (!record.ok) return record;
  const checks: HatchPackageCheck[] = [];
  const artifact = await runtime.options.artifactRegistry.materializeArtifact(record.value.artifactRef, {
    reason: "verify hatch package",
    maxBytes: 4 * 1024 * 1024,
    allowArchived: true
  });
  checks.push({ name: "package artifact readable", passed: artifact.ok && artifact.value.status === "available", detail: artifact.ok ? artifact.value.status : artifact.error.message });
  const readiness = await runtime.options.evidenceReadiness.explainReadinessVerdict(record.value.readinessVerdictRef);
  checks.push({ name: "readiness ready_to_hatch", passed: readiness.ok && readiness.value.summary.startsWith("ready_to_hatch"), detail: readiness.ok ? readiness.value.summary : readiness.error.message });
  const contract = await runtime.options.runtimeContractRegistry.getRuntimeContract(record.value.runtimeContractRef);
  checks.push({ name: "runtime contract locked", passed: contract.ok && contract.value.lifecycle === "locked_for_hatch", detail: contract.ok ? contract.value.lifecycle : contract.error.message });
  for (const artifactRef of record.value.includedResourceRefs) {
    const readable = await runtime.options.artifactRegistry.materializeArtifact(artifactRef, { reason: "verify included resource", maxBytes: 512 * 1024 });
    checks.push({ name: `resource readable ${artifactRef.id}`, passed: readable.ok && readable.value.status === "available", detail: readable.ok ? readable.value.status : readable.error.message });
  }
  const secretFree = artifact.ok && typeof artifact.value.content === "string"
    ? packagedContentHasNoSecret(artifact.value.content)
    : false;
  checks.push({ name: "package contains no secret-like material", passed: secretFree, detail: "secret scan over packaged resource content" });
  const blockers = checks.filter((item) => !item.passed).map((item) => `${item.name}: ${item.detail}`);
  const verification: HatchPackageVerification = {
    hatchVerificationRef: newHatchVerificationRef(),
    hatchPackageRef: ref,
    passed: blockers.length === 0,
    checks,
    blockers,
    createdAt: new Date().toISOString()
  };
  const write = await runtime.storage.writeVerification(verification, "write hatch package verification");
  if (!write.ok) return write;
  return ok(verification);
}

export async function publishLocalHatchPackageRecord(
  runtime: HatchRuntime,
  ref: HatchPackageRef,
  input: { readonly reason: string; readonly policyContext?: Parameters<typeof evaluateHatchPolicy>[0]["context"] }
): Promise<Result<HatchPublishReceipt>> {
  const record = await runtime.storage.readPackage(ref);
  if (!record.ok) return record;
  if (record.value.lifecycle === "retracted" || record.value.lifecycle === "failed") {
    return hatchErr({ code: "invalid_state", message: "package cannot be published from current lifecycle" });
  }
  const verification = await verifyHatchPackageRecord(runtime, ref);
  if (!verification.ok) return verification;
  if (!verification.value.passed) return hatchErr({ code: "package_verification_failed", message: verification.value.blockers.join("; ") });
  const policy = await evaluateHatchPolicy({
    runtime,
    capability: "hatch.publish",
    resourceSummary: `hatch-package:${ref.id}`,
    operation: "publish local hatch package",
    reason: input.reason,
    source: record.value.source,
    growUnit: record.value.growUnitRef,
    ...(input.policyContext === undefined ? {} : { context: input.policyContext })
  });
  if (!policy.ok) return policy;
  if (!policyAllows(policy.value)) {
    return hatchErr({ code: policy.value.verdict === "deny" ? "policy_blocked" : "approval_required", message: policy.value.explanation });
  }
  const receipt = await transitionPackage(runtime, record.value, "published_local", input.reason, hatchEventTypes.publishedLocal, policy.value);
  return receipt.ok ? ok({ ...receipt.value, policyDecision: policy.value }) : receipt;
}

export async function retractHatchPackageRecord(runtime: HatchRuntime, ref: HatchPackageRef, reason: string) {
  const record = await runtime.storage.readPackage(ref);
  return record.ok ? transitionPackage(runtime, record.value, "retracted", reason, hatchEventTypes.retracted) : record;
}

export async function supersedeHatchPackageRecord(
  runtime: HatchRuntime,
  oldRef: HatchPackageRef,
  newRef: HatchPackageRef,
  reason: string
) {
  const oldRecord = await runtime.storage.readPackage(oldRef);
  if (!oldRecord.ok) return oldRecord;
  const newRecord = await runtime.storage.readPackage(newRef);
  if (!newRecord.ok) return newRecord;
  return transitionPackage(runtime, oldRecord.value, "superseded", reason, hatchEventTypes.superseded, undefined, { supersededBy: newRef });
}

async function transitionPackage(
  runtime: HatchRuntime,
  record: HatchPackageRecord,
  to: HatchLifecycle,
  reason: string,
  eventType: string,
  policyDecision?: import("../policy-boundary/index.js").PolicyDecision,
  body: Record<string, unknown> = {}
): Promise<Result<HatchLifecycleReceipt>> {
  const updated = {
    ...record,
    lifecycle: to,
    ...(to === "published_local" ? { publishedAt: new Date().toISOString() } : {}),
    updatedAt: new Date().toISOString(),
    recordVersion: record.recordVersion + 1
  };
  const write = await runtime.storage.writePackage(updated, reason);
  if (!write.ok) return write;
  const event = await appendHatchPackageEvent({
    runtime,
    record: updated,
    eventType,
    body: { hatchPackageRef: record.hatchPackageRef, from: record.lifecycle, to, reason, ...body }
  });
  if (!event.ok) return event;
  return ok({
    hatchPackageRef: record.hatchPackageRef,
    from: record.lifecycle,
    to,
    reason,
    recordWriteReceipt: write.value,
    eventReceipt: event.value,
    ...(policyDecision === undefined ? {} : { policyDecision })
  });
}

async function snapshotResources(
  runtime: HatchRuntime,
  resources: readonly { readonly artifactRef: ArtifactRef; readonly resourceRef: { readonly id: string }; readonly role: string; readonly targetPathHint: string; readonly contentHash: import("../file-store/index.js").ContentHash }[]
): Promise<Result<readonly PackagedResourceContent[]>> {
  const snapshots: PackagedResourceContent[] = [];
  for (const resource of resources) {
    const artifact = await runtime.options.artifactRegistry.resolveArtifact(resource.artifactRef);
    if (!artifact.ok) return artifact;
    const materialized = await runtime.options.artifactRegistry.materializeArtifact(resource.artifactRef, {
      reason: "snapshot hatch resource",
      maxBytes: 4 * 1024 * 1024
    });
    if (!materialized.ok || materialized.value.status !== "available") {
      return hatchErr({ code: "resource_unavailable", message: `resource ${resource.artifactRef.id} is unavailable` });
    }
    if (typeof materialized.value.content === "string") {
      snapshots.push({
        resourceRef: resource.resourceRef as PackagedResourceContent["resourceRef"],
        artifactRef: resource.artifactRef,
        role: resource.role as PackagedResourceContent["role"],
        targetPathHint: resource.targetPathHint,
        mediaType: artifact.value.mediaType,
        encoding: "utf8",
        content: materialized.value.content,
        contentHash: resource.contentHash
      });
    } else if (materialized.value.content instanceof Uint8Array) {
      snapshots.push({
        resourceRef: resource.resourceRef as PackagedResourceContent["resourceRef"],
        artifactRef: resource.artifactRef,
        role: resource.role as PackagedResourceContent["role"],
        targetPathHint: resource.targetPathHint,
        mediaType: artifact.value.mediaType,
        encoding: "base64",
        content: Buffer.from(materialized.value.content).toString("base64"),
        contentHash: resource.contentHash
      });
    } else if (materialized.value.contentHandle !== undefined) {
      snapshots.push({
        resourceRef: resource.resourceRef as PackagedResourceContent["resourceRef"],
        artifactRef: resource.artifactRef,
        role: resource.role as PackagedResourceContent["role"],
        targetPathHint: resource.targetPathHint,
        mediaType: artifact.value.mediaType,
        encoding: "external",
        contentHandle: materialized.value.contentHandle,
        contentHash: resource.contentHash
      });
    } else {
      return hatchErr({ code: "resource_unavailable", message: `resource ${resource.artifactRef.id} has no content` });
    }
  }
  return ok(snapshots);
}

async function packageVersionConflict(runtime: HatchRuntime, packageName: string, schemaVersion: string): Promise<Result<boolean>> {
  const packages = await runtime.storage.readAllPackages();
  return packages.ok
    ? ok(packages.value.some((record) => record.lifecycle !== "retracted" && record.packageName === packageName && record.version.schemaVersion === schemaVersion))
    : packages;
}

function firstRequiredExclusion(exclusions: readonly { readonly required: boolean; readonly reason: string; readonly detail: string }[]): Result<never> | undefined {
  const blocked = exclusions.find((item) => item.required);
  if (blocked === undefined) return undefined;
  if (blocked.reason === "contains_secret") return hatchErr({ code: "secret_detected", message: blocked.detail });
  if (blocked.reason === "retracted_artifact") return hatchErr({ code: "resource_retracted", message: blocked.detail });
  if (blocked.reason === "policy_blocked") return hatchErr({ code: "policy_blocked", message: blocked.detail });
  return hatchErr({ code: "resource_unavailable", message: blocked.detail });
}

function validationSummaryRefs(resources: readonly { readonly role: string; readonly artifactRef: ArtifactRef }[]): readonly ArtifactRef[] {
  return resources.filter((item) => item.role === "validation_summary").map((item) => item.artifactRef);
}

function packagePrivacy(levels: readonly PrivacyLevel[]): PrivacyLevel {
  if (levels.includes("contains_user_content")) return "contains_user_content";
  if (levels.includes("project_private")) return "project_private";
  if (levels.includes("workspace_private")) return "workspace_private";
  return "public";
}

function packagedContentHasNoSecret(content: string): boolean {
  try {
    const document = JSON.parse(content) as HatchPackageDocument;
    return document.resources.every((resource) =>
      resource.content === undefined || !/contains_secret|api[_-]?key|secret[_-]?value|secretMaterial|token["'\s:=-]/i.test(resource.content)
    );
  } catch {
    return false;
  }
}

import { randomUUID } from "node:crypto";
import type { ArtifactRef, HatchPackageRef } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import { makeHatchBuildPlanId, makeHatchBuildReceiptId, makeHatchExclusionId, makeHatchRequestId, makeHatchResourceId, makeHatchVerificationId } from "./brand.js";
import { hatchErr } from "./errors.js";
import { buildPlanRef, buildReceiptRef, exclusionRef, makeHatchPackageRef, requestRef, resourceRef, verificationRef } from "./refs.js";
import type {
  HatchBuildPlanRef,
  HatchBuildReceiptRef,
  HatchExclusionReason,
  HatchExclusionRef,
  HatchPackageQuery,
  HatchRequestInput,
  HatchRequestRef,
  HatchResourceRef,
  HatchVerificationRef
} from "./types.js";

export function newHatchRequestRef(): HatchRequestRef {
  return requestRef(makeHatchRequestId(`hatch-request-${randomUUID()}`));
}

export function newHatchBuildPlanRef(): HatchBuildPlanRef {
  return buildPlanRef(makeHatchBuildPlanId(`hatch-build-plan-${randomUUID()}`));
}

export function newHatchPackageRef(): HatchPackageRef {
  return makeHatchPackageRef(`hatch-package-${randomUUID()}`);
}

export function newHatchResourceRef(): HatchResourceRef {
  return resourceRef(makeHatchResourceId(`hatch-resource-${randomUUID()}`));
}

export function newHatchExclusionRef(): HatchExclusionRef {
  return exclusionRef(makeHatchExclusionId(`hatch-exclusion-${randomUUID()}`));
}

export function newHatchBuildReceiptRef(): HatchBuildReceiptRef {
  return buildReceiptRef(makeHatchBuildReceiptId(`hatch-build-receipt-${randomUUID()}`));
}

export function newHatchVerificationRef(): HatchVerificationRef {
  return verificationRef(makeHatchVerificationId(`hatch-verification-${randomUUID()}`));
}

export function validateHatchRequest(input: HatchRequestInput): Result<void> {
  if (input.reason.trim().length === 0) return hatchErr({ code: "invalid_input", message: "hatch reason is required" });
  if (input.requestedBy.trim().length === 0) return hatchErr({ code: "invalid_input", message: "requestedBy is required" });
  if (input.requestedVersion.schemaVersion.trim().length === 0) {
    return hatchErr({ code: "invalid_input", message: "package schemaVersion is required" });
  }
  if (input.packageName !== undefined && input.packageName.trim().length === 0) {
    return hatchErr({ code: "invalid_input", message: "packageName cannot be blank" });
  }
  return ok(undefined);
}

export function defaultPackageName(input: HatchRequestInput): string {
  return input.packageName?.trim() || `hatch-${input.growUnitRef.id}`;
}

export function secretContentDetected(content: string): boolean {
  return /contains_secret|api[_-]?key|secret[_-]?value|secretMaterial|token["'\s:=-]/i.test(content);
}

export function exclusionCodeForArtifactLifecycle(lifecycle: string): HatchExclusionReason | undefined {
  if (lifecycle === "retracted" || lifecycle === "deleted") return "retracted_artifact";
  if (lifecycle === "redacted" || lifecycle === "unavailable") return "unavailable_artifact";
  if (lifecycle === "archived") return "archived_artifact";
  return undefined;
}

export function artifactKey(ref: ArtifactRef): string {
  return ref.id;
}

export function matchesPackageQuery(record: { readonly lifecycle: string }, query: HatchPackageQuery): boolean {
  return query.lifecycle === undefined || record.lifecycle === query.lifecycle;
}

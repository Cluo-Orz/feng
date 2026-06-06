import { makeHatchPackageId, makeRef, type HatchPackageRef } from "../domain/index.js";
import type {
  HatchBuildPlanId,
  HatchBuildPlanRef,
  HatchBuildReceiptId,
  HatchBuildReceiptRef,
  HatchExclusionId,
  HatchExclusionRef,
  HatchRequestId,
  HatchRequestRef,
  HatchResourceId,
  HatchResourceRef,
  HatchVerificationId,
  HatchVerificationRef
} from "./types.js";

export const makeHatchPackageRef = (value: string): HatchPackageRef =>
  makeRef("hatch_package", makeHatchPackageId(value), { uri: `hatch-package://${value}` });
export const requestRef = (id: HatchRequestId): HatchRequestRef => ({ kind: "hatch_request", id, uri: `hatch-request://${id}` });
export const buildPlanRef = (id: HatchBuildPlanId): HatchBuildPlanRef => ({ kind: "hatch_build_plan", id, uri: `hatch-build-plan://${id}` });
export const resourceRef = (id: HatchResourceId): HatchResourceRef => ({ kind: "hatch_resource", id, uri: `hatch-resource://${id}` });
export const exclusionRef = (id: HatchExclusionId): HatchExclusionRef => ({ kind: "hatch_exclusion", id, uri: `hatch-exclusion://${id}` });
export const buildReceiptRef = (id: HatchBuildReceiptId): HatchBuildReceiptRef => ({ kind: "hatch_build_receipt", id, uri: `hatch-build-receipt://${id}` });
export const verificationRef = (id: HatchVerificationId): HatchVerificationRef => ({ kind: "hatch_verification", id, uri: `hatch-verification://${id}` });

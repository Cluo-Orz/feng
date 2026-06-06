import { randomUUID } from "node:crypto";
import { ok, type Result } from "../domain/result.js";
import type { ReadinessVerdictRef } from "../evidence-readiness/index.js";
import type { PolicyContext } from "../policy-boundary/index.js";
import { makeContractReportId } from "./brand.js";
import { runtimeContractEventTypes } from "./events.js";
import { contractErr } from "./errors.js";
import { assertMutable, assertUsableForHatch, completenessMissing, secretContentDetected } from "./logic.js";
import { reportRef } from "./refs.js";
import {
  appendContractEvent,
  evaluateContractArtifactPolicy,
  unsupportedCapabilities
} from "./runtime.js";
import type { RuntimeContractRuntime } from "./runtime.js";
import { transitionContract } from "./registry-flow.js";
import type {
  ContractCompletenessReport,
  ContractVerificationReport,
  RuntimeContractReceipt,
  RuntimeContractRecord
} from "./types.js";

export async function validateRuntimeContractRecord(
  runtime: RuntimeContractRuntime,
  ref: RuntimeContractRecord["runtimeContractRef"]
): Promise<Result<ContractCompletenessReport>> {
  const record = await runtime.storage.readContract(ref);
  if (!record.ok) return record;
  const mutable = assertMutable(record.value);
  if (!mutable.ok) return mutable;
  const missing = completenessMissing(record.value);
  const blockers = await referenceBlockers(runtime, record.value);
  if (!blockers.ok) return blockers;
  const materialized = await runtime.options.artifactRegistry.materializeArtifact(record.value.artifactRef, {
    reason: "validate runtime contract artifact",
    maxBytes: 512 * 1024,
    allowArchived: true
  });
  if (!materialized.ok) return materialized;
  if (materialized.value.status !== "available" || typeof materialized.value.content !== "string") {
    return contractErr({ code: "artifact_unavailable", message: "runtime contract artifact is not readable" });
  }
  const content = materialized.value.content;
  const privacyBlockers = secretContentDetected(content) ? ["contract artifact contains secret-like material"] : [];
  const report = await writeReport(runtime, record.value, {
    missing,
    blockers: [...blockers.value, ...privacyBlockers],
    complete: missing.length === 0 && blockers.value.length === 0 && privacyBlockers.length === 0
  });
  if (!report.ok) return report;
  const updated = {
    ...record.value,
    lifecycle: report.value.complete ? "validated" as const : "verification_failed" as const,
    latestCompletenessReportRef: report.value.reportRef,
    updatedAt: new Date().toISOString(),
    recordVersion: record.value.recordVersion + 1
  };
  const write = await runtime.storage.writeContract(updated, "validate runtime contract");
  if (!write.ok) return write;
  const event = await appendContractEvent({
    runtime,
    record: updated,
    eventType: report.value.complete ? runtimeContractEventTypes.validated : runtimeContractEventTypes.verificationFailed,
    body: { runtimeContractRef: ref, complete: report.value.complete, missing: report.value.missing, blockers: report.value.blockers }
  });
  return event.ok ? ok(report.value) : event;
}

export async function verifyRuntimeContractForHatchRecord(
  runtime: RuntimeContractRuntime,
  ref: RuntimeContractRecord["runtimeContractRef"],
  readinessVerdictRef: ReadinessVerdictRef
): Promise<Result<ContractVerificationReport>> {
  const record = await runtime.storage.readContract(ref);
  if (!record.ok) return record;
  if (record.value.lifecycle === "retracted") {
    return contractErr({ code: "contract_retracted", message: "retracted contract cannot be verified for hatch" });
  }
  const readiness = await runtime.options.evidenceReadiness.explainReadinessVerdict(readinessVerdictRef);
  if (!readiness.ok) return contractErr({ code: "readiness_missing", message: readiness.error.message });
  const completeness = await validateRuntimeContractRecord(runtime, ref);
  if (!completeness.ok) return completeness;
  const unsupported = unsupportedCapabilities(runtime, record.value.capabilityRequirements);
  const readinessBlockers = readiness.value.summary.startsWith("ready_to_hatch") ? [] : ["readiness verdict is not ready_to_hatch"];
  const blockers = [...completeness.value.blockers, ...unsupported.map((item) => `unsupported capability: ${item}`), ...readinessBlockers];
  const reportRefValue = reportRef(makeContractReportId(`contract-report-${randomUUID()}`));
  const report: ContractVerificationReport = {
    ...completeness.value,
    reportRef: reportRefValue,
    readinessVerdictRef,
    verifiedForHatch: completeness.value.complete && blockers.length === 0,
    blockers,
    complete: completeness.value.complete && blockers.length === 0,
    createdAt: new Date().toISOString()
  };
  const writeReportResult = await runtime.storage.writeReport(report, "write contract verification report");
  if (!writeReportResult.ok) return writeReportResult;
  const current = await runtime.storage.readContract(ref);
  if (!current.ok) return current;
  const updated = {
    ...current.value,
    lifecycle: report.verifiedForHatch ? "validated" as const : "verification_failed" as const,
    readinessVerdictRef,
    latestVerificationReportRef: report.reportRef,
    updatedAt: new Date().toISOString(),
    recordVersion: current.value.recordVersion + 1
  };
  const write = await runtime.storage.writeContract(updated, "verify runtime contract for hatch");
  if (!write.ok) return write;
  const event = await appendContractEvent({
    runtime,
    record: updated,
    eventType: report.verifiedForHatch ? runtimeContractEventTypes.validated : runtimeContractEventTypes.verificationFailed,
    body: { runtimeContractRef: ref, readinessVerdictRef, verifiedForHatch: report.verifiedForHatch, blockers: report.blockers }
  });
  if (!event.ok) return event;
  if (unsupported.length > 0) {
    return contractErr({ code: "capability_unsupported", message: `unsupported capability: ${unsupported.join(", ")}` });
  }
  return ok(report);
}

export async function lockRuntimeContractForHatchRecord(
  runtime: RuntimeContractRuntime,
  ref: RuntimeContractRecord["runtimeContractRef"],
  input: { readonly reason: string; readonly policyContext?: PolicyContext }
): Promise<Result<RuntimeContractReceipt>> {
  const record = await runtime.storage.readContract(ref);
  if (!record.ok) return record;
  const usable = assertUsableForHatch(record.value);
  if (!usable.ok) return usable;
  const report = await runtime.storage.readReport(record.value.latestVerificationReportRef!);
  if (!report.ok) return report;
  if (!("verifiedForHatch" in report.value) || report.value.verifiedForHatch !== true) {
    return contractErr({ code: "contract_not_ready", message: "latest verification report is not hatch-ready" });
  }
  const policy = await evaluateContractArtifactPolicy({
    runtime,
    record: record.value,
    capability: "hatch.publish",
    operation: "lock runtime contract for hatch",
    reason: input.reason,
    ...(input.policyContext === undefined ? {} : { context: input.policyContext })
  });
  if (!policy.ok) return policy;
  if (policy.value.verdict === "deny") return contractErr({ code: "policy_blocked", message: policy.value.explanation });
  if (policy.value.verdict === "ask") return contractErr({ code: "approval_required", message: policy.value.explanation });
  const withPolicy = {
    ...record.value,
    policyDecisionRefs: [...record.value.policyDecisionRefs, policy.value.policyDecisionId]
  };
  const write = await runtime.storage.writeContract(withPolicy, "record hatch lock policy decision");
  if (!write.ok) return write;
  const locked = await transitionContract(runtime, withPolicy, "locked_for_hatch", input.reason);
  return locked.ok ? ok({ ...locked.value, policyDecision: policy.value }) : locked;
}

async function referenceBlockers(runtime: RuntimeContractRuntime, record: RuntimeContractRecord): Promise<Result<readonly string[]>> {
  const blockers: string[] = [];
  for (const ref of record.evidenceRefs) {
    const artifact = await runtime.options.artifactRegistry.resolveArtifact(ref);
    if (!artifact.ok) return artifact;
    if (artifact.value.lifecycle === "redacted" || artifact.value.lifecycle === "unavailable" || artifact.value.lifecycle === "retracted") {
      blockers.push(`evidence artifact ${ref.id} is ${artifact.value.lifecycle}`);
    }
  }
  return ok(blockers);
}

async function writeReport(
  runtime: RuntimeContractRuntime,
  record: RuntimeContractRecord,
  input: { readonly complete: boolean; readonly missing: readonly string[]; readonly blockers: readonly string[] }
): Promise<Result<ContractCompletenessReport>> {
  const ref = reportRef(makeContractReportId(`contract-report-${randomUUID()}`));
  const report: ContractCompletenessReport = {
    reportRef: ref,
    runtimeContractRef: record.runtimeContractRef,
    complete: input.complete,
    missing: input.missing,
    blockers: input.blockers,
    artifactRef: record.artifactRef,
    createdAt: new Date().toISOString()
  };
  const write = await runtime.storage.writeReport(report, "write contract completeness report");
  return write.ok ? ok(report) : write;
}

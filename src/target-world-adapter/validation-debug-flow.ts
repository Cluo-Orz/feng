import { ok, type Result } from "../domain/result.js";
import { targetErr } from "./errors.js";
import {
  appendTargetWorldEvent,
  evaluateTargetPolicy,
  policyAllows,
  registerTargetArtifact,
  targetWorldEventTypes,
  type TargetWorldRuntime
} from "./runtime.js";
import { newDebugSignalRef, newFailureMappingRef, newValidationReportRef } from "./logic.js";
import type {
  TargetDebugSignal,
  TargetDebugSignalInput,
  TargetFailureMapping,
  TargetFailureMappingInput,
  TargetValidationInput,
  TargetValidationReport
} from "./types.js";

export async function runTargetValidationRecord(
  runtime: TargetWorldRuntime,
  input: TargetValidationInput
): Promise<Result<TargetValidationReport>> {
  const target = await runtime.storage.readTargetWorld(input.targetWorldRef);
  if (!target.ok) return target;
  if (!target.value.validationKinds.includes(input.validationKind)) {
    return targetErr({ code: "target_validation_failed", message: "target world does not support validation kind" });
  }
  const contract = await runtime.options.runtimeContractRegistry.getRuntimeContract(input.runtimeContractRef);
  if (!contract.ok) return contract;
  const pkg = await runtime.options.hatchBuilder.getHatchPackage(input.hatchPackageRef);
  if (!pkg.ok) return pkg;
  if (pkg.value.runtimeContractRef.id !== input.runtimeContractRef.id) {
    return targetErr({ code: "contract_incompatible", message: "validation package and contract do not match" });
  }
  const ref = newValidationReportRef();
  const artifact = await registerTargetArtifact({
    runtime,
    kind: "validation_report",
    content: {
      validationReportRef: ref,
      validationKind: input.validationKind,
      result: input.result,
      summary: input.summary,
      inputRefs: input.inputRefs,
      outputRefs: input.outputRefs,
      failureMappingRefs: input.failureMappingRefs ?? []
    },
    privacyClass: target.value.privacyBoundary,
    source: input.source,
    audit: input.audit
  });
  if (!artifact.ok) return artifact;
  const record: TargetValidationReport = {
    ...input,
    validationReportId: ref.id,
    validationReportRef: ref,
    failureMappingRefs: input.failureMappingRefs ?? [],
    artifactRef: artifact.value,
    evidenceCandidateRef: artifact.value,
    createdAt: new Date().toISOString(),
    recordVersion: 1
  };
  const write = await runtime.storage.writeValidation(record, "write target validation report");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addValidation(ref);
  if (!indexed.ok) return indexed;
  const event = await appendTargetWorldEvent({
    runtime,
    targetWorldRef: input.targetWorldRef,
    eventType: targetWorldEventTypes.validationReported,
    body: { validationReportRef: ref, validationKind: input.validationKind, result: input.result, artifactRef: artifact.value },
    source: input.source,
    audit: input.audit
  });
  return event.ok ? ok(record) : event;
}

export async function mapTargetFailureRecord(
  runtime: TargetWorldRuntime,
  input: TargetFailureMappingInput
): Promise<Result<TargetFailureMapping>> {
  const target = await runtime.storage.readTargetWorld(input.targetWorldRef);
  if (!target.ok) return target;
  const contract = await runtime.options.runtimeContractRegistry.getRuntimeContract(input.runtimeContractRef);
  if (!contract.ok) return contract;
  const ref = newFailureMappingRef();
  const record: TargetFailureMapping = {
    ...input,
    failureMappingId: ref.id,
    failureMappingRef: ref,
    createdAt: new Date().toISOString(),
    recordVersion: 1
  };
  const write = await runtime.storage.writeFailureMapping(record, "write target failure mapping");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addFailureMapping(ref);
  if (!indexed.ok) return indexed;
  const event = await appendTargetWorldEvent({
    runtime,
    targetWorldRef: input.targetWorldRef,
    eventType: targetWorldEventTypes.failureMapped,
    body: { failureMappingRef: ref, targetFailureKind: input.targetFailureKind, normalizedFailureKind: input.normalizedFailureKind },
    source: input.source,
    audit: input.audit
  });
  return event.ok ? ok(record) : event;
}

export async function recordTargetDebugSignalRecord(
  runtime: TargetWorldRuntime,
  input: TargetDebugSignalInput
): Promise<Result<TargetDebugSignal>> {
  const target = await runtime.storage.readTargetWorld(input.targetWorldRef);
  if (!target.ok) return target;
  if (!target.value.debugSignalKinds.includes(input.signalKind)) {
    return targetErr({ code: "debug_signal_blocked", message: "target world does not support debug signal kind" });
  }
  const contract = await runtime.options.runtimeContractRegistry.getRuntimeContract(input.runtimeContractRef);
  if (!contract.ok) return contract;
  const pkg = await runtime.options.hatchBuilder.getHatchPackage(input.hatchPackageRef);
  if (!pkg.ok) return pkg;
  if (pkg.value.runtimeContractRef.id !== input.runtimeContractRef.id) {
    return targetErr({ code: "contract_incompatible", message: "debug signal package and contract do not match" });
  }
  const decision = input.uploadRequested === true
    ? await evaluateTargetPolicy({
        runtime,
        capability: "debug_trace.upload",
        targetWorldRef: input.targetWorldRef,
        resourceSummary: `debug-signal:${input.signalKind}`,
        operation: "record target debug signal upload permission",
        reason: input.summary,
        source: input.source,
        ...(input.policyContext === undefined ? {} : { context: input.policyContext })
      })
    : undefined;
  if (decision !== undefined && !decision.ok) return decision;
  if (decision !== undefined && !policyAllows(decision.value)) {
    return targetErr({ code: "debug_signal_blocked", message: decision.value.explanation });
  }
  const ref = newDebugSignalRef();
  const artifact = await registerTargetArtifact({
    runtime,
    kind: "summary",
    content: {
      debugSignalRef: ref,
      signalKind: input.signalKind,
      summary: input.summary,
      detail: input.detail,
      feedbackCandidateHint: input.feedbackCandidateHint
    },
    privacyClass: input.privacyClass,
    source: input.source,
    audit: input.audit
  });
  if (!artifact.ok) return artifact;
  const record: TargetDebugSignal = {
    targetWorldRef: input.targetWorldRef,
    runtimeContractRef: input.runtimeContractRef,
    hatchPackageRef: input.hatchPackageRef,
    signalKind: input.signalKind,
    summary: input.summary,
    privacyClass: input.privacyClass,
    ...(input.feedbackCandidateHint === undefined ? {} : { feedbackCandidateHint: input.feedbackCandidateHint }),
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    source: input.source,
    audit: input.audit,
    debugSignalId: ref.id,
    debugSignalRef: ref,
    artifactRef: artifact.value,
    ...(decision?.value === undefined ? {} : { policyDecisionId: decision.value.policyDecisionId }),
    uploadRequested: input.uploadRequested === true,
    createdAt: new Date().toISOString(),
    recordVersion: 1
  };
  const write = await runtime.storage.writeDebugSignal(record, "write target debug signal");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addDebugSignal(ref);
  if (!indexed.ok) return indexed;
  const event = await appendTargetWorldEvent({
    runtime,
    targetWorldRef: input.targetWorldRef,
    eventType: targetWorldEventTypes.debugSignalRecorded,
    body: { debugSignalRef: ref, signalKind: input.signalKind, artifactRef: artifact.value, uploadRequested: record.uploadRequested },
    source: input.source,
    audit: input.audit,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId })
  });
  return event.ok ? ok(record) : event;
}

import { ok, type Result } from "../domain/result.js";
import { targetWorldEventTypes, appendTargetWorldEvent, registerTargetArtifact, type TargetWorldRuntime } from "./runtime.js";
import {
  contractAllowedActions,
  contractForbiddenActions,
  contractInputKinds,
  contractOutputKinds,
  intersects,
  newCompatibilityReportRef
} from "./logic.js";
import type {
  TargetWorldCompatibilityReport,
  TargetWorldCompatibilityReportRef
} from "./types.js";
import type { RuntimeContractRef, TargetWorldRef } from "../domain/index.js";

export async function checkRuntimeContractCompatibilityRecord(
  runtime: TargetWorldRuntime,
  runtimeContractRef: RuntimeContractRef,
  targetWorldRef: TargetWorldRef
): Promise<Result<TargetWorldCompatibilityReport>> {
  const target = await runtime.storage.readTargetWorld(targetWorldRef);
  if (!target.ok) return target;
  const contract = await runtime.options.runtimeContractRegistry.getRuntimeContract(runtimeContractRef);
  if (!contract.ok) return contract;
  const adapters = await runtime.storage.readAllAdapters();
  if (!adapters.ok) return adapters;

  const inputKinds = contractInputKinds(contract.value);
  const outputKinds = contractOutputKinds(contract.value);
  const allowedActions = contractAllowedActions(contract.value);
  const forbiddenActions = contractForbiddenActions(contract.value);
  const matchedInputKinds = inputKinds.length === 0 ? [] : intersects(inputKinds, target.value.inputKinds);
  const matchedOutputKinds = outputKinds.length === 0 ? [] : intersects(outputKinds, target.value.outputKinds);
  const matchedActionKinds = allowedActions.length === 0 ? [] : intersects(allowedActions, target.value.actionKinds);
  const activeAdapters = adapters.value.filter((item) =>
    item.targetWorldRef.id === targetWorldRef.id
    && item.lifecycle === "active"
    && item.supportedRuntimeKernelTypes.includes(contract.value.runtimeKernelType)
  );
  const blockers = [
    ...(contract.value.lifecycle === "retracted" ? ["runtime contract is retracted"] : []),
    ...(inputKinds.length > 0 && matchedInputKinds.length === 0 ? ["no shared input kind"] : []),
    ...(outputKinds.length > 0 && matchedOutputKinds.length === 0 ? ["no shared output kind"] : []),
    ...allowedActions.filter((action) => !target.value.actionKinds.includes(action)).map((action) => `target action unsupported:${action}`),
    ...forbiddenActions.filter((action) => allowedActions.includes(action)).map((action) => `action both allowed and forbidden:${action}`),
    ...(activeAdapters.length === 0 ? ["no active adapter supports runtime kernel"] : [])
  ];
  const warnings = [
    ...(inputKinds.length === 0 ? ["contract has no explicit input modes"] : []),
    ...(outputKinds.length === 0 ? ["contract has no explicit output modes"] : []),
    ...(allowedActions.length === 0 ? ["contract declares no target actions"] : [])
  ];
  const reportRef = newCompatibilityReportRef();
  const artifact = await registerTargetArtifact({
    runtime,
    kind: "validation_report",
    content: {
      reportRef,
      runtimeContractRef,
      targetWorldRef,
      compatible: blockers.length === 0,
      matchedInputKinds,
      matchedOutputKinds,
      matchedActionKinds,
      blockers,
      warnings
    },
    privacyClass: target.value.privacyBoundary,
    source: target.value.source,
    audit: { ...target.value.audit, reason: "target world compatibility report" }
  });
  if (!artifact.ok) return artifact;
  const report: TargetWorldCompatibilityReport = {
    reportId: reportRef.id,
    reportRef,
    runtimeContractRef,
    targetWorldRef,
    compatible: blockers.length === 0,
    matchedInputKinds,
    matchedOutputKinds,
    matchedActionKinds,
    blockers,
    warnings,
    artifactRef: artifact.value,
    createdAt: new Date().toISOString()
  };
  const write = await runtime.storage.writeCompatibility(report, "write target world compatibility report");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addCompatibility(reportRef);
  if (!indexed.ok) return indexed;
  const event = await appendTargetWorldEvent({
    runtime,
    targetWorldRef,
    eventType: targetWorldEventTypes.compatibilityChecked,
    body: { reportRef, runtimeContractRef, compatible: report.compatible, blockers },
    source: target.value.source,
    audit: target.value.audit
  });
  return event.ok ? ok(report) : event;
}

export async function explainCompatibilityRecord(
  runtime: TargetWorldRuntime,
  ref: TargetWorldCompatibilityReportRef
): Promise<Result<readonly string[]>> {
  const report = await runtime.storage.readCompatibility(ref);
  if (!report.ok) return report;
  return ok([
    `runtimeContract=${report.value.runtimeContractRef.id}`,
    `targetWorld=${report.value.targetWorldRef.id}`,
    `compatible=${report.value.compatible}`,
    `inputs=${report.value.matchedInputKinds.join(",") || "none"}`,
    `outputs=${report.value.matchedOutputKinds.join(",") || "none"}`,
    `actions=${report.value.matchedActionKinds.join(",") || "none"}`,
    `blockers=${report.value.blockers.join(";") || "none"}`,
    `warnings=${report.value.warnings.join(";") || "none"}`
  ]);
}

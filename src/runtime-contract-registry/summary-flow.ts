import { ok, type Result } from "../domain/result.js";
import type { RuntimeContractSummary } from "../domain/contracts.js";
import { diffContracts, kernelSummary } from "./logic.js";
import type { RuntimeContractRuntime } from "./runtime.js";
import type { RuntimeContractExplanation } from "./types.js";

export async function buildRuntimeContractSummaryRecord(
  runtime: RuntimeContractRuntime,
  ref: Parameters<RuntimeContractRuntime["storage"]["readContract"]>[0]
): Promise<Result<RuntimeContractSummary>> {
  const record = await runtime.storage.readContract(ref);
  if (!record.ok) return record;
  return ok({
    runtimeContractRef: ref,
    runtimeKernelType: record.value.runtimeKernelType,
    version: record.value.version,
    inputSummary: `${record.value.shape.input?.inputModes.join(", ") ?? "missing input contract"}`,
    outputSummary: `${record.value.shape.output?.outputModes.join(", ") ?? record.value.shape.event?.outputModes.join(", ") ?? "missing output/event contract"}`,
    actionBoundarySummary: record.value.shape.actionBoundary?.boundaryDeclaration ?? "missing action boundary"
  });
}

export async function explainRuntimeContractRecord(
  runtime: RuntimeContractRuntime,
  ref: Parameters<RuntimeContractRuntime["storage"]["readContract"]>[0]
): Promise<Result<RuntimeContractExplanation>> {
  const record = await runtime.storage.readContract(ref);
  if (!record.ok) return record;
  return ok({
    runtimeContractRef: ref,
    summary: `${record.value.name} ${record.value.version.schemaVersion}: ${kernelSummary(record.value.runtimeKernelType)}`,
    facts: [
      `lifecycle=${record.value.lifecycle}`,
      `kernel=${record.value.runtimeKernelType}`,
      `inputModes=${record.value.shape.input?.inputModes.join(",") ?? "missing"}`,
      `outputModes=${record.value.shape.output?.outputModes.join(",") ?? record.value.shape.event?.outputModes.join(",") ?? "missing"}`,
      `dialogueInput=${record.value.shape.input?.dialogueInputSupport === true}`,
      `feedbackEntries=${record.value.shape.feedback?.feedbackEntryKinds.join(",") ?? "missing"}`,
      `debugModes=${record.value.shape.debug?.debugModes.join(",") ?? "missing"}`,
      `capabilities=${record.value.capabilityRequirements.join(",") || "missing"}`,
      `artifact=${record.value.artifactRef.id}`
    ]
  });
}

export async function explainCompatibilityRecord(
  runtime: RuntimeContractRuntime,
  ref: Parameters<RuntimeContractRuntime["storage"]["readContract"]>[0],
  targetVersion: string
): Promise<Result<RuntimeContractExplanation>> {
  const current = await runtime.storage.readContract(ref);
  if (!current.ok) return current;
  const all = await runtime.storage.readAllContracts();
  if (!all.ok) return all;
  const target = all.value.find((item) =>
    item.growUnitRef.id === current.value.growUnitRef.id && item.version.schemaVersion === targetVersion
  );
  if (target === undefined) {
    return ok({
      runtimeContractRef: ref,
      summary: `target version ${targetVersion} not found`,
      facts: [`current=${current.value.version.schemaVersion}`, "compatible=false"]
    });
  }
  const diff = diffContracts(current.value, target);
  return ok({
    runtimeContractRef: ref,
    summary: diff.compatible ? "compatible contract version" : "breaking contract version",
    facts: [
      `from=${diff.from.id}`,
      `to=${diff.to.id}`,
      `changed=${diff.changedFields.join(",") || "none"}`,
      `breaking=${diff.breakingChanges.join(",") || "none"}`,
      `compatible=${diff.compatible}`
    ]
  });
}

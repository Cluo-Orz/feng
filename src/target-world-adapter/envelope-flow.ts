import { ok, type Result } from "../domain/result.js";
import { targetErr } from "./errors.js";
import { targetWorldEventTypes, appendTargetWorldEvent, registerTargetArtifact, type TargetWorldRuntime } from "./runtime.js";
import { contractInputKinds, contractOutputKinds, newWorldInputRef, newWorldOutputRef } from "./logic.js";
import type {
  TargetOutputValidation,
  WorldInputEnvelope,
  WorldInputEnvelopeInput,
  WorldOutputEnvelope,
  WorldOutputEnvelopeInput,
  WorldOutputEnvelopeRef
} from "./types.js";
import type { HatchPackageRef, RuntimeContractRef, TargetWorldRef } from "../domain/index.js";

export async function normalizeWorldInputRecord(
  runtime: TargetWorldRuntime,
  input: WorldInputEnvelopeInput
): Promise<Result<WorldInputEnvelope>> {
  const common = await assertRuntimeBoundary(runtime, input.targetWorldRef, input.runtimeContractRef, input.hatchPackageRef);
  if (!common.ok) return common;
  if (!common.value.target.inputKinds.includes(input.inputKind)) {
    return targetErr({ code: "contract_incompatible", message: "target world does not support input kind" });
  }
  if (contractInputKinds(common.value.contract).length > 0 && !contractInputKinds(common.value.contract).includes(input.inputKind)) {
    return targetErr({ code: "contract_incompatible", message: "runtime contract does not support input kind" });
  }
  if (input.rawInputArtifactRef !== undefined) {
    const raw = await runtime.options.artifactRegistry.resolveArtifact(input.rawInputArtifactRef);
    if (!raw.ok) return targetErr({ code: "artifact_unavailable", message: raw.error.message });
  }
  const ref = newWorldInputRef();
  const artifact = await registerTargetArtifact({
    runtime,
    kind: "summary",
    content: {
      worldInputRef: ref,
      inputKind: input.inputKind,
      normalizedInput: input.normalizedInput,
      rawInputArtifactRef: input.rawInputArtifactRef,
      stateSnapshotRef: input.stateSnapshotRef
    },
    privacyClass: input.privacyClass,
    source: input.source,
    audit: input.audit
  });
  if (!artifact.ok) return artifact;
  const record: WorldInputEnvelope = {
    ...input,
    worldInputId: ref.id,
    worldInputRef: ref,
    normalizedInputRef: artifact.value,
    createdAt: new Date().toISOString(),
    recordVersion: 1
  };
  const write = await runtime.storage.writeWorldInput(record, "write world input envelope");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addWorldInput(ref);
  if (!indexed.ok) return indexed;
  const event = await appendTargetWorldEvent({
    runtime,
    targetWorldRef: input.targetWorldRef,
    eventType: targetWorldEventTypes.inputNormalized,
    body: { worldInputRef: ref, inputKind: input.inputKind, normalizedInputRef: artifact.value },
    source: input.source,
    audit: input.audit,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId })
  });
  return event.ok ? ok(record) : event;
}

export async function normalizeRuntimeOutputRecord(
  runtime: TargetWorldRuntime,
  input: WorldOutputEnvelopeInput
): Promise<Result<WorldOutputEnvelope>> {
  const common = await assertRuntimeBoundary(runtime, input.targetWorldRef, input.runtimeContractRef, input.hatchPackageRef);
  if (!common.ok) return common;
  if (!common.value.target.outputKinds.includes(input.outputKind)) {
    return targetErr({ code: "runtime_output_invalid", message: "target world does not support output kind" });
  }
  if (contractOutputKinds(common.value.contract).length > 0 && !contractOutputKinds(common.value.contract).includes(input.outputKind)) {
    return targetErr({ code: "runtime_output_invalid", message: "runtime contract does not support output kind" });
  }
  const ref = newWorldOutputRef();
  const artifact = await registerTargetArtifact({
    runtime,
    kind: "summary",
    content: {
      worldOutputRef: ref,
      outputKind: input.outputKind,
      normalizedOutput: input.normalizedOutput,
      runtimeOutputRef: input.runtimeOutputRef
    },
    privacyClass: input.privacyClass,
    source: input.source,
    audit: input.audit
  });
  if (!artifact.ok) return artifact;
  const record: WorldOutputEnvelope = {
    ...input,
    worldOutputId: ref.id,
    worldOutputRef: ref,
    normalizedOutputRef: artifact.value,
    actionRequestRefs: [],
    eventRefs: [],
    createdAt: new Date().toISOString(),
    recordVersion: 1
  };
  const write = await runtime.storage.writeWorldOutput(record, "write world output envelope");
  if (!write.ok) return write;
  const indexed = await runtime.storage.addWorldOutput(ref);
  if (!indexed.ok) return indexed;
  const event = await appendTargetWorldEvent({
    runtime,
    targetWorldRef: input.targetWorldRef,
    eventType: targetWorldEventTypes.outputNormalized,
    body: { worldOutputRef: ref, outputKind: input.outputKind, normalizedOutputRef: artifact.value },
    source: input.source,
    audit: input.audit,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId })
  });
  return event.ok ? ok(record) : event;
}

export async function validateWorldOutputRecord(
  runtime: TargetWorldRuntime,
  ref: WorldOutputEnvelopeRef
): Promise<Result<TargetOutputValidation>> {
  const output = await runtime.storage.readWorldOutput(ref);
  if (!output.ok) return output;
  const common = await assertRuntimeBoundary(runtime, output.value.targetWorldRef, output.value.runtimeContractRef, output.value.hatchPackageRef);
  if (!common.ok) return common;
  const blockers = [
    ...(!common.value.target.outputKinds.includes(output.value.outputKind) ? ["target world output kind unsupported"] : []),
    ...(contractOutputKinds(common.value.contract).length > 0 && !contractOutputKinds(common.value.contract).includes(output.value.outputKind)
      ? ["runtime contract output kind unsupported"]
      : [])
  ];
  return ok({
    worldOutputRef: ref,
    result: blockers.length === 0 ? "passed" : "failed",
    blockers,
    checkedAt: new Date().toISOString()
  });
}

async function assertRuntimeBoundary(
  runtime: TargetWorldRuntime,
  targetWorldRef: TargetWorldRef,
  runtimeContractRef: RuntimeContractRef,
  hatchPackageRef: HatchPackageRef
) {
  const target = await runtime.storage.readTargetWorld(targetWorldRef);
  if (!target.ok) return target;
  const contract = await runtime.options.runtimeContractRegistry.getRuntimeContract(runtimeContractRef);
  if (!contract.ok) return contract;
  const pkg = await runtime.options.hatchBuilder.getHatchPackage(hatchPackageRef);
  if (!pkg.ok) return pkg;
  if (pkg.value.runtimeContractRef.id !== runtimeContractRef.id) {
    return targetErr({ code: "contract_incompatible", message: "hatch package runtime contract does not match input" });
  }
  if (pkg.value.lifecycle === "retracted" || pkg.value.lifecycle === "failed") {
    return targetErr({ code: "package_verification_failed", message: "hatch package is not runnable in target world" });
  }
  return ok({ target: target.value, contract: contract.value, package: pkg.value });
}

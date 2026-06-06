import { randomUUID } from "node:crypto";
import type { RuntimeContractRef, RuntimeKernelType } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import { contractErr } from "./errors.js";
import { makeRuntimeContractRef } from "./refs.js";
import type {
  RuntimeContractInput,
  RuntimeContractRecord,
  RuntimeContractDiffSummary,
  RuntimeContractQuery,
  RuntimeContractShape
} from "./types.js";

export function newRuntimeContractRef(): RuntimeContractRef {
  return makeRuntimeContractRef(`runtime-contract-${randomUUID()}`);
}

export function compact(value: string, max = 4_000): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 3)}...`;
}

export function validateInput(input: RuntimeContractInput): Result<void> {
  if (input.name.trim().length === 0) return contractErr({ code: "invalid_input", message: "contract name is required" });
  if (input.version.schemaVersion.trim().length === 0) {
    return contractErr({ code: "invalid_input", message: "contract schemaVersion is required" });
  }
  return ok(undefined);
}

export function contractDocument(record: Omit<RuntimeContractRecord, "artifactRef">): string {
  return JSON.stringify({
    runtimeContractRef: record.runtimeContractRef,
    growUnitRef: record.growUnitRef,
    name: record.name,
    version: record.version,
    runtimeKernelType: record.runtimeKernelType,
    targetWorldSummaryRef: record.targetWorldSummaryRef,
    shape: record.shape,
    capabilityRequirements: record.capabilityRequirements,
    evidenceRefs: record.evidenceRefs,
    readinessVerdictRef: record.readinessVerdictRef
  }, null, 2);
}

export function secretContentDetected(content: string): boolean {
  return /contains_secret|api[_-]?key|secret[_-]?value|secretMaterial|token["'\s:=-]/i.test(content);
}

export function completenessMissing(record: RuntimeContractRecord): readonly string[] {
  const missing: string[] = [];
  if (record.shape.input === undefined) missing.push("input contract");
  if (record.shape.output === undefined && record.shape.event === undefined) missing.push("output or event contract");
  if (record.shape.actionBoundary === undefined) missing.push("action boundary contract");
  if (record.shape.debug === undefined) missing.push("debug contract");
  if (record.shape.feedback === undefined) missing.push("feedback contract");
  if (record.shape.failure === undefined) missing.push("failure contract");
  if (record.shape.observability === undefined) missing.push("observability contract");
  if (record.shape.compatibility === undefined) missing.push("version compatibility");
  if (record.capabilityRequirements.length === 0) missing.push("required capabilities");
  if (!hasPrivacyRules(record.shape)) missing.push("privacy rules");
  return missing;
}

export function hasPrivacyRules(shape: RuntimeContractShape): boolean {
  return [
    shape.input?.privacyRules,
    shape.output?.privacyRules,
    shape.event?.privacyRules,
    shape.debug?.privacyRules,
    shape.feedback?.redactionRules,
    shape.observability?.privacyRules
  ].some((rules) => (rules?.length ?? 0) > 0);
}

export function assertMutable(record: RuntimeContractRecord): Result<void> {
  if (record.lifecycle === "locked_for_hatch") {
    return contractErr({ code: "invalid_state", message: "locked contract cannot be edited in place" });
  }
  if (record.lifecycle === "retracted") {
    return contractErr({ code: "contract_retracted", message: "retracted contract cannot be used for new hatch" });
  }
  return ok(undefined);
}

export function assertUsableForHatch(record: RuntimeContractRecord): Result<void> {
  if (record.lifecycle === "retracted") return contractErr({ code: "contract_retracted", message: "retracted contract cannot hatch" });
  if (record.lifecycle === "incompatible") return contractErr({ code: "contract_incompatible", message: "incompatible contract cannot hatch" });
  if (record.latestVerificationReportRef === undefined) {
    return contractErr({ code: "contract_not_ready", message: "contract requires hatch verification before lock" });
  }
  return ok(undefined);
}

export function matchesQuery(record: RuntimeContractRecord, query: RuntimeContractQuery): boolean {
  if (query.growUnitRef !== undefined && record.growUnitRef.id !== query.growUnitRef.id) return false;
  if (query.lifecycle !== undefined && record.lifecycle !== query.lifecycle) return false;
  if (query.kernelType !== undefined && record.runtimeKernelType !== query.kernelType) return false;
  if (query.text !== undefined) {
    const text = `${record.name}\n${record.runtimeKernelType}\n${record.version.schemaVersion}`.toLowerCase();
    if (!text.includes(query.text.toLowerCase())) return false;
  }
  return true;
}

export function diffContracts(a: RuntimeContractRecord, b: RuntimeContractRecord): RuntimeContractDiffSummary {
  const changed: string[] = [];
  if (a.runtimeKernelType !== b.runtimeKernelType) changed.push("runtimeKernelType");
  if (JSON.stringify(a.shape.input) !== JSON.stringify(b.shape.input)) changed.push("input");
  if (JSON.stringify(a.shape.output) !== JSON.stringify(b.shape.output)) changed.push("output");
  if (JSON.stringify(a.shape.event) !== JSON.stringify(b.shape.event)) changed.push("event");
  if (JSON.stringify(a.shape.actionBoundary) !== JSON.stringify(b.shape.actionBoundary)) changed.push("actionBoundary");
  if (JSON.stringify(a.capabilityRequirements) !== JSON.stringify(b.capabilityRequirements)) changed.push("capabilityRequirements");
  const breaking = b.shape.compatibility?.breakingChanges ?? [];
  return { from: a.runtimeContractRef, to: b.runtimeContractRef, changedFields: changed, breakingChanges: breaking, compatible: breaking.length === 0 };
}

export function kernelSummary(kernel: RuntimeKernelType): string {
  if (kernel === "non_llm_runtime") return "non-LLM runtime contract";
  if (kernel === "standard_agent_kernel") return "standard agent kernel contract";
  if (kernel === "custom_agent_kernel") return "custom runtime supplied by hatch package";
  return "hybrid runtime contract";
}

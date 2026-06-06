import { ok, type Result } from "../domain/result.js";
import { policyErr } from "./errors.js";
import { capabilityKinds } from "./types.js";
import type {
  BoundaryCheck,
  BoundaryDeclaration,
  BoundaryLevel,
  EnvironmentCapabilitySummary
} from "./types.js";

const capabilityKindsSet = new Set<string>(capabilityKinds);

export function knownCapability(capability: string): boolean {
  return capabilityKindsSet.has(capability);
}

export function describeCapabilityBoundary(
  capability: string,
  environment: EnvironmentCapabilitySummary
): Result<BoundaryDeclaration> {
  if (!knownCapability(capability)) {
    return ok({ capability, level: "unsupported", enforcedBy: "policy", limitations: ["unknown capability"] });
  }
  if (capability.startsWith("file.")) {
    return ok({
      capability,
      level: "structural_guard",
      enforcedBy: "File-Native Store + feng policy",
      limitations: ["File Store containment, symlink, and atomic-write guards remain mandatory"]
    });
  }
  if (capability === "command.run") {
    return ok({
      capability,
      level: environment.hostSandboxAvailable ? "host_sandbox_required" : "unsupported",
      enforcedBy: environment.hostSandboxAvailable ? "host sandbox" : "policy",
      limitations: environment.hostSandboxAvailable ? [] : ["host sandbox unavailable"]
    });
  }
  if (capability === "network.request" || capability === "external_service.call") {
    return ok({
      capability,
      level: environment.networkAvailable ? "external_enforcement" : "unsupported",
      enforcedBy: environment.networkAvailable ? "network or service provider" : "policy",
      limitations: environment.networkAvailable ? ["remote provider still enforces access"] : ["network unavailable"]
    });
  }
  if (capability === "runtime.target_action") return runtimeBoundary(capability, environment);
  if (capability === "secret.read") return secretBoundary(capability, environment);
  return ok({ capability, level: "policy_decision", enforcedBy: "feng policy", limitations: ["not a sandbox"] });
}

export function requireCapabilityBoundary(
  capability: string,
  requiredLevel: BoundaryLevel,
  environment: EnvironmentCapabilitySummary
): Result<BoundaryCheck> {
  const actual = describeCapabilityBoundary(capability, environment);
  if (!actual.ok) return actual;
  const satisfied = satisfiesBoundary(actual.value.level, requiredLevel);
  if (!satisfied) {
    return policyErr({
      code: actual.value.level === "unsupported" ? "boundary_unsupported" : "external_enforcement_unavailable",
      message: "required boundary is not available"
    });
  }
  return ok({ capability, requiredLevel, actual: actual.value, satisfied });
}

export function defaultConstraints(capability: string, boundary: BoundaryDeclaration): readonly string[] {
  const base = boundary.limitations;
  if (capability.startsWith("file.")) return ["File Store containment remains mandatory", ...base];
  if (capability === "command.run") return ["Tool Runtime must execute inside the declared host boundary", ...base];
  if (capability.startsWith("artifact.")) return ["Artifact Registry lifecycle and privacy metadata remain authoritative", ...base];
  if (capability === "runtime.target_action") return ["Target World Adapter must enforce the runtime contract", ...base];
  if (capability === "feedback.upstream") return ["upstream acceptance is separate from local permission", ...base];
  if (capability === "hatch.publish") return ["Hatch Builder still owns package content selection", ...base];
  return base;
}

function runtimeBoundary(capability: string, environment: EnvironmentCapabilitySummary): Result<BoundaryDeclaration> {
  return ok({
    capability,
    level: environment.externalEnforcementAvailable ? "external_enforcement" : "advisory_only",
    enforcedBy: environment.externalEnforcementAvailable ? "target world" : "caller",
    limitations: environment.externalEnforcementAvailable ? [] : ["target world must enforce action constraints"]
  });
}

function secretBoundary(capability: string, environment: EnvironmentCapabilitySummary): Result<BoundaryDeclaration> {
  return ok({
    capability,
    level: environment.secretStoreAvailable ? "human_approval" : "unsupported",
    enforcedBy: environment.secretStoreAvailable ? "secret store + approval" : "policy",
    limitations: environment.secretStoreAvailable ? ["secret values must not be persisted without redaction"] : ["secret store unavailable"]
  });
}

function satisfiesBoundary(actual: BoundaryLevel, required: BoundaryLevel): boolean {
  if (actual === "unsupported") return false;
  if (actual === required) return true;
  if (required === "advisory_only") return true;
  if (required === "policy_decision") return ["policy_decision", "structural_guard", "human_approval"].includes(actual);
  if (required === "structural_guard") return actual === "structural_guard";
  if (required === "human_approval") return actual === "human_approval";
  if (required === "external_enforcement") return actual === "external_enforcement";
  return actual === "host_sandbox_required";
}

import type { PolicyRule, ActionRequest } from "./types.js";
import type { PolicyVerdict } from "../domain/contracts.js";

export function matchRule(request: ActionRequest, rules: readonly PolicyRule[] = []): PolicyRule | undefined {
  return [...rules]
    .reverse()
    .find((rule) => wildcard(rule.capability, request.capability) && wildcard(rule.resource, request.resourceSummary));
}

export function wildcard(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

export function defaultVerdictForCapability(capability: string): PolicyVerdict {
  if (capability === "file.read" || capability === "artifact.read") return "allow_with_constraints";
  if (capability === "skill.activate") return "ask";
  if (capability === "secret.read") return "unsupported";
  if (capability.startsWith("file.")) return "ask";
  if (capability === "command.run" || capability === "network.request") return "ask";
  if (capability === "external_service.call" || capability === "runtime.target_action") return "ask";
  if (capability === "artifact.export" || capability === "feedback.upstream") return "ask";
  if (capability === "hatch.publish" || capability === "debug_trace.upload") return "ask";
  return "unsupported";
}

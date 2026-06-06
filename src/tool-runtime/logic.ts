import { ok, type Result } from "../domain/result.js";
import { toolRuntimeErr } from "./errors.js";
import type {
  RegisterToolInput,
  SideEffectProfile,
  ToolCatalogQuery,
  ToolDefinition,
  ToolLifecycle,
  ToolSurfaceEntry
} from "./types.js";

export const defaultSideEffects: SideEffectProfile = {
  mutatesWorkspace: false,
  mutatesExternalWorld: false,
  readsSecrets: false,
  networkAccess: false,
  summary: "no side effects declared"
};

export function validateRegisterToolInput(input: RegisterToolInput): Result<void> {
  if (input.name.trim().length === 0) return toolRuntimeErr({ code: "invalid_input", message: "tool name is required" });
  if (input.description.trim().length === 0) {
    return toolRuntimeErr({ code: "invalid_input", message: "tool description is required" });
  }
  if (input.version.schemaVersion.trim().length === 0) {
    return toolRuntimeErr({ code: "invalid_input", message: "tool version is required" });
  }
  if (input.implementation.implementationId.trim().length === 0) {
    return toolRuntimeErr({ code: "invalid_input", message: "tool implementation id is required" });
  }
  const schemaType = input.inputSchema.type;
  if (schemaType !== undefined && schemaType !== "object") {
    return toolRuntimeErr({ code: "schema_incompatible", message: "tool input schema must be an object schema" });
  }
  return ok(undefined);
}

export function matchesToolQuery(record: ToolDefinition, query: ToolCatalogQuery): boolean {
  if (query.includeUnavailable !== true && unavailable(record.lifecycle)) return false;
  if (query.namespace !== undefined && record.namespace !== query.namespace) return false;
  if (query.lifecycle !== undefined && record.lifecycle !== query.lifecycle) return false;
  if (query.sourceKind !== undefined && record.sourceKind !== query.sourceKind) return false;
  if (query.text === undefined) return true;
  const text = query.text.toLowerCase();
  return [record.name, record.namespace, record.description]
    .some((value) => value.toLowerCase().includes(text));
}

export function visibleInSurface(record: ToolDefinition): boolean {
  return record.lifecycle === "active" || record.lifecycle === "deprecated";
}

export function executable(record: ToolDefinition): Result<void> {
  if (record.lifecycle === "active" || record.lifecycle === "deprecated") return ok(undefined);
  if (record.lifecycle === "retracted") return toolRuntimeErr({ code: "tool_retracted", message: "tool is retracted" });
  if (record.lifecycle === "incompatible") {
    return toolRuntimeErr({ code: "tool_incompatible", message: "tool is incompatible" });
  }
  if (record.lifecycle === "unavailable") return toolRuntimeErr({ code: "tool_unavailable", message: "tool is unavailable" });
  return toolRuntimeErr({ code: "invalid_state", message: `tool lifecycle ${record.lifecycle} is not executable` });
}

export function surfaceEntry(record: ToolDefinition): ToolSurfaceEntry {
  return {
    toolRef: record.toolRef,
    name: record.name,
    namespace: record.namespace,
    version: record.version,
    description: record.description,
    inputSchemaSummary: summarizeSchema(record.inputSchema),
    outputSchemaSummary: record.outputSchemaSummary,
    declaredCapabilities: record.declaredCapabilities,
    risk: record.risk,
    sideEffects: record.sideEffects,
    lifecycle: record.lifecycle,
    compatibilityWarnings: compatibilityWarnings(record)
  };
}

export function transitionAllowed(from: ToolLifecycle, to: ToolLifecycle): boolean {
  if (from === to) return false;
  if (from === "retracted") return false;
  if (to === "discovered" && from !== "discovered") return false;
  return true;
}

function unavailable(lifecycle: ToolLifecycle): boolean {
  return lifecycle === "retracted" || lifecycle === "unavailable" || lifecycle === "incompatible";
}

function summarizeSchema(schema: ToolDefinition["inputSchema"]): string {
  const required = schema.required?.length === undefined || schema.required.length === 0
    ? "no required fields"
    : `required: ${schema.required.join(", ")}`;
  const properties = Object.keys(schema.properties ?? {});
  const fieldSummary = properties.length === 0 ? "no fields" : `fields: ${properties.join(", ")}`;
  return `${fieldSummary}; ${required}`;
}

function compatibilityWarnings(record: ToolDefinition): readonly string[] {
  const warnings: string[] = [];
  if (record.lifecycle === "deprecated") warnings.push("tool is deprecated");
  if (record.implementation.kind === "none") warnings.push("tool has no executable implementation");
  if (record.compatibility.notes !== undefined) warnings.push(record.compatibility.notes);
  return warnings;
}

import { sha256Text, stableStringify } from "../event-ledger/stable-json.js";
import { ok, type Result } from "../domain/result.js";
import type { ArtifactRegistry } from "../artifact-registry/index.js";
import type { FileNativeStore, ReadReceipt, WorkspaceHandle } from "../file-store/index.js";
import { toolRuntimeErr } from "./errors.js";
import type {
  JsonValue,
  ToolCallRequest,
  ToolDefinition,
  ToolInputValidation,
  ToolInputValidationId,
  ToolJsonSchema,
  ToolValidationIssue
} from "./types.js";

export interface ValidateToolCallInput {
  readonly store: FileNativeStore;
  readonly workspace: WorkspaceHandle;
  readonly artifactRegistry: ArtifactRegistry;
  readonly request: ToolCallRequest;
  readonly definition: ToolDefinition;
  readonly validationId: ToolInputValidationId;
  readonly maxInlineInputBytes: number;
}

export async function validateToolCallInput(input: ValidateToolCallInput): Promise<Result<ToolInputValidation>> {
  const materialized = await resolveInput(input);
  if (!materialized.ok) return materialized;
  const issues = [...materialized.value.issues];
  const normalizedInput = materialized.value.value;
  if (normalizedInput !== undefined) {
    if (Buffer.byteLength(stableStringify(normalizedInput), "utf8") > input.maxInlineInputBytes) {
      issues.push({ code: "input_too_large", path: "$", message: "tool input exceeds inline validation limit" });
    }
    await validateSchema({
      schema: input.definition.inputSchema,
      value: normalizedInput,
      path: "$",
      issues,
      store: input.store,
      workspace: input.workspace
    });
  }
  for (const credential of input.definition.credentialRequirements) {
    if (credential.optional === true) continue;
    if (!(input.request.availableCredentialNames ?? []).includes(credential.name)) {
      issues.push({
        code: "credential_missing",
        path: "$credentials",
        message: `required credential is missing: ${credential.name}`
      });
    }
  }
  const validation: ToolInputValidation = {
    validationId: input.validationId,
    toolCallId: input.request.toolCallId,
    toolRef: input.request.toolRef,
    status: issues.length === 0 ? "valid" : "invalid",
    issues,
    ...(normalizedInput === undefined ? {} : { normalizedInput }),
    ...(normalizedInput === undefined ? {} : { inputHash: sha256Text(stableStringify(normalizedInput)) }),
    ...(input.request.inputArtifactRef === undefined ? {} : { inputArtifactRef: input.request.inputArtifactRef }),
    ...(materialized.value.readReceipt === undefined ? {} : { readReceipt: materialized.value.readReceipt }),
    validatedAt: new Date().toISOString(),
    source: input.request.source,
    audit: input.request.audit
  };
  return ok(validation);
}

async function resolveInput(input: ValidateToolCallInput): Promise<Result<{
  readonly value?: JsonValue;
  readonly issues: readonly ToolValidationIssue[];
  readonly readReceipt?: ReadReceipt;
}>> {
  const issues: ToolValidationIssue[] = [];
  if (input.request.input !== undefined && input.request.inputArtifactRef !== undefined) {
    issues.push({ code: "unsupported", path: "$", message: "provide inline input or inputArtifactRef, not both" });
    return ok({ value: input.request.input, issues });
  }
  if (input.request.input !== undefined) return ok({ value: input.request.input, issues });
  if (input.request.inputArtifactRef === undefined) return ok({ value: {}, issues });
  const materialized = await input.artifactRegistry.materializeArtifact(input.request.inputArtifactRef, {
    reason: input.request.reason,
    maxBytes: input.maxInlineInputBytes,
    allowArchived: true
  });
  if (!materialized.ok) {
    issues.push({
      code: materialized.error.code === "privacy_blocked" ? "privacy_blocked" : "artifact_unavailable",
      path: "$",
      message: materialized.error.message
    });
    return ok({ issues });
  }
  if (materialized.value.status !== "available" || materialized.value.content === undefined) {
    issues.push({
      code: materialized.value.status === "redacted" ? "privacy_blocked" : "artifact_unavailable",
      path: "$",
      message: "input artifact content is not available"
    });
    return ok({ issues });
  }
  if (typeof materialized.value.content !== "string") {
    issues.push({ code: "unsupported", path: "$", message: "binary input artifact is not supported for tool calls" });
    return ok({
      issues,
      ...(materialized.value.readReceipt === undefined ? {} : { readReceipt: materialized.value.readReceipt })
    });
  }
  try {
    const parsed = JSON.parse(materialized.value.content) as unknown;
    return isJsonValue(parsed)
      ? ok({
          value: parsed,
          issues,
          ...(materialized.value.readReceipt === undefined ? {} : { readReceipt: materialized.value.readReceipt })
        })
      : ok({ issues: [{ code: "invalid_json", path: "$", message: "input artifact JSON is not a JSON value" }] });
  } catch (cause) {
    void cause;
    issues.push({ code: "invalid_json", path: "$", message: "input artifact content is not valid JSON" });
    return ok({
      issues,
      ...(materialized.value.readReceipt === undefined ? {} : { readReceipt: materialized.value.readReceipt })
    });
  }
}

async function validateSchema(input: {
  readonly schema: ToolJsonSchema;
  readonly value: JsonValue;
  readonly path: string;
  readonly issues: ToolValidationIssue[];
  readonly store: FileNativeStore;
  readonly workspace: WorkspaceHandle;
}): Promise<void> {
  const types = Array.isArray(input.schema.type) ? input.schema.type : input.schema.type === undefined ? ["object"] : [input.schema.type];
  if (!types.some((type) => matchesType(input.value, type))) {
    input.issues.push({ code: "type_mismatch", path: input.path, message: `expected ${types.join(" or ")}` });
    return;
  }
  if (input.schema.enum !== undefined && !input.schema.enum.some((item) => stableStringify(item) === stableStringify(input.value))) {
    input.issues.push({ code: "unsupported", path: input.path, message: "value is not in schema enum" });
  }
  if (typeof input.value === "string") await validateStringFormat(input);
  if (Array.isArray(input.value) && input.schema.items !== undefined) {
    for (let index = 0; index < input.value.length; index += 1) {
      await validateSchema({ ...input, schema: input.schema.items, value: input.value[index]!, path: `${input.path}[${index}]` });
    }
  }
  if (!isPlainObject(input.value)) return;
  const required = input.schema.required ?? [];
  for (const key of required) {
    if (!(key in input.value)) input.issues.push({ code: "missing_required", path: `${input.path}.${key}`, message: "required field is missing" });
  }
  const properties = input.schema.properties ?? {};
  if (input.schema.additionalProperties === false) {
    for (const key of Object.keys(input.value)) {
      if (!(key in properties)) input.issues.push({ code: "unknown_field", path: `${input.path}.${key}`, message: "field is not declared in schema" });
    }
  }
  for (const [key, schema] of Object.entries(properties)) {
    const value = input.value[key];
    if (value !== undefined) await validateSchema({ ...input, schema, value, path: `${input.path}.${key}` });
  }
}

async function validateStringFormat(input: {
  readonly schema: ToolJsonSchema;
  readonly value: JsonValue;
  readonly path: string;
  readonly issues: ToolValidationIssue[];
  readonly store: FileNativeStore;
  readonly workspace: WorkspaceHandle;
}): Promise<void> {
  const value = String(input.value);
  if (input.schema.maxLength !== undefined && value.length > input.schema.maxLength) {
    input.issues.push({ code: "input_too_large", path: input.path, message: "string exceeds schema maxLength" });
  }
  if (input.schema.format === "workspace_path") {
    const resolved = await input.store.resolvePath(input.workspace, value, { allowMissing: true, rejectSymlinkEscape: true });
    if (!resolved.ok) input.issues.push({ code: "unsafe_path", path: input.path, message: resolved.error.message });
  }
  if (input.schema.format === "shell_command" && unsafeCommand(value)) {
    input.issues.push({ code: "unsafe_command", path: input.path, message: "command matches hard structural guard" });
  }
}

function matchesType(value: JsonValue, type: string): boolean {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isPlainObject(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  return typeof value === type;
}

function isPlainObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).every(isJsonValue);
}

function unsafeCommand(command: string): boolean {
  const lower = command.toLowerCase();
  return command.includes("\0")
    || /^\s*$/.test(command)
    || /\brm\s+(-[^\s]*\s+)*(\/|\/\*|~|\$home)\b/i.test(command)
    || /\bmkfs(\.[a-z0-9]+)?\b/i.test(command)
    || /\b(shutdown|reboot|halt|poweroff)\b/i.test(lower)
    || /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(command);
}

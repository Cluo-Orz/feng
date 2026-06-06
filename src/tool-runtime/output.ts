import { ok, type Result } from "../domain/result.js";
import { toolRuntimeErr } from "./errors.js";
import type {
  JsonValue,
  ToolDefinition,
  ToolExecutionError,
  ToolExecutionOutput,
  ToolSideEffectRecord,
  ToolValidationIssue
} from "./types.js";

export interface NormalizedToolOutput {
  readonly document: JsonValue;
  readonly outputPreview: string;
  readonly stdoutPreview?: string;
  readonly stderrPreview?: string;
  readonly structuredOutputPreview?: JsonValue;
  readonly sideEffects: readonly ToolSideEffectRecord[];
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly outputBytes: number;
  readonly mediaType: string;
  readonly error?: ToolExecutionError;
}

export function normalizeToolOutput(input: {
  readonly raw: unknown;
  readonly definition: ToolDefinition;
  readonly redacted: boolean;
  readonly maxPreviewChars: number;
}): Result<NormalizedToolOutput> {
  const output = coerceOutput(input.raw);
  if (!output.ok) return output;
  const schema = input.definition.outputSchema;
  if (schema !== undefined && output.value.structuredOutput !== undefined) {
    const issues = validateOutputSchema(schema, output.value.structuredOutput, "$");
    if (issues.length > 0) {
      return toolRuntimeErr({
        code: "output_invalid",
        message: issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
        retryable: false
      });
    }
  }
  const stdout = input.redacted ? redactString(output.value.stdout) : output.value.stdout;
  const stderr = input.redacted ? redactString(output.value.stderr) : output.value.stderr;
  const structuredOutput = input.redacted ? redactJson(output.value.structuredOutput) : output.value.structuredOutput;
  const sideEffects = input.redacted
    ? (output.value.sideEffects ?? []).map((item) => ({ ...item, summary: redactString(item.summary) ?? "" }))
    : output.value.sideEffects ?? [];
  const document = jsonObject({
    stdout,
    stderr,
    structuredOutput,
    sideEffects,
    redacted: input.redacted,
    generatedAt: new Date().toISOString()
  });
  const serialized = JSON.stringify(document, null, 2);
  const stdoutPreview = stdout === undefined ? undefined : preview(stdout, input.maxPreviewChars);
  const stderrPreview = stderr === undefined ? undefined : preview(stderr, input.maxPreviewChars);
  return ok({
    document,
    outputPreview: preview(visibleText(stdout, stderr, structuredOutput), input.maxPreviewChars),
    ...(stdoutPreview === undefined ? {} : { stdoutPreview }),
    ...(stderrPreview === undefined ? {} : { stderrPreview }),
    ...(structuredOutput === undefined ? {} : { structuredOutputPreview: truncateJson(structuredOutput, input.maxPreviewChars) }),
    sideEffects,
    stdoutBytes: Buffer.byteLength(stdout ?? "", "utf8"),
    stderrBytes: Buffer.byteLength(stderr ?? "", "utf8"),
    outputBytes: Buffer.byteLength(serialized, "utf8"),
    mediaType: output.value.mediaType ?? "application/json"
  });
}

export function executionError(code: string, message: string, retryable: boolean): ToolExecutionError {
  return { code, message, retryable };
}

export function errorFromUnknown(error: unknown, fallbackCode = "execution_failed"): ToolExecutionError {
  if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
    const record = error as { readonly code?: unknown; readonly message?: unknown; readonly retryable?: unknown };
    return {
      code: typeof record.code === "string" ? record.code : fallbackCode,
      message: typeof record.message === "string" ? record.message : "tool execution failed",
      retryable: typeof record.retryable === "boolean" ? record.retryable : false
    };
  }
  return { code: fallbackCode, message: error instanceof Error ? error.message : String(error), retryable: false };
}

function coerceOutput(raw: unknown): Result<ToolExecutionOutput> {
  if (typeof raw === "string") return ok({ stdout: raw });
  if (raw === undefined || raw === null) return ok({ structuredOutput: null });
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return isJsonValue(raw) ? ok({ structuredOutput: raw }) : toolRuntimeErr({ code: "output_invalid", message: "tool output is not JSON-compatible" });
  }
  const record = raw as Record<string, unknown>;
  const structured = record["structuredOutput"];
  const sideEffects = Array.isArray(record["sideEffects"])
    ? record["sideEffects"].filter(isSideEffect)
    : undefined;
  if (structured !== undefined && !isJsonValue(structured)) {
    return toolRuntimeErr({ code: "output_invalid", message: "structuredOutput is not JSON-compatible" });
  }
  return ok({
    ...(typeof record["stdout"] === "string" ? { stdout: record["stdout"] } : {}),
    ...(typeof record["stderr"] === "string" ? { stderr: record["stderr"] } : {}),
    ...(structured === undefined ? {} : { structuredOutput: structured }),
    ...(sideEffects === undefined ? {} : { sideEffects }),
    ...(typeof record["mediaType"] === "string" ? { mediaType: record["mediaType"] } : {})
  });
}

function validateOutputSchema(schema: ToolDefinition["outputSchema"], value: JsonValue, path: string): readonly ToolValidationIssue[] {
  if (schema === undefined) return [];
  const issues: ToolValidationIssue[] = [];
  const types = Array.isArray(schema.type) ? schema.type : schema.type === undefined ? ["object"] : [schema.type];
  if (!types.some((type) => matchesType(value, type))) {
    return [{ code: "type_mismatch", path, message: `expected ${types.join(" or ")}` }];
  }
  if (!isPlainObject(value)) return issues;
  const properties = schema.properties ?? {};
  for (const key of schema.required ?? []) {
    if (!(key in value)) issues.push({ code: "missing_required", path: `${path}.${key}`, message: "required field is missing" });
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!(key in properties)) issues.push({ code: "unknown_field", path: `${path}.${key}`, message: "field is not declared in schema" });
    }
  }
  for (const [key, childSchema] of Object.entries(properties)) {
    const child = value[key];
    if (child !== undefined) issues.push(...validateOutputSchema(childSchema, child, `${path}.${key}`));
  }
  return issues;
}

function preview(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastLine = cut.lastIndexOf("\n");
  return `${lastLine > maxChars / 2 ? cut.slice(0, lastLine) : cut}\n...`;
}

function visibleText(stdout: string | undefined, stderr: string | undefined, structured: JsonValue | undefined): string {
  return [stdout, stderr, structured === undefined ? undefined : JSON.stringify(structured, null, 2)]
    .filter((item): item is string => item !== undefined && item.length > 0)
    .join("\n");
}

function redactString(value: string | undefined): string | undefined {
  return value === undefined ? undefined : "[redacted by policy]";
}

function redactJson(value: JsonValue | undefined): JsonValue | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return "[redacted by policy]";
  if (Array.isArray(value)) return value.map(redactJson).filter((item): item is JsonValue => item !== undefined);
  if (typeof value === "object" && value !== null) {
    const redacted: Record<string, JsonValue> = {};
    for (const key of Object.keys(value)) redacted[key] = "[redacted by policy]";
    return redacted;
  }
  return value;
}

function truncateJson(value: JsonValue, maxChars: number): JsonValue {
  const text = JSON.stringify(value);
  return text.length <= maxChars ? value : `${text.slice(0, maxChars)}...`;
}

function jsonObject(input: Record<string, unknown>): JsonValue {
  return JSON.parse(JSON.stringify(input)) as JsonValue;
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

function isSideEffect(value: unknown): value is ToolSideEffectRecord {
  return typeof value === "object"
    && value !== null
    && typeof (value as Record<string, unknown>)["kind"] === "string"
    && typeof (value as Record<string, unknown>)["summary"] === "string";
}

import type { ArtifactKind, ArtifactProducerModule, RetentionClass } from "../artifact-registry/index.js";
import type { ArtifactRef } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import { admissionErr } from "./errors.js";
import type { AdmissionRuntime } from "./runtime.js";
import type { InboxSourceKind, ReceivePayloadInput } from "./types.js";

export interface RegisteredAdmissionPayload {
  readonly rawArtifactRef: ArtifactRef;
  readonly previewRef?: ArtifactRef;
  readonly normalizedSummary: string;
}

export async function registerInboxPayload(
  runtime: AdmissionRuntime,
  sourceKind: InboxSourceKind,
  input: ReceivePayloadInput
): Promise<Result<RegisteredAdmissionPayload>> {
  const raw = await resolvePayloadRef(runtime, sourceKind, input);
  if (!raw.ok) return raw;
  const preview = await runtime.options.artifactRegistry.generatePreview(raw.value, `preview ${sourceKind}`);
  if (!preview.ok) return preview;
  const summary = await previewSummary(runtime, raw.value, input.normalizedSummary);
  if (!summary.ok) return summary;
  return ok({ rawArtifactRef: raw.value, previewRef: preview.value, normalizedSummary: summary.value });
}

export async function resolvePayloadRef(
  runtime: AdmissionRuntime,
  sourceKind: InboxSourceKind,
  input: ReceivePayloadInput
): Promise<Result<ArtifactRef>> {
  if (input.existingArtifactRef !== undefined) {
    const record = await runtime.options.artifactRegistry.resolveArtifact(input.existingArtifactRef);
    return record.ok ? ok(input.existingArtifactRef) : record;
  }
  return registerContent(runtime, sourceKind, input);
}

function registerContent(
  runtime: AdmissionRuntime,
  sourceKind: InboxSourceKind,
  input: ReceivePayloadInput
): Promise<Result<ArtifactRef>> {
  if (input.content === undefined) {
    return Promise.resolve(admissionErr({ code: "invalid_input", message: "content or existingArtifactRef is required" }));
  }
  return runtime.options.artifactRegistry.registerArtifact({
    kind: artifactKindForSource(sourceKind),
    content: input.content,
    mediaType: input.mediaType ?? (typeof input.content === "string" ? "text/plain" : "application/octet-stream"),
    encoding: input.encoding ?? (typeof input.content === "string" ? "utf8" : "binary"),
    source: input.source,
    version: input.version,
    audit: input.audit,
    privacyClass: input.privacyClass,
    retentionClass: retentionForSource(sourceKind),
    producerModule: producerForSource(sourceKind),
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId })
  });
}

async function previewSummary(
  runtime: AdmissionRuntime,
  ref: ArtifactRef,
  override: string | undefined
): Promise<Result<string>> {
  if (override !== undefined && override.trim().length > 0) return ok(compact(override));
  const preview = await runtime.options.artifactRegistry.readArtifactPreview(ref, {
    reason: "read admission preview",
    maxBytes: 8 * 1024,
    allowArchived: true
  });
  if (!preview.ok) return preview;
  return ok(compact(preview.value.content));
}

function artifactKindForSource(sourceKind: InboxSourceKind): ArtifactKind {
  if (sourceKind === "user_input") return "user_input_attachment";
  if (sourceKind === "runtime_report" || sourceKind === "debug_trace") return "runtime_trace";
  if (sourceKind === "tool_result_reference") return "tool_result";
  if (sourceKind === "manual_review") return "feedback_evidence";
  return "source_material";
}

function producerForSource(sourceKind: InboxSourceKind): ArtifactProducerModule {
  if (sourceKind === "user_input" || sourceKind === "manual_review") return "human";
  if (sourceKind === "runtime_report" || sourceKind === "debug_trace") return "agent-runtime-kernel";
  if (sourceKind === "tool_result_reference") return "tool-runtime";
  return "importer";
}

function retentionForSource(sourceKind: InboxSourceKind): RetentionClass {
  if (sourceKind === "runtime_report" || sourceKind === "debug_trace") return "runtime_scoped";
  if (sourceKind === "tool_result_reference") return "attempt_scoped";
  return "grow_scoped";
}

function compact(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length <= 1_000 ? trimmed : `${trimmed.slice(0, 997)}...`;
}

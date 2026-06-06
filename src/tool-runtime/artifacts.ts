import type { ArtifactRef, AuditDescriptor, PrivacyLevel, SourceDescriptor, VersionDescriptor } from "../domain/index.js";
import type { ArtifactRegistry, RetentionClass } from "../artifact-registry/index.js";
import type { Result } from "../domain/result.js";

export async function registerToolJsonArtifact(input: {
  readonly artifactRegistry: ArtifactRegistry;
  readonly kind: "summary" | "tool_result";
  readonly content: unknown;
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
  readonly privacyClass: PrivacyLevel;
  readonly retentionClass: RetentionClass;
  readonly parentRefs?: readonly ArtifactRef[];
  readonly correlationId?: string;
}): Promise<Result<ArtifactRef>> {
  const base = {
    kind: input.kind,
    content: JSON.stringify(input.content, null, 2),
    mediaType: "application/json",
    encoding: "utf8" as const,
    source: input.source,
    version: input.version,
    audit: input.audit,
    privacyClass: input.privacyClass,
    retentionClass: input.retentionClass,
    producerModule: "tool-runtime" as const,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId })
  };
  const parents = input.parentRefs ?? [];
  return parents.length === 0
    ? input.artifactRegistry.registerArtifact(base)
    : input.artifactRegistry.registerDerivedArtifact({ ...base, parentRefs: parents });
}

export async function materializeJsonArtifact<T>(input: {
  readonly artifactRegistry: ArtifactRegistry;
  readonly artifactRef: ArtifactRef;
  readonly reason: string;
}): Promise<Result<T>> {
  const materialized = await input.artifactRegistry.materializeArtifact(input.artifactRef, {
    reason: input.reason,
    maxBytes: 1024 * 1024,
    allowArchived: true
  });
  if (!materialized.ok) return materialized;
  if (materialized.value.status !== "available" || typeof materialized.value.content !== "string") {
    return {
      ok: false,
      error: {
        code: materialized.value.status === "redacted" ? "privacy_blocked" : "artifact_unavailable",
        message: "tool artifact content is not available",
        module: "tool-runtime",
        severity: "error",
        retryable: false
      }
    };
  }
  try {
    return { ok: true, value: JSON.parse(materialized.value.content) as T };
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: "schema_incompatible",
        message: "tool artifact JSON is invalid",
        module: "tool-runtime",
        severity: "error",
        retryable: false,
        cause
      }
    };
  }
}

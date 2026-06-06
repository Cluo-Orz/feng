import type { ArtifactKind, RetentionClass } from "../artifact-registry/index.js";
import type { ArtifactRef, AuditDescriptor, PrivacyLevel, SourceDescriptor, VersionDescriptor } from "../domain/index.js";
import type { Result } from "../domain/result.js";
import type { AttemptRuntime } from "./runtime.js";

export async function registerAttemptJsonArtifact<T>(input: {
  readonly runtime: AttemptRuntime;
  readonly kind: ArtifactKind;
  readonly content: T;
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
  readonly privacyClass?: PrivacyLevel;
  readonly retentionClass?: RetentionClass;
  readonly parentRefs?: readonly ArtifactRef[];
  readonly correlationId?: string | undefined;
}): Promise<Result<ArtifactRef>> {
  const base = {
    kind: input.kind,
    content: JSON.stringify(input.content, null, 2),
    mediaType: "application/json",
    encoding: "utf8" as const,
    source: input.source,
    version: input.version,
    audit: input.audit,
    privacyClass: input.privacyClass ?? "workspace_private",
    retentionClass: input.retentionClass ?? "attempt_scoped",
    producerModule: "grow-attempt-runner" as const,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId })
  };
  const parents = input.parentRefs ?? [];
  return parents.length === 0
    ? input.runtime.options.artifactRegistry.registerArtifact(base)
    : input.runtime.options.artifactRegistry.registerDerivedArtifact({ ...base, parentRefs: parents });
}

export async function readAttemptJsonArtifact<T>(input: {
  readonly runtime: AttemptRuntime;
  readonly artifactRef: ArtifactRef;
  readonly reason: string;
}): Promise<Result<T>> {
  const materialized = await input.runtime.options.artifactRegistry.materializeArtifact(input.artifactRef, {
    reason: input.reason,
    allowArchived: true,
    maxBytes: 5 * 1024 * 1024
  });
  if (!materialized.ok) return materialized;
  if (materialized.value.status !== "available" || typeof materialized.value.content !== "string") {
    return {
      ok: false,
      error: {
        code: "artifact_unavailable",
        message: `artifact is ${materialized.value.status}`,
        module: "grow-attempt-runner",
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
        message: "attempt artifact JSON is invalid",
        module: "grow-attempt-runner",
        severity: "error",
        retryable: false,
        cause
      }
    };
  }
}

import type { ArtifactRef } from "./refs.js";
import type { AuditDescriptor, SourceDescriptor } from "./descriptors.js";

export const domainErrorCodes = [
  "not_found",
  "invalid_state",
  "invalid_input",
  "permission_denied",
  "policy_blocked",
  "version_unsupported",
  "schema_incompatible",
  "artifact_unavailable",
  "context_budget_exceeded",
  "llm_failed",
  "tool_failed",
  "readiness_failed",
  "privacy_blocked",
  "path_escape_rejected",
  "symlink_escape_rejected",
  "file_too_large",
  "unsupported_encoding",
  "atomic_write_failed",
  "io_failed",
  "append_conflict",
  "sequence_conflict",
  "idempotency_conflict",
  "projection_stale",
  "projection_incompatible",
  "lifecycle_conflict",
  "content_hash_mismatch"
] as const;

export type DomainErrorCode = (typeof domainErrorCodes)[number];

export const domainErrorSeverities = ["info", "warning", "error", "fatal"] as const;
export type DomainErrorSeverity = (typeof domainErrorSeverities)[number];

export interface DomainError {
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly module: string;
  readonly severity: DomainErrorSeverity;
  readonly retryable: boolean;
  readonly source?: SourceDescriptor;
  readonly evidenceRef?: ArtifactRef;
  readonly audit?: AuditDescriptor;
  readonly cause?: unknown;
}

export interface DomainErrorInput {
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly module: string;
  readonly severity?: DomainErrorSeverity;
  readonly retryable?: boolean;
  readonly source?: SourceDescriptor;
  readonly evidenceRef?: ArtifactRef;
  readonly audit?: AuditDescriptor;
  readonly cause?: unknown;
}

export type Ok<T> = {
  readonly ok: true;
  readonly value: T;
};

export type Err<E extends DomainError = DomainError> = {
  readonly ok: false;
  readonly error: E;
};

export type Result<T, E extends DomainError = DomainError> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E extends DomainError>(error: E): Err<E> {
  return { ok: false, error };
}

export function createDomainError(input: DomainErrorInput): DomainError {
  return {
    code: input.code,
    message: input.message,
    module: input.module,
    severity: input.severity ?? "error",
    retryable: input.retryable ?? false,
    ...(input.source === undefined ? {} : { source: input.source }),
    ...(input.evidenceRef === undefined ? {} : { evidenceRef: input.evidenceRef }),
    ...(input.audit === undefined ? {} : { audit: input.audit }),
    ...(input.cause === undefined ? {} : { cause: input.cause })
  };
}

export function domainErr(input: DomainErrorInput): Err {
  return err(createDomainError(input));
}

export function isOk<T, E extends DomainError>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E extends DomainError>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

export function mapResult<T, U, E extends DomainError>(
  result: Result<T, E>,
  mapper: (value: T) => U
): Result<U, E> {
  return result.ok ? ok(mapper(result.value)) : result;
}

export function flatMapResult<T, U, E extends DomainError>(
  result: Result<T, E>,
  mapper: (value: T) => Result<U, E>
): Result<U, E> {
  return result.ok ? mapper(result.value) : result;
}

export function unwrapOr<T, E extends DomainError>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

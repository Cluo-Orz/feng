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
  "source_unavailable",
  "source_retracted",
  "tool_surface_incompatible",
  "compile_conflict",
  "llm_failed",
  "provider_unavailable",
  "network_failed",
  "timeout",
  "rate_limited",
  "auth_failed",
  "context_length_exceeded",
  "model_capability_unsupported",
  "request_invalid",
  "response_invalid",
  "stream_interrupted",
  "tool_call_parse_failed",
  "content_filtered",
  "provider_internal_error",
  "unknown_provider_error",
  "tool_unavailable",
  "tool_retracted",
  "tool_incompatible",
  "credential_missing",
  "cancelled",
  "execution_failed",
  "output_invalid",
  "output_too_large",
  "host_sandbox_unavailable",
  "external_service_failed",
  "side_effect_unknown",
  "unknown_tool_error",
  "tool_failed",
  "tool_settlement_failed",
  "attempt_cancelled",
  "attempt_interrupted",
  "attempt_timeout",
  "retry_budget_exhausted",
  "checkpoint_unavailable",
  "resume_conflict",
  "evidence_unavailable",
  "evidence_stale",
  "evidence_conflict",
  "dod_missing",
  "readiness_failed",
  "readiness_blocked",
  "readiness_inconclusive",
  "validation_missing",
  "contract_incomplete",
  "contract_incompatible",
  "contract_retracted",
  "contract_not_ready",
  "readiness_missing",
  "capability_unsupported",
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
  "transition_conflict",
  "content_hash_mismatch",
  "grow_unit_archived",
  "grow_unit_blocked",
  "feedback_status_conflict",
  "admission_conflict",
  "upstream_policy_required",
  "redaction_required",
  "agenda_conflict",
  "dod_incompatible",
  "gap_conflict",
  "attempt_intent_blocked",
  "retry_limit_reached",
  "approval_required",
  "grant_expired",
  "grant_revoked",
  "boundary_unsupported",
  "external_enforcement_unavailable",
  "skill_incompatible",
  "skill_retracted",
  "activation_blocked",
  "rollback_target_missing"
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

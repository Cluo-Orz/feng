import type { DomainError, DomainErrorCode } from "../domain/index.js";
import type { CLIExitStatus } from "./types.js";

const exitByCode: Partial<Record<DomainErrorCode, CLIExitStatus>> = {
  permission_denied: "blocked_by_policy",
  policy_blocked: "blocked_by_policy",
  upstream_policy_required: "blocked_by_policy",
  production_lock_violation: "blocked_by_policy",
  privacy_blocked: "blocked_by_privacy",
  redaction_required: "blocked_by_privacy",
  secret_detected: "blocked_by_privacy",
  debug_signal_blocked: "blocked_by_privacy",
  approval_required: "waiting_approval",
  grant_expired: "waiting_approval",
  grant_revoked: "waiting_approval",
  readiness_failed: "blocked_by_readiness",
  readiness_blocked: "blocked_by_readiness",
  readiness_inconclusive: "blocked_by_readiness",
  readiness_missing: "blocked_by_readiness",
  contract_not_ready: "blocked_by_readiness",
  contract_incomplete: "blocked_by_readiness",
  boundary_unsupported: "unsupported",
  capability_unsupported: "unsupported",
  runtime_kernel_unsupported: "unsupported",
  version_unsupported: "unsupported",
  model_capability_unsupported: "unsupported",
  adapter_incompatible: "unsupported",
  tool_surface_incompatible: "unsupported",
  external_enforcement_unavailable: "unsupported",
  cancelled: "interrupted",
  attempt_cancelled: "interrupted",
  attempt_interrupted: "interrupted",
  stream_interrupted: "interrupted"
};

export function mapErrorToExitStatus(error: DomainError): CLIExitStatus {
  return exitByCode[error.code] ?? "failed";
}

const codeByStatus: Record<CLIExitStatus, number> = {
  succeeded: 0,
  succeeded_with_warnings: 0,
  waiting_input: 3,
  waiting_approval: 4,
  blocked_by_policy: 5,
  blocked_by_privacy: 6,
  blocked_by_readiness: 7,
  unsupported: 8,
  failed: 1,
  interrupted: 130
};

export function exitCodeForStatus(status: CLIExitStatus): number {
  return codeByStatus[status];
}

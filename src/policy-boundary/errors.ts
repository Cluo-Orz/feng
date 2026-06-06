import { domainErr, type Err } from "../domain/result.js";

export const policyBoundaryModule = "policy-capability-boundary";

export function policyErr(input: {
  readonly code:
    | "not_found"
    | "permission_denied"
    | "policy_blocked"
    | "privacy_blocked"
    | "invalid_input"
    | "invalid_state"
    | "version_unsupported"
    | "schema_incompatible"
    | "artifact_unavailable"
    | "approval_required"
    | "grant_expired"
    | "grant_revoked"
    | "boundary_unsupported"
    | "external_enforcement_unavailable";
  readonly message: string;
  readonly retryable?: boolean;
  readonly cause?: unknown;
}): Err {
  return domainErr({
    code: input.code,
    message: input.message,
    module: policyBoundaryModule,
    retryable: input.retryable ?? false,
    ...(input.cause === undefined ? {} : { cause: input.cause })
  });
}

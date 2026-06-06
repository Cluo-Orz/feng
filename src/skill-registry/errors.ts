import { domainErr, type Err } from "../domain/result.js";

export const skillRegistryModule = "skill-registry";

export function skillErr(input: {
  readonly code:
    | "not_found"
    | "invalid_input"
    | "invalid_state"
    | "permission_denied"
    | "policy_blocked"
    | "privacy_blocked"
    | "version_unsupported"
    | "schema_incompatible"
    | "artifact_unavailable"
    | "skill_incompatible"
    | "skill_retracted"
    | "activation_blocked"
    | "rollback_target_missing";
  readonly message: string;
  readonly retryable?: boolean;
  readonly cause?: unknown;
}): Err {
  return domainErr({
    code: input.code,
    message: input.message,
    module: skillRegistryModule,
    retryable: input.retryable ?? false,
    ...(input.cause === undefined ? {} : { cause: input.cause })
  });
}

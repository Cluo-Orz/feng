import { domainErr, type Err } from "../domain/result.js";

export const artifactRegistryModule = "artifact-registry";

export function artifactErr(input: {
  readonly code:
    | "not_found"
    | "invalid_input"
    | "invalid_state"
    | "artifact_unavailable"
    | "privacy_blocked"
    | "version_unsupported"
    | "schema_incompatible"
    | "file_too_large"
    | "unsupported_encoding"
    | "lifecycle_conflict"
    | "content_hash_mismatch";
  readonly message: string;
  readonly retryable?: boolean;
  readonly cause?: unknown;
}): Err {
  return domainErr({
    code: input.code,
    message: input.message,
    module: artifactRegistryModule,
    retryable: input.retryable ?? false,
    ...(input.cause === undefined ? {} : { cause: input.cause })
  });
}

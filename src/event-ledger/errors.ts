import { domainErr, type Err } from "../domain/result.js";

export const eventLedgerModule = "event-ledger-projection";

export function ledgerErr(input: {
  readonly code:
    | "not_found"
    | "invalid_input"
    | "invalid_state"
    | "version_unsupported"
    | "schema_incompatible"
    | "io_failed"
    | "append_conflict"
    | "sequence_conflict"
    | "idempotency_conflict"
    | "projection_stale"
    | "projection_incompatible"
    | "artifact_unavailable";
  readonly message: string;
  readonly retryable?: boolean;
  readonly cause?: unknown;
}): Err {
  return domainErr({
    code: input.code,
    message: input.message,
    module: eventLedgerModule,
    retryable: input.retryable ?? false,
    ...(input.cause === undefined ? {} : { cause: input.cause })
  });
}

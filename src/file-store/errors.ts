import { domainErr, type Err } from "../domain/result.js";

export const fileStoreModule = "file-native-store";

export function fileStoreErr(input: {
  readonly code:
    | "not_found"
    | "invalid_input"
    | "permission_denied"
    | "path_escape_rejected"
    | "symlink_escape_rejected"
    | "file_too_large"
    | "unsupported_encoding"
    | "atomic_write_failed"
    | "io_failed";
  readonly message: string;
  readonly retryable?: boolean;
  readonly cause?: unknown;
}): Err {
  return domainErr({
    code: input.code,
    message: input.message,
    module: fileStoreModule,
    retryable: input.retryable ?? false,
    ...(input.cause === undefined ? {} : { cause: input.cause })
  });
}

export function ioErr(message: string, cause: unknown): Err {
  return fileStoreErr({ code: "io_failed", message, retryable: true, cause });
}

export function isNodeNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

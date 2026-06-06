import type { ArtifactRef, DomainErrorCode } from "../domain/index.js";
import { domainErr, type Err } from "../domain/result.js";

export interface ToolRuntimeErrInput {
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly retryable?: boolean;
  readonly cause?: unknown;
  readonly evidenceRef?: ArtifactRef;
}

export function toolRuntimeErr(input: ToolRuntimeErrInput): Err {
  return domainErr({
    code: input.code,
    message: input.message,
    module: "tool-runtime",
    retryable: input.retryable ?? false,
    ...(input.evidenceRef === undefined ? {} : { evidenceRef: input.evidenceRef }),
    ...(input.cause === undefined ? {} : { cause: input.cause })
  });
}

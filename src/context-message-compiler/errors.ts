import { domainErr, type DomainErrorCode, type Err } from "../domain/result.js";

export interface ContextErrInput {
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly retryable?: boolean;
  readonly cause?: unknown;
}

export function contextErr(input: ContextErrInput): Err {
  return domainErr({
    code: input.code,
    message: input.message,
    module: "context-message-compiler",
    retryable: input.retryable ?? false,
    ...(input.cause === undefined ? {} : { cause: input.cause })
  });
}

import type { ArtifactRef, DomainErrorCode } from "../domain/index.js";
import { domainErr, type Err } from "../domain/result.js";

export interface LLMGatewayErrInput {
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly retryable?: boolean;
  readonly cause?: unknown;
  readonly evidenceRef?: ArtifactRef;
}

export function llmGatewayErr(input: LLMGatewayErrInput): Err {
  return domainErr({
    code: input.code,
    message: input.message,
    module: "llm-gateway",
    retryable: input.retryable ?? false,
    ...(input.evidenceRef === undefined ? {} : { evidenceRef: input.evidenceRef }),
    ...(input.cause === undefined ? {} : { cause: input.cause })
  });
}

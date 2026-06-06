import { domainErr } from "../domain/result.js";
import type { DomainErrorCode, DomainErrorInput, Result } from "../domain/result.js";

export const growAttemptRunnerModule = "grow-attempt-runner";

export function attemptErr(input: Omit<DomainErrorInput, "module">) {
  return domainErr({ module: growAttemptRunnerModule, ...input });
}

export function attemptErrResult<T>(
  code: DomainErrorCode,
  message: string,
  extra: Partial<Omit<DomainErrorInput, "code" | "message" | "module">> = {}
): Result<T> {
  return attemptErr({ code, message, ...extra });
}

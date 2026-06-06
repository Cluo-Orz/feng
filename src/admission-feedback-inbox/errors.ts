import { domainErr, type DomainErrorInput } from "../domain/result.js";

const moduleName = "admission-feedback-inbox";

export function admissionErr(input: Omit<DomainErrorInput, "module">) {
  return domainErr({ module: moduleName, ...input });
}

import { domainErr, type DomainErrorInput } from "../domain/result.js";

const moduleName = "evidence-readiness";

export function evidenceErr(input: Omit<DomainErrorInput, "module">) {
  return domainErr({ module: moduleName, ...input });
}

import { domainErr, type DomainErrorInput } from "../domain/result.js";

const moduleName = "grow-unit-manager";

export function growUnitErr(input: Omit<DomainErrorInput, "module">) {
  return domainErr({ module: moduleName, ...input });
}

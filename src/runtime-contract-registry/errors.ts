import { domainErr, type DomainErrorInput } from "../domain/result.js";

const moduleName = "runtime-contract-registry";

export function contractErr(input: Omit<DomainErrorInput, "module">) {
  return domainErr({ module: moduleName, ...input });
}

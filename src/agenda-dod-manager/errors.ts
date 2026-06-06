import { domainErr, type DomainErrorInput } from "../domain/result.js";

const moduleName = "agenda-dod-manager";

export function agendaErr(input: Omit<DomainErrorInput, "module">) {
  return domainErr({ module: moduleName, ...input });
}

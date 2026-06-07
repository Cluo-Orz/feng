import { domainErr, type DomainErrorInput, type Err } from "../domain/index.js";

export function cliErr(input: Omit<DomainErrorInput, "module">): Err {
  return domainErr({ module: "cli", ...input });
}

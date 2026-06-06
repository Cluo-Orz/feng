import { domainErr, type DomainErrorInput, type Err } from "../domain/index.js";

export function targetErr(input: Omit<DomainErrorInput, "module">): Err {
  return domainErr({ module: "target-world-adapter", ...input });
}

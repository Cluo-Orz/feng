import { domainErr, type DomainErrorInput, type Err } from "../domain/result.js";

export function hatchErr(input: Omit<DomainErrorInput, "module">): Err {
  return domainErr({ module: "hatch-builder", ...input });
}

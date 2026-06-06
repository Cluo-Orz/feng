import { domainErr, type DomainErrorInput, type Err } from "../domain/result.js";

export function runtimeErr(input: Omit<DomainErrorInput, "module">): Err {
  return domainErr({ module: "agent-runtime-kernel", ...input });
}

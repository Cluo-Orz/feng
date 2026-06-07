import { domainErr, type DomainErrorInput, type Err } from "../domain/index.js";

export function bridgeErr(input: Omit<DomainErrorInput, "module">): Err {
  return domainErr({ module: "debug-feedback-bridge", ...input });
}

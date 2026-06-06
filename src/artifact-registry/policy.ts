import { ok, type Result } from "../domain/result.js";
import { artifactErr } from "./errors.js";
import type { ArtifactKind, ArtifactProducerModule } from "./types.js";

const producerPolicy: Partial<Record<ArtifactKind, readonly ArtifactProducerModule[]>> = {
  compiled_message_list: ["context-message-compiler"],
  runtime_message_list: ["agent-runtime-kernel"],
  tool_result: ["tool-runtime", "grow-attempt-runner"],
  runtime_contract: ["runtime-contract-registry"],
  hatch_package: ["hatch-builder"]
};

export function validateProducer(kind: ArtifactKind, producer: ArtifactProducerModule): Result<void> {
  const allowed = producerPolicy[kind];
  if (allowed === undefined || allowed.includes(producer)) return ok(undefined);
  return artifactErr({
    code: "invalid_state",
    message: `${producer} cannot register artifact kind ${kind}`
  });
}

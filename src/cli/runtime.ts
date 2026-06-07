import { randomUUID } from "node:crypto";
import type { AuditDescriptor, SourceDescriptor, VersionDescriptor, WorkspaceId } from "../domain/index.js";
import type { LLMModelSelection } from "../llm-gateway/index.js";
import type { CLIPorts, FengCliOptions } from "./ports.js";

export interface CLIRuntime {
  readonly ports: CLIPorts;
  readonly producer: string;
  readonly defaultModelSelection?: LLMModelSelection;
  readonly now: () => string;
  readonly newId: () => string;
}

export function createCLIRuntime(options: FengCliOptions): CLIRuntime {
  return {
    ports: options.ports,
    producer: options.producer,
    ...(options.defaultModelSelection === undefined ? {} : { defaultModelSelection: options.defaultModelSelection }),
    now: options.now ?? (() => new Date().toISOString()),
    newId: options.newId ?? (() => randomUUID())
  };
}

export function cliSource(runtime: CLIRuntime, workspace: WorkspaceId): SourceDescriptor {
  return {
    kind: "user",
    origin: runtime.producer,
    workspace,
    userProvided: true,
    receivedAt: runtime.now(),
    privacyLevel: "workspace_private"
  };
}

export function cliAudit(runtime: CLIRuntime, reason: string): AuditDescriptor {
  return { createdAt: runtime.now(), createdBy: runtime.producer, reason };
}

export const cliVersion: VersionDescriptor = {
  schemaVersion: "1.0.0",
  producerVersion: "cli"
};

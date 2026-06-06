import type { GrowUnitId, WorkspaceId } from "./ids.js";
import type { ArtifactRef, DomainRef } from "./refs.js";

export const privacyLevels = [
  "public",
  "workspace_private",
  "project_private",
  "contains_secret",
  "contains_user_content",
  "contains_model_output",
  "redacted",
  "unknown"
] as const;

export type PrivacyLevel = (typeof privacyLevels)[number];

export const sourceKinds = [
  "user",
  "system",
  "tool",
  "llm",
  "runtime",
  "target_world",
  "imported",
  "derived"
] as const;

export type SourceKind = (typeof sourceKinds)[number];

export interface RuntimeSourceDescriptor {
  readonly runtimeId?: string;
  readonly invocationId?: string;
  readonly turnId?: string;
}

export interface SourceDescriptor {
  readonly kind: SourceKind;
  readonly origin: string;
  readonly workspace?: WorkspaceId;
  readonly growUnit?: GrowUnitId;
  readonly runtime?: RuntimeSourceDescriptor;
  readonly userProvided: boolean;
  readonly generatedBy?: string;
  readonly receivedAt: string;
  readonly privacyLevel: PrivacyLevel;
}

export interface VersionDescriptor {
  readonly schemaVersion: string;
  readonly contractVersion?: string;
  readonly producerVersion?: string;
  readonly compatibleRange?: string;
}

export interface AuditDescriptor {
  readonly createdAt: string;
  readonly createdBy: string;
  readonly reason: string;
  readonly correlationId?: string;
  readonly parentRef?: DomainRef;
  readonly evidenceRefs?: readonly ArtifactRef[];
}


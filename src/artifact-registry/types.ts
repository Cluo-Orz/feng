import type { AuditDescriptor, SourceDescriptor, VersionDescriptor, PrivacyLevel } from "../domain/descriptors.js";
import type { ArtifactId } from "../domain/ids.js";
import type { ArtifactRef } from "../domain/refs.js";
import type { Result } from "../domain/result.js";
import type { ContentHash, LineRange, ReadReceipt, WriteReceipt, DeleteReceipt, WorkspaceHandle } from "../file-store/index.js";
import type { EventAppendReceipt, EventLedger } from "../event-ledger/index.js";

export const artifactKinds = [
  "source_material",
  "user_input_attachment",
  "compiled_message_list",
  "runtime_message_list",
  "tool_result",
  "attempt_trace",
  "runtime_trace",
  "candidate_output",
  "validation_report",
  "feedback_evidence",
  "hatch_package",
  "runtime_contract",
  "skill_body",
  "memory_candidate",
  "summary",
  "preview"
] as const;

export type ArtifactKind = (typeof artifactKinds)[number];

export const artifactLifecycles = [
  "registered",
  "active",
  "archived",
  "redacted",
  "unavailable",
  "retracted",
  "deleted"
] as const;

export type ArtifactLifecycle = (typeof artifactLifecycles)[number];

export const retentionClasses = [
  "ephemeral",
  "attempt_scoped",
  "grow_scoped",
  "hatch_scoped",
  "runtime_scoped",
  "archive"
] as const;

export type RetentionClass = (typeof retentionClasses)[number];

export type ArtifactProducerModule =
  | "artifact-registry"
  | "context-message-compiler"
  | "llm-gateway"
  | "agent-runtime-kernel"
  | "tool-runtime"
  | "grow-attempt-runner"
  | "evidence-readiness"
  | "hatch-builder"
  | "human"
  | "importer"
  | "unknown";

export interface ManagedContentLocation {
  readonly kind: "managed";
  readonly logicalPath: string;
}

export interface ExternalContentLocation {
  readonly kind: "external";
  readonly handle: string;
  readonly trusted: boolean;
}

export type ArtifactContentLocation = ManagedContentLocation | ExternalContentLocation;

export interface ArtifactRecord {
  readonly artifactId: ArtifactId;
  readonly artifactRef: ArtifactRef;
  readonly kind: ArtifactKind;
  readonly lifecycle: ArtifactLifecycle;
  readonly contentLocation: ArtifactContentLocation;
  readonly contentHash?: ContentHash;
  readonly size?: number;
  readonly mediaType: string;
  readonly encoding?: "utf8" | "binary" | "external";
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
  readonly privacyClass: PrivacyLevel;
  readonly retentionClass: RetentionClass;
  readonly previewRef?: ArtifactRef;
  readonly parentRefs: readonly ArtifactRef[];
  readonly correlationId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly producerModule: ArtifactProducerModule;
}

export interface RegisterArtifactInput {
  readonly kind: ArtifactKind;
  readonly content: string | Uint8Array;
  readonly mediaType: string;
  readonly encoding?: "utf8" | "binary";
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
  readonly privacyClass: PrivacyLevel;
  readonly retentionClass: RetentionClass;
  readonly producerModule: ArtifactProducerModule;
  readonly correlationId?: string;
}

export interface RegisterDerivedArtifactInput extends RegisterArtifactInput {
  readonly parentRefs: readonly ArtifactRef[];
}

export interface RegisterExternalHandleInput {
  readonly kind: ArtifactKind;
  readonly handle: string;
  readonly mediaType: string;
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly audit: AuditDescriptor;
  readonly privacyClass: PrivacyLevel;
  readonly retentionClass: RetentionClass;
  readonly producerModule: ArtifactProducerModule;
  readonly contentHash?: ContentHash;
  readonly size?: number;
  readonly trusted?: boolean;
  readonly parentRefs?: readonly ArtifactRef[];
  readonly correlationId?: string;
}

export interface ArtifactMaterialization {
  readonly artifactRef: ArtifactRef;
  readonly status: "available" | "redacted" | "unavailable" | "retracted" | "deleted";
  readonly content?: string | Uint8Array;
  readonly contentHandle?: string;
  readonly contentHash?: ContentHash;
  readonly range?: LineRange;
  readonly truncated: boolean;
  readonly redacted: boolean;
  readonly privacyClass: PrivacyLevel;
  readonly source: SourceDescriptor;
  readonly version: VersionDescriptor;
  readonly readReceipt?: ReadReceipt;
}

export interface MaterializeOptions {
  readonly reason: string;
  readonly maxBytes?: number;
  readonly allowArchived?: boolean;
}

export interface ArtifactPreview {
  readonly artifactRef: ArtifactRef;
  readonly previewRef: ArtifactRef;
  readonly content: string;
  readonly generatedBy: string;
  readonly sourceHash?: ContentHash;
}

export interface PreviewInput {
  readonly content: string;
  readonly generatedBy: string;
  readonly audit: AuditDescriptor;
}

export interface ArtifactLifecycleReceipt {
  readonly artifactRef: ArtifactRef;
  readonly from: ArtifactLifecycle;
  readonly to: ArtifactLifecycle;
  readonly reason: string;
  readonly recordWriteReceipt: WriteReceipt;
  readonly contentDeleteReceipt?: DeleteReceipt;
  readonly eventReceipt?: EventAppendReceipt;
}

export interface ArtifactRegistryOptions {
  readonly workspace: WorkspaceHandle;
  readonly ledger: EventLedger;
  readonly producer: string;
  readonly defaultPreviewChars?: number;
}

export interface ArtifactRegistry {
  readonly registerArtifact: (input: RegisterArtifactInput) => Promise<Result<ArtifactRef>>;
  readonly registerDerivedArtifact: (input: RegisterDerivedArtifactInput) => Promise<Result<ArtifactRef>>;
  readonly registerExternalHandle: (input: RegisterExternalHandleInput) => Promise<Result<ArtifactRef>>;
  readonly resolveArtifact: (ref: ArtifactRef) => Promise<Result<ArtifactRecord>>;
  readonly materializeArtifact: (
    ref: ArtifactRef,
    options: MaterializeOptions
  ) => Promise<Result<ArtifactMaterialization>>;
  readonly readArtifactRange: (
    ref: ArtifactRef,
    range: LineRange,
    options: MaterializeOptions
  ) => Promise<Result<ArtifactMaterialization>>;
  readonly generatePreview: (ref: ArtifactRef, reason: string) => Promise<Result<ArtifactRef>>;
  readonly updatePreview: (ref: ArtifactRef, input: PreviewInput) => Promise<Result<ArtifactRef>>;
  readonly readArtifactPreview: (ref: ArtifactRef, options: MaterializeOptions) => Promise<Result<ArtifactPreview>>;
  readonly archiveArtifact: (ref: ArtifactRef, reason: string) => Promise<Result<ArtifactLifecycleReceipt>>;
  readonly redactArtifact: (ref: ArtifactRef, reason: string) => Promise<Result<ArtifactLifecycleReceipt>>;
  readonly markUnavailable: (ref: ArtifactRef, reason: string) => Promise<Result<ArtifactLifecycleReceipt>>;
  readonly retractArtifact: (ref: ArtifactRef, reason: string) => Promise<Result<ArtifactLifecycleReceipt>>;
  readonly deleteArtifactContent: (ref: ArtifactRef, reason: string) => Promise<Result<ArtifactLifecycleReceipt>>;
}

import { randomUUID } from "node:crypto";
import { makeArtifactId } from "../domain/ids.js";
import { makeRef, type ArtifactRef } from "../domain/refs.js";
import { ok, type Result } from "../domain/result.js";
import type { ContentHash, FileNativeStore, LineRange } from "../file-store/index.js";
import { makeLedgerStreamId } from "../event-ledger/index.js";
import { artifactErr } from "./errors.js";
import { artifactContentPath, artifactRecordPath } from "./paths.js";
import { validateProducer } from "./policy.js";
import type {
  ArtifactLifecycle,
  ArtifactLifecycleReceipt,
  ArtifactMaterialization,
  ArtifactPreview,
  ArtifactRecord,
  ArtifactRegistry,
  ArtifactRegistryOptions,
  MaterializeOptions,
  PreviewInput,
  RegisterArtifactInput,
  RegisterDerivedArtifactInput,
  RegisterExternalHandleInput
} from "./types.js";

export function createArtifactRegistry(store: FileNativeStore, options: ArtifactRegistryOptions): ArtifactRegistry {
  return new NodeArtifactRegistry(store, options);
}

class NodeArtifactRegistry implements ArtifactRegistry {
  private readonly previewChars: number;

  constructor(
    private readonly store: FileNativeStore,
    private readonly options: ArtifactRegistryOptions
  ) {
    this.previewChars = options.defaultPreviewChars ?? 1_200;
  }

  async registerArtifact(input: RegisterArtifactInput): Promise<Result<ArtifactRef>> {
    return this.registerManaged({ ...input, parentRefs: [] });
  }

  async registerDerivedArtifact(input: RegisterDerivedArtifactInput): Promise<Result<ArtifactRef>> {
    if (input.parentRefs.length === 0) {
      return artifactErr({ code: "invalid_input", message: "derived artifact requires parentRefs" });
    }
    return this.registerManaged(input);
  }

  async registerExternalHandle(input: RegisterExternalHandleInput): Promise<Result<ArtifactRef>> {
    const valid = validateProducer(input.kind, input.producerModule);
    if (!valid.ok) return valid;
    if (input.handle.trim().length === 0) {
      return artifactErr({ code: "invalid_input", message: "external handle cannot be empty" });
    }
    const artifactId = makeArtifactId(`artifact-${randomUUID()}`);
    const artifactRef = makeArtifactRef(artifactId);
    const now = new Date().toISOString();
    const record: ArtifactRecord = {
      artifactId,
      artifactRef,
      kind: input.kind,
      lifecycle: "registered",
      contentLocation: { kind: "external", handle: input.handle, trusted: input.trusted ?? false },
      ...(input.contentHash === undefined ? {} : { contentHash: input.contentHash }),
      ...(input.size === undefined ? {} : { size: input.size }),
      mediaType: input.mediaType,
      encoding: "external",
      source: input.source,
      version: input.version,
      audit: input.audit,
      privacyClass: input.privacyClass,
      retentionClass: input.retentionClass,
      parentRefs: input.parentRefs ?? [],
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      createdAt: now,
      updatedAt: now,
      producerModule: input.producerModule
    };
    const write = await this.writeRecord(record, "register external artifact");
    if (!write.ok) return write;
    const event = await this.appendLifecycleEvent(record, "registered", input.audit.reason);
    return event.ok ? ok(artifactRef) : event;
  }

  async resolveArtifact(ref: ArtifactRef): Promise<Result<ArtifactRecord>> {
    const read = await this.store.readText(this.options.workspace, artifactRecordPath(ref.id), {
      reason: "resolve artifact",
      maxBytes: 512 * 1024
    });
    if (!read.ok) return read.error.code === "not_found" ? artifactErr({ code: "not_found", message: "artifact not found" }) : read;
    try {
      const record = JSON.parse(read.value.content) as ArtifactRecord;
      if (record.artifactId !== ref.id) return artifactErr({ code: "schema_incompatible", message: "artifact id mismatch" });
      return ok(record);
    } catch (cause) {
      return artifactErr({ code: "schema_incompatible", message: "artifact record is invalid JSON", cause });
    }
  }

  async materializeArtifact(ref: ArtifactRef, options: MaterializeOptions): Promise<Result<ArtifactMaterialization>> {
    const record = await this.resolveArtifact(ref);
    if (!record.ok) return record;
    const guard = lifecycleMaterialization(record.value, options);
    if (!guard.ok) return guard;
    if (guard.value !== "available") return ok(statusMaterialization(record.value, guard.value));
    if (record.value.contentLocation.kind === "external") {
      return ok({
        ...baseMaterialization(record.value),
        status: "available",
        contentHandle: record.value.contentLocation.handle,
        truncated: false,
        redacted: false
      });
    }
    const read = await this.store.readBinary(this.options.workspace, record.value.contentLocation.logicalPath, {
      reason: options.reason,
      ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes })
    });
    if (!read.ok) return read;
    if (record.value.contentHash !== undefined && read.value.receipt.contentHash.value !== record.value.contentHash.value) {
      return artifactErr({ code: "content_hash_mismatch", message: "artifact content hash mismatch" });
    }
    return ok({
      ...baseMaterialization(record.value),
      status: "available",
      content: record.value.encoding === "utf8" ? Buffer.from(read.value.content).toString("utf8") : read.value.content,
      contentHash: read.value.receipt.contentHash,
      truncated: false,
      redacted: false,
      readReceipt: read.value.receipt
    });
  }

  async readArtifactRange(
    ref: ArtifactRef,
    range: LineRange,
    options: MaterializeOptions
  ): Promise<Result<ArtifactMaterialization>> {
    const record = await this.resolveArtifact(ref);
    if (!record.ok) return record;
    if (record.value.encoding !== "utf8" || record.value.contentLocation.kind !== "managed") {
      return artifactErr({ code: "unsupported_encoding", message: "range read requires managed utf8 content" });
    }
    const guard = lifecycleMaterialization(record.value, options);
    if (!guard.ok) return guard;
    if (guard.value !== "available") return ok(statusMaterialization(record.value, guard.value));
    const read = await this.store.readTextRange(this.options.workspace, record.value.contentLocation.logicalPath, range, {
      reason: options.reason,
      ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes })
    });
    if (!read.ok) return read;
    return ok({
      ...baseMaterialization(record.value),
      status: "available",
      content: read.value.content,
      contentHash: read.value.receipt.contentHash,
      range,
      truncated: false,
      redacted: false,
      readReceipt: read.value.receipt
    });
  }

  async generatePreview(ref: ArtifactRef, reason: string): Promise<Result<ArtifactRef>> {
    const materialized = await this.materializeArtifact(ref, { reason, maxBytes: this.previewChars * 4, allowArchived: true });
    if (!materialized.ok) return materialized;
    if (materialized.value.status !== "available") {
      return artifactErr({
        code: materialized.value.status === "redacted" ? "privacy_blocked" : "artifact_unavailable",
        message: "preview cannot be generated from unavailable artifact content"
      });
    }
    const content = materialized.value.content;
    const text = typeof content === "string" ? content : content === undefined ? "" : `<binary ${content.length} bytes>`;
    return this.updatePreview(ref, {
      content: text.slice(0, this.previewChars),
      generatedBy: "artifact-registry",
      audit: {
        createdAt: new Date().toISOString(),
        createdBy: "artifact-registry",
        reason
      }
    });
  }

  async updatePreview(ref: ArtifactRef, input: PreviewInput): Promise<Result<ArtifactRef>> {
    const record = await this.resolveArtifact(ref);
    if (!record.ok) return record;
    const preview = await this.registerDerivedArtifact({
      kind: "preview",
      content: input.content,
      mediaType: "text/plain",
      encoding: "utf8",
      source: record.value.source,
      version: record.value.version,
      audit: input.audit,
      privacyClass: record.value.privacyClass,
      retentionClass: "ephemeral",
      producerModule: "artifact-registry",
      parentRefs: [ref]
    });
    if (!preview.ok) return preview;
    const updated = { ...record.value, previewRef: preview.value, updatedAt: new Date().toISOString() };
    const write = await this.writeRecord(updated, "update preview ref");
    return write.ok ? ok(preview.value) : write;
  }

  async readArtifactPreview(ref: ArtifactRef, options: MaterializeOptions): Promise<Result<ArtifactPreview>> {
    const record = await this.resolveArtifact(ref);
    if (!record.ok) return record;
    const guard = lifecycleMaterialization(record.value, options);
    if (!guard.ok) return guard;
    if (guard.value !== "available") {
      return artifactErr({
        code: guard.value === "redacted" ? "privacy_blocked" : "artifact_unavailable",
        message: "preview cannot be read from unavailable artifact content"
      });
    }
    if (record.value.previewRef === undefined) return artifactErr({ code: "not_found", message: "preview does not exist" });
    const preview = await this.materializeArtifact(record.value.previewRef, options);
    if (!preview.ok) return preview;
    return ok({
      artifactRef: ref,
      previewRef: record.value.previewRef,
      content: typeof preview.value.content === "string" ? preview.value.content : "",
      generatedBy: "artifact-registry",
      ...(record.value.contentHash === undefined ? {} : { sourceHash: record.value.contentHash })
    });
  }

  async archiveArtifact(ref: ArtifactRef, reason: string) {
    return this.transitionLifecycle(ref, "archived", reason);
  }

  async redactArtifact(ref: ArtifactRef, reason: string) {
    return this.transitionLifecycle(ref, "redacted", reason);
  }

  async markUnavailable(ref: ArtifactRef, reason: string) {
    return this.transitionLifecycle(ref, "unavailable", reason);
  }

  async retractArtifact(ref: ArtifactRef, reason: string) {
    return this.transitionLifecycle(ref, "retracted", reason);
  }

  async deleteArtifactContent(ref: ArtifactRef, reason: string) {
    const record = await this.resolveArtifact(ref);
    if (!record.ok) return record;
    let deleted;
    if (record.value.contentLocation.kind === "managed") {
      const removed = await this.store.removeFile(this.options.workspace, record.value.contentLocation.logicalPath, { reason });
      if (!removed.ok && removed.error.code !== "not_found") return removed;
      deleted = removed.ok ? removed.value : undefined;
    }
    const transitioned = await this.transitionLifecycle(ref, "deleted", reason, deleted);
    return transitioned;
  }

  private async registerManaged(input: RegisterDerivedArtifactInput): Promise<Result<ArtifactRef>> {
    const valid = validateProducer(input.kind, input.producerModule);
    if (!valid.ok) return valid;
    const artifactId = makeArtifactId(`artifact-${randomUUID()}`);
    const artifactRef = makeArtifactRef(artifactId);
    const logicalPath = artifactContentPath(artifactId);
    const write = typeof input.content === "string"
      ? await this.store.writeTextAtomic(this.options.workspace, logicalPath, input.content, {
          reason: input.audit.reason,
          createParents: true
        })
      : await this.store.writeBinaryAtomic(this.options.workspace, logicalPath, input.content, {
          reason: input.audit.reason,
          createParents: true
        });
    if (!write.ok) return write;
    const now = new Date().toISOString();
    const record: ArtifactRecord = {
      artifactId,
      artifactRef,
      kind: input.kind,
      lifecycle: "active",
      contentLocation: { kind: "managed", logicalPath },
      contentHash: write.value.contentHashAfter,
      size: write.value.bytesWritten,
      mediaType: input.mediaType,
      encoding: input.encoding ?? (typeof input.content === "string" ? "utf8" : "binary"),
      source: input.source,
      version: input.version,
      audit: input.audit,
      privacyClass: input.privacyClass,
      retentionClass: input.retentionClass,
      parentRefs: input.parentRefs,
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      createdAt: now,
      updatedAt: now,
      producerModule: input.producerModule
    };
    const recordWrite = await this.writeRecord(record, "register artifact");
    if (!recordWrite.ok) return recordWrite;
    const event = await this.appendLifecycleEvent(record, "active", input.audit.reason);
    return event.ok ? ok(artifactRef) : event;
  }

  private async transitionLifecycle(
    ref: ArtifactRef,
    to: ArtifactLifecycle,
    reason: string,
    contentDeleteReceipt?: ArtifactLifecycleReceipt["contentDeleteReceipt"]
  ): Promise<Result<ArtifactLifecycleReceipt>> {
    const record = await this.resolveArtifact(ref);
    if (!record.ok) return record;
    if (record.value.lifecycle === to) {
      return artifactErr({ code: "lifecycle_conflict", message: "artifact is already in requested lifecycle" });
    }
    const updated = { ...record.value, lifecycle: to, updatedAt: new Date().toISOString() };
    const write = await this.writeRecord(updated, reason);
    if (!write.ok) return write;
    const event = await this.appendLifecycleEvent(updated, to, reason);
    if (!event.ok) return event;
    return ok({
      artifactRef: ref,
      from: record.value.lifecycle,
      to,
      reason,
      recordWriteReceipt: write.value,
      ...(contentDeleteReceipt === undefined ? {} : { contentDeleteReceipt }),
      eventReceipt: event.value
    });
  }

  private async writeRecord(record: ArtifactRecord, reason: string) {
    return this.store.writeTextAtomic(
      this.options.workspace,
      artifactRecordPath(record.artifactId),
      JSON.stringify(record, null, 2),
      { reason, createParents: true }
    );
  }

  private async appendLifecycleEvent(record: ArtifactRecord, lifecycle: ArtifactLifecycle, reason: string) {
    return this.options.ledger.appendEvent(
      { streamType: "artifact", streamId: makeLedgerStreamId(record.artifactId) },
      {
        eventType: "artifact.lifecycle.changed",
        eventVersion: "1",
        payload: { artifactId: record.artifactId, kind: record.kind, lifecycle },
        source: record.source,
        audit: { ...record.audit, reason },
        ...(record.correlationId === undefined ? {} : { correlationId: record.correlationId })
      }
    );
  }
}

function makeArtifactRef(artifactId: ArtifactRef["id"]): ArtifactRef {
  return makeRef("artifact", artifactId, { uri: `artifact://${artifactId}` });
}

function baseMaterialization(record: ArtifactRecord) {
  return {
    artifactRef: record.artifactRef,
    privacyClass: record.privacyClass,
    source: record.source,
    version: record.version
  };
}

function statusMaterialization(record: ArtifactRecord, status: ArtifactMaterialization["status"]): ArtifactMaterialization {
  return {
    ...baseMaterialization(record),
    status,
    truncated: false,
    redacted: status === "redacted"
  };
}

function lifecycleMaterialization(
  record: ArtifactRecord,
  options: MaterializeOptions
): Result<"available" | ArtifactMaterialization["status"]> {
  if (record.lifecycle === "archived" && options.allowArchived !== true) {
    return artifactErr({ code: "invalid_state", message: "archived artifact requires allowArchived" });
  }
  if (record.lifecycle === "active" || record.lifecycle === "registered" || record.lifecycle === "archived") {
    return ok("available");
  }
  return ok(record.lifecycle);
}

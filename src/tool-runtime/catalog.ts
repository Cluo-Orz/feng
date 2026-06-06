import { randomUUID } from "node:crypto";
import {
  makeToolId,
  makeRef,
  type ArtifactRef,
  type AuditDescriptor,
  type SourceDescriptor,
  type ToolRef
} from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import { registerToolJsonArtifact, materializeJsonArtifact } from "./artifacts.js";
import { toolRuntimeEventTypes } from "./events.js";
import { toolRuntimeErr } from "./errors.js";
import { makeToolSurfaceId } from "./brand.js";
import {
  defaultSideEffects,
  matchesToolQuery,
  surfaceEntry,
  transitionAllowed,
  validateRegisterToolInput,
  visibleInSurface
} from "./logic.js";
import { appendToolEvent, type ToolRuntimeRuntime } from "./runtime.js";
import type {
  RegisterToolInput,
  ToolCatalogPage,
  ToolCatalogQuery,
  ToolDefinition,
  ToolDiscoveryReport,
  ToolDiscoveryScope,
  ToolLifecycle,
  ToolLifecycleReceipt,
  ToolSurfaceDescription,
  ToolSurfaceSummary
} from "./types.js";

export async function discoverTools(
  runtime: ToolRuntimeRuntime,
  scope: ToolDiscoveryScope
): Promise<Result<ToolDiscoveryReport>> {
  const discovered: Array<ToolDiscoveryReport["discovered"][number]> = [];
  const ignored: string[] = [];
  for (const root of scope.searchPaths) {
    const listing = await runtime.options.store.listDirectory(runtime.options.workspace, root, {
      reason: "discover tool manifests",
      recursive: true,
      maxDepth: scope.maxDepth ?? 4,
      maxEntries: 2_000
    });
    if (!listing.ok) {
      ignored.push(`${root}: ${listing.error.message}`);
      continue;
    }
    for (const entry of listing.value.entries) {
      if (entry.kind !== "file" || !String(entry.logicalPath).endsWith(".tool.json")) continue;
      const read = await runtime.options.store.readText(runtime.options.workspace, entry.logicalPath, {
        reason: "read tool manifest",
        maxBytes: 256 * 1024
      });
      if (!read.ok) {
        ignored.push(`${entry.logicalPath}: ${read.error.message}`);
        continue;
      }
      const parsed = parseDiscoveryManifest(read.value.content);
      if (parsed.ok) discovered.push(parsed.value);
      else ignored.push(`${entry.logicalPath}: ${parsed.error.message}`);
    }
  }
  const report = { discovered, ignored };
  const event = await appendToolEvent({
    runtime,
    eventType: toolRuntimeEventTypes.discovered,
    body: report
  });
  return event.ok ? ok(report) : event;
}

export async function registerTool(
  runtime: ToolRuntimeRuntime,
  input: RegisterToolInput
): Promise<Result<ToolRef>> {
  const valid = validateRegisterToolInput(input);
  if (!valid.ok) return valid;
  const toolId = makeToolId(`tool-${randomUUID()}`);
  const toolRef = makeRef("tool", toolId, { uri: `tool://${input.namespace ?? "default"}/${input.name}` }) as ToolRef;
  const now = new Date().toISOString();
  const record: ToolDefinition = {
    toolId,
    toolRef,
    name: input.name,
    namespace: input.namespace ?? "default",
    version: input.version,
    lifecycle: input.lifecycle ?? "registered",
    sourceKind: input.sourceKind,
    source: input.source,
    description: input.description,
    inputSchema: input.inputSchema,
    ...(input.inputSchemaRef === undefined ? {} : { inputSchemaRef: input.inputSchemaRef }),
    ...(input.outputSchema === undefined ? {} : { outputSchema: input.outputSchema }),
    outputSchemaSummary: input.outputSchemaSummary ?? "tool returns implementation-defined JSON/stdout output",
    declaredCapabilities: input.declaredCapabilities ?? [],
    risk: input.risk ?? "medium",
    sideEffects: input.sideEffects ?? defaultSideEffects,
    credentialRequirements: input.credentialRequirements ?? [],
    timeout: {
      defaultMs: input.timeout?.defaultMs ?? 30_000,
      maxMs: input.timeout?.maxMs ?? 120_000,
      cancellable: input.timeout?.cancellable ?? true
    },
    concurrency: {
      maxConcurrentPerTool: input.concurrency?.maxConcurrentPerTool ?? 1,
      queueWhenBusy: input.concurrency?.queueWhenBusy ?? false
    },
    implementation: input.implementation,
    compatibility: input.compatibility ?? {},
    privacyClass: input.privacyClass ?? "workspace_private",
    audit: input.audit,
    createdAt: now,
    updatedAt: now
  };
  const write = await runtime.storage.writeTool(record);
  if (!write.ok) return write;
  const indexed = await runtime.storage.addToolToIndex(record.toolRef);
  if (!indexed.ok) return indexed;
  const event = await appendToolEvent({
    runtime,
    eventType: toolRuntimeEventTypes.registered,
    body: { toolRef: record.toolRef, name: record.name, namespace: record.namespace, lifecycle: record.lifecycle }
  });
  return event.ok ? ok(record.toolRef) : event;
}

export async function getTool(runtime: ToolRuntimeRuntime, toolRef: ToolRef): Promise<Result<ToolDefinition>> {
  return runtime.storage.readTool(toolRef);
}

export async function listTools(
  runtime: ToolRuntimeRuntime,
  query: ToolCatalogQuery = {}
): Promise<Result<ToolCatalogPage>> {
  const records = await runtime.storage.readAllTools();
  if (!records.ok) return records;
  const filtered = records.value.filter((record) => matchesToolQuery(record, query));
  const start = query.cursor === undefined ? 0 : Number.parseInt(query.cursor, 10);
  const limit = query.limit ?? 50;
  const page = filtered.slice(start, start + limit);
  const next = start + page.length;
  return ok({
    records: page,
    total: filtered.length,
    ...(next < filtered.length ? { nextCursor: String(next) } : {}),
    truncated: next < filtered.length
  });
}

export async function updateToolLifecycle(
  runtime: ToolRuntimeRuntime,
  toolRef: ToolRef,
  lifecycle: ToolLifecycle,
  reason: string
): Promise<Result<ToolLifecycleReceipt>> {
  const existing = await runtime.storage.readTool(toolRef);
  if (!existing.ok) return existing;
  if (!transitionAllowed(existing.value.lifecycle, lifecycle)) {
    return toolRuntimeErr({ code: "lifecycle_conflict", message: "tool lifecycle transition is not allowed" });
  }
  const updated = { ...existing.value, lifecycle, updatedAt: new Date().toISOString() };
  const write = await runtime.storage.writeTool(updated);
  if (!write.ok) return write;
  const event = await appendToolEvent({
    runtime,
    eventType: toolRuntimeEventTypes.lifecycleChanged,
    body: { toolRef, from: existing.value.lifecycle, to: lifecycle, reason }
  });
  return event.ok ? ok({ toolRef, from: existing.value.lifecycle, to: lifecycle, reason, eventReceipt: event.value }) : event;
}

export async function describeToolSurface(input: {
  readonly runtime: ToolRuntimeRuntime;
  readonly filters: ToolCatalogQuery;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}): Promise<Result<ToolSurfaceDescription>> {
  const listed = await listTools(input.runtime, { ...input.filters, includeUnavailable: true });
  if (!listed.ok) return listed;
  const surface: ToolSurfaceSummary = {
    surfaceId: makeToolSurfaceId(`tool-surface-${randomUUID()}`),
    entries: listed.value.records.filter(visibleInSurface).map(surfaceEntry),
    filters: input.filters,
    generatedAt: new Date().toISOString(),
    source: input.source,
    audit: input.audit
  };
  const write = await input.runtime.storage.writeSurface(surface);
  if (!write.ok) return write;
  const artifact = await registerToolJsonArtifact({
    artifactRegistry: input.runtime.options.artifactRegistry,
    kind: "summary",
    content: surface,
    source: input.source,
    version: { schemaVersion: "1", producerVersion: input.runtime.options.producer },
    audit: input.audit,
    privacyClass: "workspace_private",
    retentionClass: "attempt_scoped"
  });
  if (!artifact.ok) return artifact;
  const event = await appendToolEvent({
    runtime: input.runtime,
    eventType: toolRuntimeEventTypes.surfaceDescribed,
    body: { surfaceId: surface.surfaceId, surfaceRef: artifact.value, toolCount: surface.entries.length }
  });
  return event.ok ? ok({ surface, surfaceRef: artifact.value, eventReceipt: event.value }) : event;
}

export async function readToolSurface(
  runtime: ToolRuntimeRuntime,
  surfaceRef: ArtifactRef
): Promise<Result<ToolSurfaceSummary>> {
  return materializeJsonArtifact<ToolSurfaceSummary>({
    artifactRegistry: runtime.options.artifactRegistry,
    artifactRef: surfaceRef,
    reason: "explain tool surface"
  });
}

function parseDiscoveryManifest(content: string): Result<ToolDiscoveryReport["discovered"][number]> {
  try {
    const data = JSON.parse(content) as Partial<ToolDefinition>;
    if (data.toolRef === undefined || data.name === undefined || data.namespace === undefined || data.version === undefined) {
      return toolRuntimeErr({ code: "schema_incompatible", message: "tool manifest lacks required summary fields" });
    }
    return ok({ toolRef: data.toolRef, name: data.name, namespace: data.namespace, version: data.version });
  } catch (cause) {
    return toolRuntimeErr({ code: "schema_incompatible", message: "tool manifest is invalid JSON", cause });
  }
}

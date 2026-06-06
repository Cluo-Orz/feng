import { ok, type Result } from "../domain/result.js";
import type { FileNativeStore } from "../file-store/index.js";
import { ledgerErr } from "./errors.js";
import { StreamLocks } from "./locks.js";
import { projectionPath, streamPath } from "./paths.js";
import { newEventId, payloadFingerprint, stableStringify } from "./stable-json.js";
import type {
  AppendEventInput,
  EventAppendReceipt,
  EventEnvelope,
  EventLedger,
  EventLedgerOptions,
  EventPage,
  EventPayloadSummary,
  EventReplay,
  LedgerStream,
  ProjectionDefinition,
  ProjectionInvalidationReceipt,
  ProjectionKey,
  ProjectionName,
  ProjectionReadOptions,
  ProjectionRebuildReport,
  ProjectionSnapshot,
  ReadStreamOptions
} from "./types.js";

export function createEventLedger(store: FileNativeStore, options: EventLedgerOptions): EventLedger {
  return new NodeEventLedger(store, options);
}

class NodeEventLedger implements EventLedger {
  private readonly locks = new StreamLocks();
  private readonly maxInlinePayloadBytes: number;
  private readonly maxStreamReadBytes: number;
  private readonly maxProjectionReadBytes: number;
  private readonly supportedEventVersions: readonly string[];

  constructor(
    private readonly store: FileNativeStore,
    private readonly options: EventLedgerOptions
  ) {
    this.maxInlinePayloadBytes = options.maxInlinePayloadBytes ?? 8 * 1024;
    this.maxStreamReadBytes = options.maxStreamReadBytes ?? 10 * 1024 * 1024;
    this.maxProjectionReadBytes = options.maxProjectionReadBytes ?? 10 * 1024 * 1024;
    this.supportedEventVersions = options.supportedEventVersions ?? ["1"];
  }

  async appendEvent(stream: LedgerStream, event: AppendEventInput): Promise<Result<EventAppendReceipt>> {
    return this.appendBatch(stream, [event]);
  }

  async appendBatch(
    stream: LedgerStream,
    events: readonly AppendEventInput[]
  ): Promise<Result<EventAppendReceipt>> {
    if (events.length === 0) return ledgerErr({ code: "invalid_input", message: "batch cannot be empty" });
    return this.locks.withLock(streamKey(stream), async () => {
      const existing = await this.readAllEvents(stream);
      if (!existing.ok) return existing;
      const prepared = this.prepareAppend(stream, events, existing.value);
      if (!prepared.ok) return prepared;
      if (prepared.value.appended.length === 0) {
        return ok(appendReceipt(stream, [], prepared.value.reused, undefined, events[0]!.audit.reason));
      }

      const record = prepared.value.appended.map((event) => JSON.stringify(event)).join("\n");
      const append = await this.store.appendRecordAtomic(this.options.workspace, streamPath(stream), record, {
        reason: "event-ledger append",
        createParents: true,
        recordSeparator: "\n"
      });
      if (!append.ok) return append;
      return ok(
        appendReceipt(stream, prepared.value.appended, prepared.value.reused, append.value, events[0]!.audit.reason)
      );
    });
  }

  async readStream(stream: LedgerStream, options: ReadStreamOptions): Promise<Result<EventPage>> {
    const all = await this.readAllEvents(stream);
    if (!all.ok) return all;
    const version = validateVersions(all.value, options.supportedEventVersions ?? this.supportedEventVersions);
    if (!version.ok) return version;
    const fromSequence = options.fromSequence ?? 1;
    if (fromSequence < 1) return ledgerErr({ code: "invalid_input", message: "fromSequence must be positive" });
    const limit = options.limit ?? 1_000;
    if (limit < 1) return ledgerErr({ code: "invalid_input", message: "limit must be positive" });
    const selected = all.value.filter((event) => event.sequence >= fromSequence);
    const events = selected.slice(0, limit);
    const read = await this.store.readText(this.options.workspace, streamPath(stream), {
      reason: options.reason,
      maxBytes: this.maxStreamReadBytes
    });
    const readReceipt = read.ok ? read.value.receipt : undefined;
    return ok({
      stream,
      events,
      fromSequence,
      ...(events.length === 0 ? {} : { toSequence: events[events.length - 1]!.sequence }),
      truncated: selected.length > events.length,
      ...(readReceipt === undefined ? {} : { readReceipt })
    });
  }

  async replayStream(stream: LedgerStream, options: ReadStreamOptions): Promise<Result<EventReplay>> {
    const page = await this.readStream(stream, { ...options, limit: options.limit ?? Number.MAX_SAFE_INTEGER });
    if (!page.ok) return page;
    return ok({
      stream,
      events: page.value.events,
      replayedAt: new Date().toISOString(),
      ...(page.value.readReceipt === undefined ? {} : { readReceipt: page.value.readReceipt })
    });
  }

  async buildProjection<State>(
    definition: ProjectionDefinition<State>
  ): Promise<Result<ProjectionSnapshot<State>>> {
    const built = await this.buildProjectionInternal(definition);
    return built.ok ? ok(built.value.snapshot) : built;
  }

  async readProjection<State>(
    name: ProjectionName,
    key: ProjectionKey,
    options: ProjectionReadOptions
  ): Promise<Result<ProjectionSnapshot<State>>> {
    const read = await this.store.readText(this.options.workspace, projectionPath(name, key), {
      reason: options.reason,
      maxBytes: this.maxProjectionReadBytes
    });
    if (!read.ok) {
      return read.error.code === "not_found"
        ? ledgerErr({ code: "not_found", message: "projection does not exist" })
        : read;
    }
    const snapshot = parseProjection<State>(read.value.content);
    if (!snapshot.ok) return snapshot;
    if (options.expectedVersion !== undefined && snapshot.value.projectionVersion !== options.expectedVersion) {
      return ledgerErr({ code: "projection_incompatible", message: "projection version is incompatible" });
    }
    const stale = await this.validateProjectionCheckpoints(snapshot.value);
    return stale.ok ? ok(snapshot.value) : stale;
  }

  async rebuildProjection<State>(
    definition: ProjectionDefinition<State>
  ): Promise<Result<ProjectionRebuildReport<State>>> {
    return this.buildProjectionInternal(definition);
  }

  async invalidateProjection(
    name: ProjectionName,
    key: ProjectionKey,
    reason: string
  ): Promise<Result<ProjectionInvalidationReceipt>> {
    const removed = await this.store.removeFile(this.options.workspace, projectionPath(name, key), { reason });
    if (!removed.ok && removed.error.code !== "not_found") return removed;
    return ok({
      projectionName: name,
      projectionKey: key,
      deleted: removed.ok,
      ...(removed.ok ? { deleteReceipt: removed.value } : {}),
      invalidatedAt: new Date().toISOString(),
      reason
    });
  }

  private prepareAppend(
    stream: LedgerStream,
    inputs: readonly AppendEventInput[],
    existing: readonly EventEnvelope[]
  ): Result<{ readonly appended: readonly EventEnvelope[]; readonly reused: readonly EventEnvelope[] }> {
    const byId = new Map(existing.map((event) => [event.eventId, event]));
    const byKey = new Map(existing.filter((event) => event.idempotencyKey).map((event) => [event.idempotencyKey!, event]));
    const batchKeys = new Map<string, string>();
    const appended: EventEnvelope[] = [];
    const reused: EventEnvelope[] = [];
    let nextSequence = existing.length + 1;

    for (const input of inputs) {
      const valid = validateAppendInput(input, this.supportedEventVersions, this.maxInlinePayloadBytes);
      if (!valid.ok) return valid;
      const fingerprint = payloadFingerprint({
        eventType: input.eventType,
        eventVersion: input.eventVersion,
        payload: input.payload,
        ...(input.payloadRef === undefined ? {} : { payloadRefUri: input.payloadRef.uri })
      });
      const duplicate = duplicateEvent(input, fingerprint, byId, byKey);
      if (!duplicate.ok) return duplicate;
      if (duplicate.value !== undefined) {
        reused.push(duplicate.value);
        continue;
      }
      if (input.idempotencyKey !== undefined) {
        const previous = batchKeys.get(input.idempotencyKey);
        if (previous !== undefined && previous !== fingerprint) {
          return ledgerErr({ code: "idempotency_conflict", message: "batch idempotency key conflict" });
        }
        batchKeys.set(input.idempotencyKey, fingerprint);
      }
      const envelope: EventEnvelope = {
        eventId: input.eventId ?? newEventId(),
        streamId: stream.streamId,
        streamType: stream.streamType,
        sequence: nextSequence++,
        eventType: input.eventType,
        eventVersion: input.eventVersion,
        payload: input.payload,
        ...(input.payloadRef === undefined ? {} : { payloadRef: input.payloadRef }),
        source: input.source,
        audit: input.audit,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
        payloadFingerprint: fingerprint,
        createdAt: new Date().toISOString(),
        producer: input.producer ?? this.options.producer
      };
      appended.push(envelope);
      byId.set(envelope.eventId, envelope);
      if (envelope.idempotencyKey !== undefined) byKey.set(envelope.idempotencyKey, envelope);
    }
    return ok({ appended, reused });
  }

  private async readAllEvents(stream: LedgerStream): Promise<Result<readonly EventEnvelope[]>> {
    const read = await this.store.readText(this.options.workspace, streamPath(stream), {
      reason: "event-ledger read stream",
      maxBytes: this.maxStreamReadBytes
    });
    if (!read.ok) return read.error.code === "not_found" ? ok([]) : read;
    const parsed = parseEvents(read.value.content);
    if (!parsed.ok) return parsed;
    return validateStream(stream, parsed.value);
  }

  private async buildProjectionInternal<State>(
    definition: ProjectionDefinition<State>
  ): Promise<Result<ProjectionRebuildReport<State>>> {
    let state = definition.initialState;
    const checkpoints = [];
    let count = 0;
    for (const stream of definition.selector.streams) {
      const events = await this.readAllEvents(stream);
      if (!events.ok) return events;
      const version = validateVersions(events.value, this.supportedEventVersions);
      if (!version.ok) return version;
      for (const event of events.value) {
        state = definition.reduce(state, event);
        count += 1;
      }
      checkpoints.push({ stream, lastSequence: events.value.at(-1)?.sequence ?? 0 });
    }
    const snapshot: ProjectionSnapshot<State> = {
      projectionName: definition.name,
      projectionKey: definition.key,
      projectionVersion: definition.projectionVersion,
      state,
      checkpoints,
      builtAt: new Date().toISOString(),
      sourceEventCount: count
    };
    const write = await this.store.writeTextAtomic(
      this.options.workspace,
      projectionPath(definition.name, definition.key),
      JSON.stringify(snapshot, null, 2),
      { reason: "projection rebuild", createParents: true }
    );
    if (!write.ok) return write;
    return ok({ snapshot, rebuiltAt: new Date().toISOString(), writeReceipt: write.value });
  }

  private async validateProjectionCheckpoints(snapshot: ProjectionSnapshot): Promise<Result<void>> {
    for (const checkpoint of snapshot.checkpoints) {
      const events = await this.readAllEvents(checkpoint.stream);
      if (!events.ok) return events;
      if (events.value.length < checkpoint.lastSequence) {
        return ledgerErr({ code: "projection_stale", message: "projection checkpoint points past event stream" });
      }
    }
    return ok(undefined);
  }
}

function appendReceipt(
  stream: LedgerStream,
  appendedEvents: readonly EventEnvelope[],
  reusedEvents: readonly EventEnvelope[],
  appendReceipt: EventAppendReceipt["appendReceipt"],
  reason: string
): EventAppendReceipt {
  return {
    stream,
    appendedEvents,
    reusedEvents,
    ...(appendedEvents.length === 0 ? {} : { firstSequence: appendedEvents[0]!.sequence }),
    ...(appendedEvents.length === 0 ? {} : { lastSequence: appendedEvents.at(-1)!.sequence }),
    ...(appendReceipt === undefined ? {} : { appendReceipt }),
    timestamp: new Date().toISOString(),
    reason
  };
}

function validateAppendInput(
  input: AppendEventInput,
  supportedVersions: readonly string[],
  maxInlinePayloadBytes: number
): Result<void> {
  if (input.eventType.trim().length === 0) return ledgerErr({ code: "invalid_input", message: "eventType is required" });
  if (!supportedVersions.includes(input.eventVersion)) {
    return ledgerErr({ code: "version_unsupported", message: "event version is not supported" });
  }
  if (Buffer.byteLength(stableStringify(input.payload), "utf8") > maxInlinePayloadBytes) {
    return ledgerErr({ code: "invalid_input", message: "event payload exceeds inline payload limit" });
  }
  return ok(undefined);
}

function duplicateEvent(
  input: AppendEventInput,
  fingerprint: string,
  byId: ReadonlyMap<string, EventEnvelope>,
  byKey: ReadonlyMap<string, EventEnvelope>
): Result<EventEnvelope | undefined> {
  const sameId = input.eventId === undefined ? undefined : byId.get(input.eventId);
  if (sameId !== undefined) {
    return sameId.payloadFingerprint === fingerprint
      ? ok(sameId)
      : ledgerErr({ code: "append_conflict", message: "eventId already exists with different payload" });
  }
  const sameKey = input.idempotencyKey === undefined ? undefined : byKey.get(input.idempotencyKey);
  if (sameKey === undefined) return ok(undefined);
  return sameKey.payloadFingerprint === fingerprint
    ? ok(sameKey)
    : ledgerErr({ code: "idempotency_conflict", message: "idempotency key already used for different payload" });
}

function parseEvents(content: string): Result<readonly EventEnvelope[]> {
  const events = [];
  try {
    for (const line of content.split(/\r?\n/).filter((item) => item.trim().length > 0)) {
      events.push(JSON.parse(line) as EventEnvelope);
    }
    return ok(events);
  } catch (cause) {
    return ledgerErr({ code: "schema_incompatible", message: "event stream contains invalid JSON", cause });
  }
}

function parseProjection<State>(content: string): Result<ProjectionSnapshot<State>> {
  try {
    return ok(JSON.parse(content) as ProjectionSnapshot<State>);
  } catch (cause) {
    return ledgerErr({ code: "schema_incompatible", message: "projection contains invalid JSON", cause });
  }
}

function validateStream(stream: LedgerStream, events: readonly EventEnvelope[]): Result<readonly EventEnvelope[]> {
  for (const [index, event] of events.entries()) {
    if (event.streamId !== stream.streamId || event.streamType !== stream.streamType) {
      return ledgerErr({ code: "schema_incompatible", message: "event belongs to a different stream" });
    }
    if (event.sequence !== index + 1) {
      return ledgerErr({ code: "sequence_conflict", message: "stream sequence is not strictly increasing" });
    }
  }
  return ok(events);
}

function validateVersions(events: readonly EventEnvelope[], supportedVersions: readonly string[]): Result<void> {
  const unsupported = events.find((event) => !supportedVersions.includes(event.eventVersion));
  return unsupported === undefined
    ? ok(undefined)
    : ledgerErr({ code: "version_unsupported", message: "event version is not supported" });
}

function streamKey(stream: LedgerStream): string {
  return `${stream.streamType}:${stream.streamId}`;
}

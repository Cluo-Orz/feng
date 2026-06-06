import type { AuditDescriptor, SourceDescriptor } from "../domain/descriptors.js";
import type { EventId } from "../domain/ids.js";
import type { ArtifactRef } from "../domain/refs.js";
import type { Result } from "../domain/result.js";
import type { AppendReceipt, ReadReceipt, WriteReceipt, DeleteReceipt, WorkspaceHandle } from "../file-store/index.js";
import type { BrandedString } from "../domain/brand.js";

export type LedgerStreamId = BrandedString<"LedgerStreamId">;
export type IdempotencyKey = BrandedString<"IdempotencyKey">;
export type ProjectionName = BrandedString<"ProjectionName">;
export type ProjectionKey = BrandedString<"ProjectionKey">;

export const ledgerStreamTypes = [
  "workspace",
  "grow_unit",
  "attempt",
  "feedback_unit",
  "hatch_package",
  "runtime_trace",
  "skill",
  "policy"
] as const;

export type LedgerStreamType = (typeof ledgerStreamTypes)[number];

export interface LedgerStream {
  readonly streamType: LedgerStreamType;
  readonly streamId: LedgerStreamId;
}

export type EventPayloadSummary =
  | null
  | string
  | number
  | boolean
  | readonly EventPayloadSummary[]
  | { readonly [key: string]: EventPayloadSummary };

export interface EventEnvelope<Payload extends EventPayloadSummary = EventPayloadSummary> {
  readonly eventId: EventId;
  readonly streamId: LedgerStreamId;
  readonly streamType: LedgerStreamType;
  readonly sequence: number;
  readonly eventType: string;
  readonly eventVersion: string;
  readonly payload: Payload;
  readonly payloadRef?: ArtifactRef;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly correlationId?: string;
  readonly causationId?: EventId;
  readonly idempotencyKey?: IdempotencyKey;
  readonly payloadFingerprint: string;
  readonly createdAt: string;
  readonly producer: string;
}

export interface AppendEventInput<Payload extends EventPayloadSummary = EventPayloadSummary> {
  readonly eventId?: EventId;
  readonly eventType: string;
  readonly eventVersion: string;
  readonly payload: Payload;
  readonly payloadRef?: ArtifactRef;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
  readonly correlationId?: string;
  readonly causationId?: EventId;
  readonly idempotencyKey?: IdempotencyKey;
  readonly producer?: string;
}

export interface EventAppendReceipt {
  readonly stream: LedgerStream;
  readonly appendedEvents: readonly EventEnvelope[];
  readonly reusedEvents: readonly EventEnvelope[];
  readonly firstSequence?: number;
  readonly lastSequence?: number;
  readonly appendReceipt?: AppendReceipt;
  readonly timestamp: string;
  readonly reason: string;
}

export interface ReadStreamOptions {
  readonly fromSequence?: number;
  readonly limit?: number;
  readonly supportedEventVersions?: readonly string[];
  readonly reason: string;
}

export interface EventPage {
  readonly stream: LedgerStream;
  readonly events: readonly EventEnvelope[];
  readonly fromSequence: number;
  readonly toSequence?: number;
  readonly truncated: boolean;
  readonly readReceipt?: ReadReceipt;
}

export interface EventReplay {
  readonly stream: LedgerStream;
  readonly events: readonly EventEnvelope[];
  readonly replayedAt: string;
  readonly readReceipt?: ReadReceipt;
}

export interface ProjectionCheckpoint {
  readonly stream: LedgerStream;
  readonly lastSequence: number;
}

export interface ProjectionSnapshot<State = unknown> {
  readonly projectionName: ProjectionName;
  readonly projectionKey: ProjectionKey;
  readonly projectionVersion: string;
  readonly state: State;
  readonly checkpoints: readonly ProjectionCheckpoint[];
  readonly builtAt: string;
  readonly sourceEventCount: number;
}

export interface StreamSelector {
  readonly streams: readonly LedgerStream[];
}

export interface ProjectionDefinition<State> {
  readonly name: ProjectionName;
  readonly key: ProjectionKey;
  readonly projectionVersion: string;
  readonly selector: StreamSelector;
  readonly initialState: State;
  readonly reduce: (state: State, event: EventEnvelope) => State;
}

export interface ProjectionReadOptions {
  readonly expectedVersion?: string;
  readonly reason: string;
}

export interface ProjectionRebuildReport<State = unknown> {
  readonly snapshot: ProjectionSnapshot<State>;
  readonly rebuiltAt: string;
  readonly writeReceipt: WriteReceipt;
}

export interface ProjectionInvalidationReceipt {
  readonly projectionName: ProjectionName;
  readonly projectionKey: ProjectionKey;
  readonly deleted: boolean;
  readonly deleteReceipt?: DeleteReceipt;
  readonly invalidatedAt: string;
  readonly reason: string;
}

export interface EventLedgerOptions {
  readonly workspace: WorkspaceHandle;
  readonly producer: string;
  readonly maxInlinePayloadBytes?: number;
  readonly maxStreamReadBytes?: number;
  readonly maxProjectionReadBytes?: number;
  readonly supportedEventVersions?: readonly string[];
}

export interface EventLedger {
  readonly appendEvent: (
    stream: LedgerStream,
    event: AppendEventInput
  ) => Promise<Result<EventAppendReceipt>>;
  readonly appendBatch: (
    stream: LedgerStream,
    events: readonly AppendEventInput[]
  ) => Promise<Result<EventAppendReceipt>>;
  readonly readStream: (stream: LedgerStream, options: ReadStreamOptions) => Promise<Result<EventPage>>;
  readonly replayStream: (stream: LedgerStream, options: ReadStreamOptions) => Promise<Result<EventReplay>>;
  readonly buildProjection: <State>(
    definition: ProjectionDefinition<State>
  ) => Promise<Result<ProjectionSnapshot<State>>>;
  readonly readProjection: <State>(
    name: ProjectionName,
    key: ProjectionKey,
    options: ProjectionReadOptions
  ) => Promise<Result<ProjectionSnapshot<State>>>;
  readonly rebuildProjection: <State>(
    definition: ProjectionDefinition<State>
  ) => Promise<Result<ProjectionRebuildReport<State>>>;
  readonly invalidateProjection: (
    name: ProjectionName,
    key: ProjectionKey,
    reason: string
  ) => Promise<Result<ProjectionInvalidationReceipt>>;
}

import { ok, type Result } from "../domain/result.js";
import type { FileNativeStore, WorkspaceHandle, WriteReceipt } from "../file-store/index.js";
import { bridgeErr } from "./errors.js";
import {
  attributionIndexPath,
  attributionPath,
  correlationIndexPath,
  correlationPath,
  envelopeIndexPath,
  envelopePath,
  packetIndexPath,
  packetPath,
  privacyIndexPath,
  privacyPath,
  proposalRequestIndexPath,
  proposalRequestPath
} from "./paths.js";
import type {
  DebugCorrelation,
  DebugCorrelationRef,
  FeedbackAttribution,
  FeedbackBridgePacket,
  FeedbackBridgePacketRef,
  PrivacyFilterResult,
  RefIndex,
  RuntimeReportEnvelope,
  RuntimeReportEnvelopeRef,
  UpstreamProposalRequest,
  UpstreamProposalRequestRef
} from "./types.js";

export class DebugBridgeStorage {
  constructor(
    private readonly store: FileNativeStore,
    private readonly workspace: WorkspaceHandle
  ) {}

  readCorrelation(ref: DebugCorrelationRef): Promise<Result<DebugCorrelation>> {
    return this.readRecord(correlationPath(ref.id), "debug correlation is invalid", "debug correlation not found");
  }

  writeCorrelation(record: DebugCorrelation, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(correlationPath(record.debugCorrelationId), record, reason);
  }

  addCorrelation(ref: DebugCorrelationRef): Promise<Result<WriteReceipt>> {
    return this.addRef(correlationIndexPath, ref, "correlation index is invalid", "write correlation index");
  }

  readEnvelope(ref: RuntimeReportEnvelopeRef): Promise<Result<RuntimeReportEnvelope>> {
    return this.readRecord(envelopePath(ref.id), "runtime report envelope is invalid", "runtime report envelope not found");
  }

  writeEnvelope(record: RuntimeReportEnvelope, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(envelopePath(record.runtimeReportId), record, reason);
  }

  addEnvelope(ref: RuntimeReportEnvelopeRef): Promise<Result<WriteReceipt>> {
    return this.addRef(envelopeIndexPath, ref, "envelope index is invalid", "write envelope index");
  }

  writeAttribution(record: FeedbackAttribution, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(attributionPath(record.attributionId), record, reason);
  }

  addAttribution(ref: { readonly id: string }): Promise<Result<WriteReceipt>> {
    return this.addRef(attributionIndexPath, ref, "attribution index is invalid", "write attribution index");
  }

  writePrivacy(record: PrivacyFilterResult, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(privacyPath(record.privacyFilterId), record, reason);
  }

  addPrivacy(ref: { readonly id: string }): Promise<Result<WriteReceipt>> {
    return this.addRef(privacyIndexPath, ref, "privacy index is invalid", "write privacy index");
  }

  readPacket(ref: FeedbackBridgePacketRef): Promise<Result<FeedbackBridgePacket>> {
    return this.readRecord(packetPath(ref.id), "feedback bridge packet is invalid", "feedback bridge packet not found");
  }

  writePacket(record: FeedbackBridgePacket, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(packetPath(record.bridgePacketId), record, reason);
  }

  addPacket(ref: FeedbackBridgePacketRef): Promise<Result<WriteReceipt>> {
    return this.addRef(packetIndexPath, ref, "packet index is invalid", "write packet index");
  }

  readProposalRequest(ref: UpstreamProposalRequestRef): Promise<Result<UpstreamProposalRequest>> {
    return this.readRecord(proposalRequestPath(ref.id), "upstream proposal request is invalid", "upstream proposal request not found");
  }

  writeProposalRequest(record: UpstreamProposalRequest, reason: string): Promise<Result<WriteReceipt>> {
    return this.writeRecord(proposalRequestPath(record.upstreamProposalRequestId), record, reason);
  }

  addProposalRequest(ref: UpstreamProposalRequestRef): Promise<Result<WriteReceipt>> {
    return this.addRef(proposalRequestIndexPath, ref, "proposal request index is invalid", "write proposal request index");
  }

  async readPacketsForCorrelation(ref: DebugCorrelationRef): Promise<Result<readonly FeedbackBridgePacket[]>> {
    const index = await this.readIndex<RefIndex<FeedbackBridgePacketRef>>(packetIndexPath, "packet index is invalid");
    if (!index.ok) return index;
    const records: FeedbackBridgePacket[] = [];
    for (const packetRef of index.value.refs) {
      const record = await this.readPacket(packetRef);
      if (!record.ok) {
        if (record.error.code === "not_found") continue;
        return record;
      }
      if (record.value.debugCorrelationRef.id === ref.id) records.push(record.value);
    }
    return ok(records);
  }

  private async addRef<T extends { readonly id: string }>(
    path: string,
    ref: T,
    invalid: string,
    reason: string
  ): Promise<Result<WriteReceipt>> {
    const index = await this.readIndex<RefIndex<T>>(path, invalid);
    return index.ok ? this.writeRecord(path, { refs: uniqueRefs(index.value.refs, ref) }, reason) : index;
  }

  private async readIndex<T>(path: string, invalid: string): Promise<Result<T>> {
    const read = await this.store.readText(this.workspace, path, { reason: `read ${path}`, maxBytes: 512 * 1024 });
    if (!read.ok) return read.error.code === "not_found" ? ok({ refs: [] } as T) : read;
    return parseJson<T>(read.value.content, invalid);
  }

  private async readRecord<T>(path: string, invalid: string, missing: string): Promise<Result<T>> {
    const read = await this.store.readText(this.workspace, path, { reason: `read ${path}`, maxBytes: 512 * 1024 });
    if (!read.ok) return read.error.code === "not_found" ? bridgeErr({ code: "not_found", message: missing }) : read;
    return parseJson<T>(read.value.content, invalid);
  }

  private writeRecord(path: string, record: unknown, reason: string): Promise<Result<WriteReceipt>> {
    return this.store.writeTextAtomic(this.workspace, path, JSON.stringify(record, null, 2), {
      reason,
      createParents: true
    });
  }
}

export function parseJson<T>(content: string, message: string): Result<T> {
  try {
    return ok(JSON.parse(content) as T);
  } catch (cause) {
    return bridgeErr({ code: "schema_incompatible", message, cause });
  }
}

function uniqueRefs<T extends { readonly id: string }>(existing: readonly T[], ref: T): readonly T[] {
  return existing.some((item) => item.id === ref.id) ? existing : [...existing, ref];
}

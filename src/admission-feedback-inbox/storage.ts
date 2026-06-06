import { ok, type Result } from "../domain/result.js";
import type { FeedbackUnitRef } from "../domain/index.js";
import type { FileNativeStore, WorkspaceHandle, WriteReceipt } from "../file-store/index.js";
import { admissionErr } from "./errors.js";
import {
  feedbackIndexPath,
  feedbackRecordPath,
  inboxIndexPath,
  inboxRecordPath,
  proposalIndexPath,
  proposalRecordPath
} from "./paths.js";
import type {
  FeedbackIndex,
  FeedbackUnitRecord,
  InboxIndex,
  InboxItemRecord,
  InboxItemRef,
  ProposalIndex,
  UpstreamProposalRecord,
  UpstreamProposalRef
} from "./types.js";

export class AdmissionStorage {
  constructor(
    private readonly store: FileNativeStore,
    private readonly workspace: WorkspaceHandle
  ) {}

  async readInbox(ref: InboxItemRef): Promise<Result<InboxItemRecord>> {
    const read = await this.store.readText(this.workspace, inboxRecordPath(ref.id), {
      reason: "read inbox item",
      maxBytes: 512 * 1024
    });
    if (!read.ok) return read.error.code === "not_found"
      ? admissionErr({ code: "not_found", message: "inbox item not found" })
      : read;
    return parseJson<InboxItemRecord>(read.value.content, "inbox item record is invalid");
  }

  async writeInbox(record: InboxItemRecord, reason: string): Promise<Result<WriteReceipt>> {
    return this.store.writeTextAtomic(this.workspace, inboxRecordPath(record.inboxItemId), JSON.stringify(record, null, 2), {
      reason,
      createParents: true
    });
  }

  async readFeedback(ref: FeedbackUnitRef): Promise<Result<FeedbackUnitRecord>> {
    const read = await this.store.readText(this.workspace, feedbackRecordPath(ref.id), {
      reason: "read feedback unit",
      maxBytes: 512 * 1024
    });
    if (!read.ok) return read.error.code === "not_found"
      ? admissionErr({ code: "not_found", message: "feedback unit not found" })
      : read;
    return parseJson<FeedbackUnitRecord>(read.value.content, "feedback unit record is invalid");
  }

  async writeFeedback(record: FeedbackUnitRecord, reason: string): Promise<Result<WriteReceipt>> {
    return this.store.writeTextAtomic(
      this.workspace,
      feedbackRecordPath(record.feedbackUnitId),
      JSON.stringify(record, null, 2),
      { reason, createParents: true }
    );
  }

  async readProposal(ref: UpstreamProposalRef): Promise<Result<UpstreamProposalRecord>> {
    const read = await this.store.readText(this.workspace, proposalRecordPath(ref.id), {
      reason: "read upstream proposal",
      maxBytes: 512 * 1024
    });
    if (!read.ok) return read.error.code === "not_found"
      ? admissionErr({ code: "not_found", message: "upstream proposal not found" })
      : read;
    return parseJson<UpstreamProposalRecord>(read.value.content, "upstream proposal record is invalid");
  }

  async writeProposal(record: UpstreamProposalRecord, reason: string): Promise<Result<WriteReceipt>> {
    return this.store.writeTextAtomic(
      this.workspace,
      proposalRecordPath(record.proposalId),
      JSON.stringify(record, null, 2),
      { reason, createParents: true }
    );
  }

  async addInbox(ref: InboxItemRef): Promise<Result<WriteReceipt>> {
    const index = await this.readInboxIndex();
    if (!index.ok) return index;
    const refs = index.value.inboxItemRefs.some((item) => item.id === ref.id)
      ? index.value.inboxItemRefs
      : [...index.value.inboxItemRefs, ref];
    return this.store.writeTextAtomic(this.workspace, inboxIndexPath, JSON.stringify({ inboxItemRefs: refs }, null, 2), {
      reason: "write inbox index",
      createParents: true
    });
  }

  async addFeedback(ref: FeedbackUnitRef): Promise<Result<WriteReceipt>> {
    const index = await this.readFeedbackIndex();
    if (!index.ok) return index;
    const refs = index.value.feedbackUnitRefs.some((item) => item.id === ref.id)
      ? index.value.feedbackUnitRefs
      : [...index.value.feedbackUnitRefs, ref];
    return this.store.writeTextAtomic(this.workspace, feedbackIndexPath, JSON.stringify({ feedbackUnitRefs: refs }, null, 2), {
      reason: "write feedback index",
      createParents: true
    });
  }

  async addProposal(ref: UpstreamProposalRef): Promise<Result<WriteReceipt>> {
    const index = await this.readProposalIndex();
    if (!index.ok) return index;
    const refs = index.value.proposalRefs.some((item) => item.id === ref.id)
      ? index.value.proposalRefs
      : [...index.value.proposalRefs, ref];
    return this.store.writeTextAtomic(this.workspace, proposalIndexPath, JSON.stringify({ proposalRefs: refs }, null, 2), {
      reason: "write proposal index",
      createParents: true
    });
  }

  async readAllInbox(): Promise<Result<readonly InboxItemRecord[]>> {
    const index = await this.readInboxIndex();
    if (!index.ok) return index;
    const records: InboxItemRecord[] = [];
    for (const ref of index.value.inboxItemRefs) {
      const record = await this.readInbox(ref);
      if (record.ok) records.push(record.value);
      else if (record.error.code !== "not_found") return record;
    }
    return ok(records);
  }

  async readAllFeedback(): Promise<Result<readonly FeedbackUnitRecord[]>> {
    const index = await this.readFeedbackIndex();
    if (!index.ok) return index;
    const records: FeedbackUnitRecord[] = [];
    for (const ref of index.value.feedbackUnitRefs) {
      const record = await this.readFeedback(ref);
      if (record.ok) records.push(record.value);
      else if (record.error.code !== "not_found") return record;
    }
    return ok(records);
  }

  async readAllProposals(): Promise<Result<readonly UpstreamProposalRecord[]>> {
    const index = await this.readProposalIndex();
    if (!index.ok) return index;
    const records: UpstreamProposalRecord[] = [];
    for (const ref of index.value.proposalRefs) {
      const record = await this.readProposal(ref);
      if (record.ok) records.push(record.value);
      else if (record.error.code !== "not_found") return record;
    }
    return ok(records);
  }

  private async readInboxIndex(): Promise<Result<InboxIndex>> {
    const read = await this.store.readText(this.workspace, inboxIndexPath, { reason: "read inbox index", maxBytes: 512 * 1024 });
    if (!read.ok) return read.error.code === "not_found" ? ok({ inboxItemRefs: [] }) : read;
    return parseJson<InboxIndex>(read.value.content, "inbox index is invalid");
  }

  private async readFeedbackIndex(): Promise<Result<FeedbackIndex>> {
    const read = await this.store.readText(this.workspace, feedbackIndexPath, { reason: "read feedback index", maxBytes: 512 * 1024 });
    if (!read.ok) return read.error.code === "not_found" ? ok({ feedbackUnitRefs: [] }) : read;
    return parseJson<FeedbackIndex>(read.value.content, "feedback index is invalid");
  }

  private async readProposalIndex(): Promise<Result<ProposalIndex>> {
    const read = await this.store.readText(this.workspace, proposalIndexPath, { reason: "read proposal index", maxBytes: 512 * 1024 });
    if (!read.ok) return read.error.code === "not_found" ? ok({ proposalRefs: [] }) : read;
    return parseJson<ProposalIndex>(read.value.content, "proposal index is invalid");
  }
}

export function parseJson<T>(content: string, message: string): Result<T> {
  try {
    return ok(JSON.parse(content) as T);
  } catch (cause) {
    return admissionErr({ code: "schema_incompatible", message, cause });
  }
}

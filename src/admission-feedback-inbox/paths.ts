import type { FeedbackUnitId } from "../domain/index.js";
import type { InboxItemId, UpstreamProposalId } from "./types.js";

const root = ".feng/admission";

export const inboxIndexPath = `${root}/inbox/index.json`;
export const inboxRecordPath = (id: InboxItemId): string => `${root}/inbox/records/${id}.json`;
export const feedbackIndexPath = `${root}/feedback/index.json`;
export const feedbackRecordPath = (id: FeedbackUnitId): string => `${root}/feedback/records/${id}.json`;
export const proposalIndexPath = `${root}/upstream-proposals/index.json`;
export const proposalRecordPath = (id: UpstreamProposalId): string => `${root}/upstream-proposals/records/${id}.json`;

import type { FeedbackUnitId } from "../domain/index.js";
import { makeRef, type FeedbackUnitRef } from "../domain/index.js";
import type { InboxItemId, InboxItemRef, UpstreamProposalId, UpstreamProposalRef } from "./types.js";

export function makeInboxItemRef(id: InboxItemId): InboxItemRef {
  return { kind: "inbox_item", id, uri: `inbox-item://${id}` };
}

export function makeFeedbackUnitRef(id: FeedbackUnitId): FeedbackUnitRef {
  return makeRef("feedback_unit", id, { uri: `feedback-unit://${id}` });
}

export function makeUpstreamProposalRef(id: UpstreamProposalId): UpstreamProposalRef {
  return { kind: "upstream_proposal", id, uri: `upstream-proposal://${id}` };
}

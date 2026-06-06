import { makeNonEmptyBrand } from "../domain/brand.js";
import type { InboxItemId, UpstreamProposalId } from "./types.js";

export const makeInboxItemId = (value: string): InboxItemId => makeNonEmptyBrand("InboxItemId", value);
export const makeUpstreamProposalId = (value: string): UpstreamProposalId =>
  makeNonEmptyBrand("UpstreamProposalId", value);

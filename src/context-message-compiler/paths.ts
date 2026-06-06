import type { ContextCompilePlanId, MessageListInvalidationId } from "./types.js";
import type { MessageListId } from "../domain/index.js";

const root = ".feng/context";

export const compilePlanIndexPath = `${root}/plans/index.json`;
export const messageListIndexPath = `${root}/message-lists/index.json`;
export const invalidationIndexPath = `${root}/message-lists/invalidations/index.json`;

export const compilePlanRecordPath = (id: ContextCompilePlanId): string => `${root}/plans/${id}.json`;
export const messageListRecordPath = (id: MessageListId): string => `${root}/message-lists/${id}.json`;
export const invalidationRecordPath = (id: MessageListInvalidationId): string =>
  `${root}/message-lists/invalidations/${id}.json`;

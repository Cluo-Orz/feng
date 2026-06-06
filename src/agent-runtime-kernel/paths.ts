import type {
  LongTermMemoryReadId,
  RuntimeFeedbackCandidateHintId,
  RuntimeInvocationId,
  RuntimeOutputId,
  RuntimeTraceId,
  RuntimeTurnId,
  ShortTermContextId
} from "./brand.js";
import type { MessageListId } from "../domain/index.js";

const root = ".feng/agent-runtime-kernel";
const enc = (value: string): string => encodeURIComponent(value).replaceAll("%", "~");

export const invocationIndexPath = `${root}/invocations/index.json`;
export const turnIndexPath = `${root}/turns/index.json`;
export const messageListIndexPath = `${root}/message-lists/index.json`;
export const shortTermContextIndexPath = `${root}/short-term-contexts/index.json`;
export const memoryReadIndexPath = `${root}/memory-reads/index.json`;
export const outputIndexPath = `${root}/outputs/index.json`;
export const traceIndexPath = `${root}/traces/index.json`;
export const feedbackHintIndexPath = `${root}/feedback-hints/index.json`;

export const invocationPath = (id: RuntimeInvocationId): string => `${root}/invocations/${enc(id)}.json`;
export const turnPath = (id: RuntimeTurnId): string => `${root}/turns/${enc(id)}.json`;
export const messageListPath = (id: MessageListId): string => `${root}/message-lists/${enc(id)}.json`;
export const shortTermContextPath = (id: ShortTermContextId): string =>
  `${root}/short-term-contexts/${enc(id)}.json`;
export const memoryReadPath = (id: LongTermMemoryReadId): string => `${root}/memory-reads/${enc(id)}.json`;
export const outputPath = (id: RuntimeOutputId): string => `${root}/outputs/${enc(id)}.json`;
export const tracePath = (id: RuntimeTraceId): string => `${root}/traces/${enc(id)}.json`;
export const feedbackHintPath = (id: RuntimeFeedbackCandidateHintId): string =>
  `${root}/feedback-hints/${enc(id)}.json`;

import { randomUUID } from "node:crypto";
import {
  makeMessageListId,
  makeRef,
  ok,
  type ArtifactRef,
  type MessageListRef,
  type RuntimeKernelType,
  type Result
} from "../domain/index.js";
import { sha256Text, stableStringify } from "../event-ledger/stable-json.js";
import type { HatchPackageRecord } from "../hatch-builder/index.js";
import type { RuntimeContractRecord } from "../runtime-contract-registry/index.js";
import type { LLMContentBlock, NormalizedLLMResponse } from "../llm-gateway/index.js";
import type { WorldOutputKind } from "../target-world-adapter/index.js";
import {
  makeLongTermMemoryReadId,
  makeRuntimeFeedbackCandidateHintId,
  makeRuntimeInvocationId,
  makeRuntimeOutputId,
  makeRuntimeTraceId,
  makeRuntimeTurnId,
  makeShortTermContextId
} from "./brand.js";
import { runtimeErr } from "./errors.js";
import {
  longTermMemoryReadRef,
  runtimeFeedbackCandidateHintRef,
  runtimeInvocationRef,
  runtimeOutputRef,
  runtimeTraceRef,
  runtimeTurnRef,
  shortTermContextRef
} from "./refs.js";
import type {
  RuntimeInvocation,
  RuntimeInvocationStatus,
  TargetActionCandidate
} from "./types.js";
import type {
  LongTermMemoryReadRef,
  RuntimeFeedbackCandidateHintRef,
  RuntimeOutputRef,
  RuntimeTraceRef,
  RuntimeTurnRef,
  ShortTermContextRef
} from "./refs.js";

export const supportedAgentKernelTypes: readonly RuntimeKernelType[] = ["standard_agent_kernel", "custom_agent_kernel"];

export const newInvocationRef = () => runtimeInvocationRef(makeRuntimeInvocationId(`runtime-invocation-${randomUUID()}`));
export const newTurnRef = (): RuntimeTurnRef => runtimeTurnRef(makeRuntimeTurnId(`runtime-turn-${randomUUID()}`));
export const newRuntimeOutputRef = (): RuntimeOutputRef => runtimeOutputRef(makeRuntimeOutputId(`runtime-output-${randomUUID()}`));
export const newRuntimeTraceRef = (): RuntimeTraceRef => runtimeTraceRef(makeRuntimeTraceId(`runtime-trace-${randomUUID()}`));
export const newFeedbackHintRef = (): RuntimeFeedbackCandidateHintRef =>
  runtimeFeedbackCandidateHintRef(makeRuntimeFeedbackCandidateHintId(`runtime-hint-${randomUUID()}`));
export const newShortTermContextRef = (): ShortTermContextRef =>
  shortTermContextRef(makeShortTermContextId(`short-context-${randomUUID()}`));
export const newLongTermMemoryReadRef = (): LongTermMemoryReadRef =>
  longTermMemoryReadRef(makeLongTermMemoryReadId(`memory-read-${randomUUID()}`));
export const newRuntimeMessageListRef = (): MessageListRef =>
  makeRef("message_list", makeMessageListId(`runtime-message-list-${randomUUID()}`));

export function ensureAgentKernelType(type: RuntimeKernelType): Result<void> {
  return supportedAgentKernelTypes.includes(type)
    ? ok(undefined)
    : runtimeErr({ code: "runtime_kernel_unsupported", message: `runtime kernel ${type} is not supported by Agent Runtime Kernel` });
}

export function ensureRunnablePackage(record: HatchPackageRecord, production: boolean): Result<void> {
  if (record.lifecycle === "failed" || record.lifecycle === "retracted" || record.lifecycle === "superseded") {
    return runtimeErr({ code: "package_unavailable", message: `hatch package is ${record.lifecycle}` });
  }
  if (production && record.lifecycle !== "published_local") {
    return runtimeErr({ code: "production_lock_violation", message: "production mode requires a locally published hatch package" });
  }
  return ok(undefined);
}

export function ensureRunnableContract(record: RuntimeContractRecord, packageRecord: HatchPackageRecord): Result<void> {
  if (record.runtimeContractRef.id !== packageRecord.runtimeContractRef.id) {
    return runtimeErr({ code: "contract_incompatible", message: "hatch package and runtime contract mismatch" });
  }
  if (record.lifecycle === "retracted" || record.lifecycle === "deprecated" || record.lifecycle === "incompatible") {
    return runtimeErr({ code: "contract_retracted", message: `runtime contract is ${record.lifecycle}` });
  }
  return ensureAgentKernelType(record.runtimeKernelType);
}

export function terminalInvocationStatus(status: RuntimeInvocationStatus): boolean {
  return ["completed", "failed", "cancelled", "interrupted"].includes(status);
}

export function mutateInvocation(
  record: RuntimeInvocation,
  patch: Partial<Omit<RuntimeInvocation, "runtimeInvocationId" | "runtimeInvocationRef">>
): RuntimeInvocation {
  return { ...record, ...patch, recordVersion: record.recordVersion + 1 };
}

export function uniqueRefs<T extends { readonly id: string }>(values: readonly T[], additions: readonly T[]): readonly T[] {
  const map = new Map(values.map((item) => [item.id, item]));
  for (const item of additions) map.set(item.id, item);
  return [...map.values()];
}

export function stableHash(value: unknown): string {
  return sha256Text(stableStringify(value));
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function textFromResponse(response: NormalizedLLMResponse): string {
  return response.contentBlocks
    .filter((block): block is Extract<LLMContentBlock, { readonly type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export function structuredFromResponse(response: NormalizedLLMResponse): unknown {
  return response.contentBlocks.find((block) => block.type === "structured_output")?.value;
}

export function parseRuntimeOutput(response: NormalizedLLMResponse, fallbackKind: WorldOutputKind): {
  readonly outputKind: WorldOutputKind;
  readonly normalizedOutput: unknown;
  readonly actions: readonly TargetActionCandidate[];
} {
  const structured = structuredFromResponse(response);
  const text = textFromResponse(response);
  const parsedText = structured === undefined ? parseJsonObject(text) : undefined;
  const value = structured ?? parsedText ?? { text };
  const record = asRecord(value);
  const outputKind = isWorldOutputKind(record?.outputKind) ? record.outputKind : fallbackKind;
  const actions = actionCandidates(record);
  return {
    outputKind,
    normalizedOutput: {
      outputKind,
      content: record?.content ?? value,
      text,
      provider: response.provider,
      model: response.model,
      finishReason: response.finishReason
    },
    actions
  };
}

export function firstOutputKind(contract: RuntimeContractRecord): WorldOutputKind {
  const modes = [
    ...(contract.shape.output?.outputModes ?? []),
    ...(contract.shape.event?.outputModes ?? [])
  ];
  return modes.find(isWorldOutputKind) ?? "structured_result";
}

export function packageResourceHashes(record: HatchPackageRecord, packageArtifactRefs: readonly ArtifactRef[]): readonly string[] {
  return [
    record.artifactRef.id,
    record.manifestRef.id,
    ...record.includedResourceRefs.map((ref) => ref.id),
    ...packageArtifactRefs.map((ref) => ref.id)
  ].sort();
}

function actionCandidates(record: Record<string, unknown> | undefined): readonly TargetActionCandidate[] {
  if (record === undefined) return [];
  const rawActions = Array.isArray(record.actions) ? record.actions : [record.action ?? record];
  return rawActions.map(asActionCandidate).filter((item): item is TargetActionCandidate => item !== undefined);
}

function asActionCandidate(value: unknown): TargetActionCandidate | undefined {
  const record = asRecord(value);
  if (record === undefined || typeof record.actionKind !== "string" || record.actionKind.trim().length === 0) return undefined;
  return {
    actionKind: record.actionKind,
    actionPayload: record.actionPayload ?? record.payload ?? {},
    resourceSummary: typeof record.resourceSummary === "string" ? record.resourceSummary : `target action ${record.actionKind}`,
    ...(Array.isArray(record.requiredCapabilities) ? { requiredCapabilities: record.requiredCapabilities.map(String) } : {})
  };
}

function parseJsonObject(text: string): unknown | undefined {
  if (!text.startsWith("{") && !text.startsWith("[")) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isWorldOutputKind(value: unknown): value is WorldOutputKind {
  return [
    "structured_result", "text_result", "action_event", "decision_event", "control_command",
    "file_artifact", "patch_candidate", "chapter_output", "music_fragment", "debug_event", "feedback_candidate"
  ].includes(String(value));
}

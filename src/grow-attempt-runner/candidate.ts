import { randomUUID } from "node:crypto";
import { ok, type Result } from "../domain/result.js";
import type { ArtifactRef } from "../domain/index.js";
import type { LLMContentBlock, NormalizedLLMResponse } from "../llm-gateway/index.js";
import { makeCandidateOutputId } from "./brand.js";
import { candidateOutputRef } from "./refs.js";
import { registerAttemptJsonArtifact } from "./artifacts.js";
import { appendAttemptEvent, attemptEventTypes, mutateAttempt, type AttemptRuntime } from "./runtime.js";
import type {
  CandidateOutputKind,
  CandidateOutputRecord,
  AttemptRecord,
  AttemptTurnRecord
} from "./types.js";

export async function registerNormalizedResponseArtifact(input: {
  readonly runtime: AttemptRuntime;
  readonly record: AttemptRecord;
  readonly turn: AttemptTurnRecord;
  readonly response: NormalizedLLMResponse;
  readonly streamEventCount: number;
}): Promise<Result<ArtifactRef>> {
  return registerAttemptJsonArtifact({
    runtime: input.runtime,
    kind: "summary",
    content: {
      turnRef: input.turn.turnRef,
      requestId: input.response.requestId,
      finishReason: input.response.finishReason,
      usage: input.response.usage,
      streamEventCount: input.streamEventCount,
      contentBlocks: input.response.contentBlocks,
      providerMetadataSummary: input.response.providerMetadataSummary
    },
    source: input.record.source,
    version: input.record.version,
    audit: input.record.audit,
    privacyClass: "contains_model_output",
    retentionClass: "attempt_scoped",
    parentRefs: input.response.receiptRef === undefined ? [] : [input.response.receiptRef],
    correlationId: input.record.correlationId
  });
}

export async function registerCandidateOutputs(input: {
  readonly runtime: AttemptRuntime;
  readonly record: AttemptRecord;
  readonly turn: AttemptTurnRecord;
  readonly response: NormalizedLLMResponse;
}): Promise<Result<{
  readonly record: AttemptRecord;
  readonly turn: AttemptTurnRecord;
  readonly candidates: readonly CandidateOutputRecord[];
}>> {
  const candidates: CandidateOutputRecord[] = [];
  const parents = input.response.receiptRef === undefined ? [] : [input.response.receiptRef];
  for (const block of input.response.contentBlocks) {
    const kind = candidateKind(block);
    if (kind === undefined) continue;
    const content = candidateContent(block);
    const artifact = await registerAttemptJsonArtifact({
      runtime: input.runtime,
      kind: "candidate_output",
      content,
      source: input.record.source,
      version: input.record.version,
      audit: input.record.audit,
      privacyClass: "contains_model_output",
      retentionClass: "attempt_scoped",
      parentRefs: parents,
      correlationId: input.record.correlationId
    });
    if (!artifact.ok) return artifact;
    const id = makeCandidateOutputId(`candidate-output-${randomUUID()}`);
    const candidate: CandidateOutputRecord = {
      candidateOutputId: id,
      candidateOutputRef: candidateOutputRef(id),
      attemptRef: input.record.attemptRef,
      growUnitRef: input.record.growUnitRef,
      sourceTurnRef: input.turn.turnRef,
      artifactRef: artifact.value,
      kind,
      summary: summarizeBlock(block),
      parentRefs: parents,
      privacyClass: "contains_model_output",
      retentionClass: "attempt_scoped",
      source: input.record.source,
      audit: input.record.audit,
      createdAt: new Date().toISOString()
    };
    const write = await input.runtime.storage.writeCandidate(candidate);
    if (!write.ok) return write;
    const event = await appendAttemptEvent({
      runtime: input.runtime,
      record: input.record,
      eventType: attemptEventTypes.candidateOutputRegistered,
      body: {
        candidateOutputRef: candidate.candidateOutputRef,
        artifactRef: candidate.artifactRef,
        kind: candidate.kind,
        summary: candidate.summary
      }
    });
    if (!event.ok) return event;
    candidates.push(candidate);
  }
  const candidateRefs = candidates.map((candidate) => candidate.candidateOutputRef);
  const nextTurn = {
    ...input.turn,
    candidateOutputRefs: [...input.turn.candidateOutputRefs, ...candidateRefs]
  };
  const nextRecord = mutateAttempt(input.record, {
    candidateOutputRefs: [...input.record.candidateOutputRefs, ...candidateRefs]
  });
  const turnWrite = await input.runtime.storage.writeTurn(nextTurn);
  if (!turnWrite.ok) return turnWrite;
  const recordWrite = await input.runtime.storage.writeAttempt(nextRecord, "link candidate output refs");
  return recordWrite.ok ? ok({ record: nextRecord, turn: nextTurn, candidates }) : recordWrite;
}

function candidateKind(block: LLMContentBlock): CandidateOutputKind | undefined {
  if (block.type === "text") return inferTextKind(block.text);
  if (block.type === "structured_output") return "structured_output";
  return undefined;
}

function inferTextKind(text: string): CandidateOutputKind {
  const lower = text.toLowerCase();
  if (lower.includes("patch") || lower.includes("diff")) return "file_patch_candidate";
  if (lower.includes("runtime contract")) return "runtime_contract_candidate";
  if (lower.includes("skill")) return "skill_candidate";
  if (lower.includes("tool")) return "tool_plan_candidate";
  if (lower.includes("validation") || lower.includes("verify")) return "validation_instruction_candidate";
  return "model_text";
}

function candidateContent(block: LLMContentBlock): unknown {
  if (block.type === "text") return { text: block.text };
  if (block.type === "structured_output") return { value: block.value };
  return block;
}

function summarizeBlock(block: LLMContentBlock): string {
  if (block.type === "text") return block.text.replace(/\s+/g, " ").slice(0, 240);
  if (block.type === "structured_output") return "structured output candidate";
  return block.type;
}

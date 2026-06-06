import { ok, type ArtifactRef, type MessageListRef, type Result } from "../domain/index.js";
import type { ProviderNeutralMessage } from "../context-message-compiler/index.js";
import type { ToolDefinition } from "../tool-runtime/index.js";
import { runtimeErr } from "./errors.js";
import {
  estimateTokens,
  newRuntimeMessageListRef,
  stableHash
} from "./logic.js";
import { appendRuntimeEvent, registerRuntimeArtifact, runtimeEventTypes, type AgentRuntime } from "./runtime.js";
import type {
  RuntimeBudgetReport,
  RuntimeExclusionList,
  RuntimeInvocation,
  RuntimeMessageListExplanation,
  RuntimeMessageListRecord,
  RuntimeMessageSection,
  RuntimeMessageSectionKind,
  RuntimeSourceMap
} from "./types.js";
import type { RuntimeInvocationRef, RuntimeTurnRef } from "./refs.js";
import type { WorldInputEnvelopeRef } from "../target-world-adapter/index.js";

export async function compileRuntimeMessageListRecord(input: {
  readonly runtime: AgentRuntime;
  readonly invocationRef: RuntimeInvocationRef;
  readonly turnRef: RuntimeTurnRef;
  readonly worldInputRef: WorldInputEnvelopeRef;
}): Promise<Result<MessageListRef>> {
  const invocation = await input.runtime.storage.readInvocation(input.invocationRef);
  if (!invocation.ok) return invocation;
  const packageRecord = await input.runtime.options.hatchBuilder.getHatchPackage(invocation.value.hatchPackageRef);
  if (!packageRecord.ok) return packageRecord;
  const contract = await input.runtime.options.runtimeContractRegistry.getRuntimeContract(invocation.value.runtimeContractRef);
  if (!contract.ok) return contract;
  const worldInput = await input.runtime.options.targetWorldAdapter.getWorldInput(input.worldInputRef);
  if (!worldInput.ok) return worldInput;
  const context = await input.runtime.storage.readShortTermContext(invocation.value.shortTermContextRef);
  if (!context.ok) return context;
  const tools = await input.runtime.options.toolRuntime.listTools({
    ...(invocation.value.toolCatalogQuery ?? {}),
    lifecycle: "active"
  });
  if (!tools.ok) return tools;
  const normalized = await input.runtime.options.artifactRegistry.materializeArtifact(
    worldInput.value.normalizedInputRef,
    { reason: "compile runtime message list from normalized world input", maxBytes: 64 * 1024, allowArchived: true }
  );
  if (!normalized.ok) return normalized;
  const normalizedSummary = normalized.value.status === "available" && typeof normalized.value.content === "string"
    ? summarize(normalized.value.content, 1800)
    : `normalized input artifact is ${normalized.value.status}`;
  return writeMessageList({
    ...input,
    invocation: invocation.value,
    packageArtifactRef: packageRecord.value.artifactRef,
    contractArtifactRef: contract.value.artifactRef,
    worldInputArtifactRef: worldInput.value.normalizedInputRef,
    normalizedSummary,
    tools: tools.value.records,
    contractSummary: contractSummary(contract.value),
    packageSummary: `${packageRecord.value.packageName}@${packageRecord.value.version.schemaVersion}`,
    shortContextSummary: context.value.summary
  });
}

export async function explainRuntimeMessageListRecord(
  runtime: AgentRuntime,
  ref: MessageListRef
): Promise<Result<RuntimeMessageListExplanation>> {
  const record = await runtime.storage.readMessageList(ref);
  if (!record.ok) return record;
  const sourceMap = await readJsonArtifact<RuntimeSourceMap>(runtime, record.value.sourceMapRef, "source map");
  if (!sourceMap.ok) return sourceMap;
  const budgetReport = await readJsonArtifact<RuntimeBudgetReport>(runtime, record.value.budgetReportRef, "budget report");
  if (!budgetReport.ok) return budgetReport;
  const exclusionList = await readJsonArtifact<RuntimeExclusionList>(runtime, record.value.exclusionListRef, "exclusion list");
  if (!exclusionList.ok) return exclusionList;
  return ok({
    runtimeMessageListRef: ref,
    summary: `${record.value.sections.length} runtime sections, ${record.value.providerNeutralMessages.length} provider messages`,
    sourceMap: sourceMap.value,
    budgetReport: budgetReport.value,
    exclusionList: exclusionList.value
  });
}

async function writeMessageList(input: {
  readonly runtime: AgentRuntime;
  readonly invocation: RuntimeInvocation;
  readonly turnRef: RuntimeTurnRef;
  readonly worldInputRef: WorldInputEnvelopeRef;
  readonly packageArtifactRef: ArtifactRef;
  readonly contractArtifactRef: ArtifactRef;
  readonly worldInputArtifactRef: ArtifactRef;
  readonly normalizedSummary: string;
  readonly tools: readonly ToolDefinition[];
  readonly contractSummary: string;
  readonly packageSummary: string;
  readonly shortContextSummary: string;
}): Promise<Result<MessageListRef>> {
  const messageListRef = newRuntimeMessageListRef();
  const sections = buildSections(input);
  const messages = providerMessages(sections);
  const sourceMap = buildSourceMap(messageListRef, input, sections);
  const budgetReport = buildBudgetReport(messageListRef, sections, input.runtime.options.defaultBudgetTokens ?? 16_000);
  const exclusionList = buildExclusionList(messageListRef, input);
  const sourceMapRef = await registerRuntimeArtifact({
    runtime: input.runtime,
    kind: "summary",
    content: sourceMap,
    privacyClass: "workspace_private",
    source: input.invocation.source,
    version: input.invocation.version,
    audit: input.invocation.audit,
    correlationId: input.invocation.correlationId
  });
  if (!sourceMapRef.ok) return sourceMapRef;
  const budgetRef = await registerRuntimeArtifact({
    runtime: input.runtime,
    kind: "summary",
    content: budgetReport,
    privacyClass: "workspace_private",
    source: input.invocation.source,
    version: input.invocation.version,
    audit: input.invocation.audit,
    correlationId: input.invocation.correlationId
  });
  if (!budgetRef.ok) return budgetRef;
  const exclusionRef = await registerRuntimeArtifact({
    runtime: input.runtime,
    kind: "summary",
    content: exclusionList,
    privacyClass: "workspace_private",
    source: input.invocation.source,
    version: input.invocation.version,
    audit: input.invocation.audit,
    correlationId: input.invocation.correlationId
  });
  if (!exclusionRef.ok) return exclusionRef;
  const artifactRef = await registerRuntimeArtifact({
    runtime: input.runtime,
    kind: "runtime_message_list",
    content: { providerNeutralMessages: messages, sections, sourceMapRef: sourceMapRef.value, budgetReportRef: budgetRef.value, exclusionListRef: exclusionRef.value },
    privacyClass: "workspace_private",
    source: input.invocation.source,
    version: input.invocation.version,
    audit: input.invocation.audit,
    parentRefs: [input.packageArtifactRef, input.contractArtifactRef, input.worldInputArtifactRef],
    correlationId: input.invocation.correlationId
  });
  if (!artifactRef.ok) return artifactRef;
  const now = new Date().toISOString();
  const record: RuntimeMessageListRecord = {
    runtimeMessageListId: messageListRef.id,
    runtimeMessageListRef: messageListRef,
    runtimeInvocationRef: input.invocation.runtimeInvocationRef,
    runtimeContractRef: input.invocation.runtimeContractRef,
    hatchPackageRef: input.invocation.hatchPackageRef,
    turnRef: input.turnRef,
    artifactRef: artifactRef.value,
    providerNeutralMessages: messages,
    sections,
    sourceMapRef: sourceMapRef.value,
    budgetReportRef: budgetRef.value,
    exclusionListRef: exclusionRef.value,
    contentHash: stableHash({ messages, sections }),
    createdAt: now,
    source: input.invocation.source,
    version: input.invocation.version,
    audit: input.invocation.audit
  };
  const written = await input.runtime.storage.writeMessageList(record, "write runtime message list");
  if (!written.ok) return written;
  const indexed = await input.runtime.storage.addMessageList(messageListRef);
  if (!indexed.ok) return indexed;
  const event = await appendRuntimeEvent({
    runtime: input.runtime,
    invocationRef: input.invocation.runtimeInvocationRef,
    eventType: runtimeEventTypes.messageListCompiled,
    body: { messageListRef, artifactRef: artifactRef.value, turnRef: input.turnRef },
    source: input.invocation.source,
    audit: input.invocation.audit,
    correlationId: input.invocation.correlationId
  });
  return event.ok ? ok(messageListRef) : event;
}

function buildSections(input: Parameters<typeof writeMessageList>[0]): readonly RuntimeMessageSection[] {
  const action = input.invocation;
  return [
    section("runtime_contract", "Runtime Contract", input.contractSummary, 100),
    section("target_world_input", "Target World Input", input.normalizedSummary, 95),
    section("current_observation", "Current Observation", `worldInput=${input.worldInputRef.id}`, 90),
    section("runtime_task", "Runtime Task", `Run hatch package ${input.packageSummary} without modifying package or contract.`, 85),
    section("allowed_actions", "Allowed Actions", actionLine(action, "allowed"), 80),
    section("forbidden_actions", "Forbidden Actions", actionLine(action, "forbidden"), 80),
    section("short_term_context", "Short-Term Context", input.shortContextSummary || "No prior turn context.", 70),
    section("long_term_memory_summary", "Long-Term Memory", `${action.longTermMemoryReadRefs.length} accepted memory read(s).`, 60),
    section("visible_tools", "Visible Tools", toolSummary(input.tools), 55),
    section("debug_policy", "Debug Policy", `mode=${action.mode}; trace is file-native and policy-gated.`, 45),
    section("output_contract", "Output Contract", "Return structured JSON when emitting target actions.", 90),
    section("failure_policy", "Failure Policy", "If uncertain, return a contract-valid diagnostic output instead of executing actions.", 75)
  ];
}

function providerMessages(sections: readonly RuntimeMessageSection[]): readonly ProviderNeutralMessage[] {
  const system = sections
    .filter((item) => item.kind !== "target_world_input" && item.kind !== "current_observation")
    .map((item) => `## ${item.title}\n${item.content}`)
    .join("\n\n");
  const user = sections
    .filter((item) => item.kind === "target_world_input" || item.kind === "current_observation")
    .map((item) => `## ${item.title}\n${item.content}`)
    .join("\n\n");
  return [
    { role: "system", content: [{ type: "text", text: system }] },
    { role: "user", content: [{ type: "text", text: user }] }
  ];
}

function buildSourceMap(
  messageListRef: MessageListRef,
  input: Parameters<typeof writeMessageList>[0],
  sections: readonly RuntimeMessageSection[]
): RuntimeSourceMap {
  return {
    messageListRef,
    entries: sections.map((item) => ({
      entryId: sourceMapEntryId(item.kind),
      messagePath: item.kind === "target_world_input" || item.kind === "current_observation" ? "messages[1]" : "messages[0]",
      section: item.kind,
      sourceType: sourceType(item.kind),
      sourceRef: sourceRef(input, item.kind),
      inclusionReason: "required by Agent Runtime Kernel runtime message list contract",
      transformation: item.kind === "target_world_input" ? "normalized target input summarized" : "structured summary",
      redacted: item.redacted,
      truncated: item.truncated
    })),
    builtAt: new Date().toISOString()
  };
}

function buildBudgetReport(
  messageListRef: MessageListRef,
  sections: readonly RuntimeMessageSection[],
  totalBudget: number
): RuntimeBudgetReport {
  const estimatedUsage = sections.reduce((sum, item) => sum + item.estimatedTokens, 0);
  return {
    messageListRef,
    budgetModel: "rough_char_tokens",
    totalBudget,
    estimatedUsage,
    sectionBudgets: sections.map((item) => ({ section: item.kind, budget: Math.ceil(totalBudget / sections.length), estimatedUsage: item.estimatedTokens })),
    overBudget: estimatedUsage > totalBudget,
    compressionApplied: false,
    truncationApplied: sections.some((item) => item.truncated),
    unavailableSources: [],
    builtAt: new Date().toISOString()
  };
}

function buildExclusionList(messageListRef: MessageListRef, input: Parameters<typeof writeMessageList>[0]): RuntimeExclusionList {
  return {
    messageListRef,
    records: [{
      sourceType: "raw_target_world_state",
      sourceRef: input.worldInputRef,
      reason: "raw_state_not_inlined",
      summary: "Raw target state is not treated as a message list; only normalized summary is included.",
      section: "target_world_input"
    }],
    builtAt: new Date().toISOString()
  };
}

async function readJsonArtifact<T>(runtime: AgentRuntime, ref: ArtifactRef, label: string): Promise<Result<T>> {
  const materialized = await runtime.options.artifactRegistry.materializeArtifact(ref, {
    reason: `read runtime ${label}`,
    allowArchived: true,
    maxBytes: 1024 * 1024
  });
  if (!materialized.ok) return materialized;
  if (materialized.value.status !== "available" || typeof materialized.value.content !== "string") {
    return runtimeErr({ code: "artifact_unavailable", message: `runtime ${label} is ${materialized.value.status}` });
  }
  try {
    return ok(JSON.parse(materialized.value.content) as T);
  } catch (cause) {
    return runtimeErr({ code: "schema_incompatible", message: `runtime ${label} artifact is invalid`, cause });
  }
}

function section(kind: RuntimeMessageSectionKind, title: string, raw: string, priority: number): RuntimeMessageSection {
  const content = summarize(raw, 2400);
  return {
    sectionId: `runtime-section-${kind}`,
    kind,
    title,
    content,
    priority,
    sourceMapEntryIds: [sourceMapEntryId(kind)],
    estimatedTokens: estimateTokens(content),
    truncated: content.length < raw.length,
    redacted: false
  };
}

function sourceMapEntryId(kind: RuntimeMessageSectionKind): string {
  return `runtime-source-${kind}`;
}

function summarize(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n[truncated]`;
}

function contractSummary(record: import("../runtime-contract-registry/index.js").RuntimeContractRecord): string {
  return [
    `kernel=${record.runtimeKernelType}`,
    `input=${record.shape.input?.inputModes.join(",") || "none"}`,
    `output=${record.shape.output?.outputModes.join(",") || "none"}`,
    `actions=${record.shape.actionBoundary?.allowedActionKinds.join(",") || "none"}`
  ].join("\n");
}

function actionLine(invocation: RuntimeInvocation, kind: "allowed" | "forbidden"): string {
  return `${kind} actions are defined by runtime contract ${invocation.runtimeContractRef.id}; target actions still require adapter and policy.`;
}

function toolSummary(tools: readonly ToolDefinition[]): string {
  if (tools.length === 0) return "No active tools visible.";
  return tools.map((tool) => `${tool.namespace}.${tool.name}: ${tool.description}`).join("\n");
}

function sourceType(kind: RuntimeMessageSectionKind): string {
  if (kind === "target_world_input" || kind === "current_observation") return "world_input_envelope";
  if (kind === "runtime_contract" || kind === "allowed_actions" || kind === "forbidden_actions") return "runtime_contract";
  if (kind === "runtime_task") return "hatch_package";
  if (kind === "visible_tools") return "tool_surface";
  return "runtime_state";
}

function sourceRef(input: Parameters<typeof writeMessageList>[0], kind: RuntimeMessageSectionKind): unknown {
  if (kind === "target_world_input" || kind === "current_observation") return input.worldInputRef;
  if (kind === "runtime_contract" || kind === "allowed_actions" || kind === "forbidden_actions") return input.invocation.runtimeContractRef;
  if (kind === "runtime_task") return input.invocation.hatchPackageRef;
  return undefined;
}

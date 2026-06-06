import { randomUUID } from "node:crypto";
import { makeMessageListId, makeRef, type ArtifactRef, type MessageListRef } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import { sha256Text, stableStringify } from "../event-ledger/stable-json.js";
import { contextEventTypes } from "./events.js";
import { buildCompilePlanRecord } from "./plan-flow.js";
import { appendContextBatch, appendContextEvent, type ContextRuntime } from "./runtime.js";
import { SectionComposer, markTruncatedEntries } from "./section-builder.js";
import { fitSectionsToBudget } from "./budget.js";
import { registerJsonArtifact, registerReports, warningsFor } from "./artifact-writer.js";
import { appendCompileEvents } from "./compile-events.js";
import {
  addAdmissionSections,
  addArtifactSection,
  addSkillSection,
  addTargetWorldSection,
  agendaParts,
  attemptParts,
  coreInvariantParts,
  exclusionParts,
  growGoalParts,
  outputParts,
  policyParts,
  toolParts
} from "./section-parts.js";
import type {
  BudgetReport,
  CompileReport,
  CompiledMessageListRecord,
  ContextCompileInput,
  ContextSection,
  ExclusionList,
  ExclusionRecord,
  MessageListInvalidationReceipt,
  ProviderNeutralMessage,
  RecompileMessageListInput,
  SourceMap,
  SourceMapEntry
} from "./types.js";
import { makeMessageListInvalidationId } from "./brand.js";
import type { MessageListInvalidationRecord } from "./types.js";

export async function compileMessageListRecord(
  runtime: ContextRuntime,
  input: ContextCompileInput
): Promise<Result<MessageListRef>> {
  const plan = await buildCompilePlanRecord(runtime, input);
  if (!plan.ok) return plan;
  const messageListRef = newMessageListRef();
  const gathered = await gatherSections(runtime, input, plan.value.attemptIntentRef, messageListRef);
  if (!gathered.ok) return gathered;
  const fitted = fitSectionsToBudget({
    messageListRef,
    sections: gathered.value.sections,
    budget: plan.value.budget,
    exclusions: gathered.value.exclusions,
    unavailableSources: gathered.value.unavailableSources,
    builtAt: new Date().toISOString()
  });
  const sourceMap: SourceMap = {
    messageListRef,
    entries: markTruncatedEntries(gathered.value.entries, fitted.sections),
    builtAt: new Date().toISOString()
  };
  const exclusionList: ExclusionList = {
    messageListRef,
    records: fitted.exclusions,
    builtAt: new Date().toISOString()
  };
  const messages = messagesFromSections(fitted.sections);
  const parentRefs = uniqueArtifactRefs([...gathered.value.sourceArtifactRefs, ...gathered.value.excludedArtifactRefs]);
  const reports = await registerReports(runtime, input, messageListRef, sourceMap, fitted.report, exclusionList, parentRefs);
  if (!reports.ok) return reports;
  const messageArtifact = await registerJsonArtifact(runtime, {
    kind: "compiled_message_list",
    content: {
      messageListRef,
      providerNeutralMessages: messages,
      sections: fitted.sections,
      sourceMapRef: reports.value.sourceMapRef,
      budgetReportRef: reports.value.budgetReportRef,
      exclusionListRef: reports.value.exclusionListRef
    },
    parentRefs,
    input
  });
  if (!messageArtifact.ok) return messageArtifact;
  const compileReport: CompileReport = {
    messageListRef,
    compilePlanRef: plan.value.compilePlanRef,
    growUnitRef: input.growUnitRef,
    ...(plan.value.attemptIntentRef === undefined ? {} : { attemptIntentRef: plan.value.attemptIntentRef }),
    artifactRef: messageArtifact.value,
    sourceMapRef: reports.value.sourceMapRef,
    budgetReportRef: reports.value.budgetReportRef,
    exclusionListRef: reports.value.exclusionListRef,
    sectionCount: fitted.sections.length,
    warnings: warningsFor(fitted.report, exclusionList),
    createdAt: new Date().toISOString()
  };
  const compileReportRef = await registerJsonArtifact(runtime, {
    kind: "summary",
    content: compileReport,
    parentRefs: [messageArtifact.value, reports.value.sourceMapRef, reports.value.budgetReportRef, reports.value.exclusionListRef],
    input
  });
  if (!compileReportRef.ok) return compileReportRef;
  const record: CompiledMessageListRecord = {
    messageListId: messageListRef.id,
    messageListRef,
    growUnitRef: input.growUnitRef,
    ...(plan.value.attemptIntentRef === undefined ? {} : { attemptIntentRef: plan.value.attemptIntentRef }),
    compilePlanRef: plan.value.compilePlanRef,
    artifactRef: messageArtifact.value,
    providerNeutralMessages: messages,
    sections: fitted.sections,
    sourceMapRef: reports.value.sourceMapRef,
    budgetReportRef: reports.value.budgetReportRef,
    exclusionListRef: reports.value.exclusionListRef,
    compileReportRef: compileReportRef.value,
    contentHash: sha256Text(stableStringify(messages)),
    createdAt: new Date().toISOString(),
    source: input.source,
    version: input.version,
    audit: input.audit
  };
  const written = await runtime.storage.writeMessageList(record, input.compileReason);
  if (!written.ok) return written;
  const indexed = await runtime.storage.addMessageList(messageListRef);
  if (!indexed.ok) return indexed;
  const events = await appendCompileEvents(runtime, input, record, fitted.report, exclusionList);
  if (!events.ok) return events;
  const linked = await runtime.options.growUnitManager.linkMessageList(input.growUnitRef, {
    compiledBy: "context-message-compiler",
    messageList: {
      messageListRef,
      sourceRefs: gathered.value.sourceArtifactRefs,
      excludedRefs: gathered.value.excludedArtifactRefs,
      budgetSummary: `${fitted.report.estimatedUsage}/${fitted.report.totalBudget} rough tokens`
    },
    reason: input.compileReason,
    source: input.source,
    audit: input.audit,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId })
  });
  return linked.ok ? ok(messageListRef) : linked;
}

export async function recompileMessageListRecord(
  runtime: ContextRuntime,
  previousMessageListRef: MessageListRef,
  input: RecompileMessageListInput
): Promise<Result<MessageListRef>> {
  const previous = await runtime.storage.readMessageList(previousMessageListRef);
  if (!previous.ok) return previous;
  const next = await compileMessageListRecord(runtime, {
    growUnitRef: previous.value.growUnitRef,
    ...(previous.value.attemptIntentRef === undefined ? {} : { attemptIntentRef: previous.value.attemptIntentRef }),
    compileReason: input.reason,
    source: input.source,
    version: input.version,
    audit: input.audit,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    ...(input.budget === undefined ? {} : { budget: input.budget }),
    ...(input.skillBodyMode === undefined ? {} : { skillBodyMode: input.skillBodyMode })
  });
  if (!next.ok) return next;
  const event = await appendContextEvent({
    runtime,
    growUnitRef: previous.value.growUnitRef,
    eventType: contextEventTypes.messageListRecompiled,
    body: { previousMessageListRef, nextMessageListRef: next.value, reason: input.reason },
    source: input.source,
    audit: input.audit,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId })
  });
  return event.ok ? ok(next.value) : event;
}

export async function invalidateMessageListRecord(
  runtime: ContextRuntime,
  messageListRef: MessageListRef,
  input: RecompileMessageListInput & { readonly replacementRef?: MessageListRef }
): Promise<Result<MessageListInvalidationReceipt>> {
  const existing = await runtime.storage.readMessageList(messageListRef);
  if (!existing.ok) return existing;
  const id = makeMessageListInvalidationId(`message-list-invalidation-${randomUUID()}`);
  const record: MessageListInvalidationRecord = {
    invalidationId: id,
    messageListRef,
    reason: input.reason,
    ...(input.replacementRef === undefined ? {} : { replacementRef: input.replacementRef }),
    source: input.source,
    audit: input.audit,
    createdAt: new Date().toISOString()
  };
  const write = await runtime.storage.writeInvalidation(record, input.reason);
  if (!write.ok) return write;
  const index = await runtime.storage.addInvalidation(id);
  if (!index.ok) return index;
  const event = await appendContextEvent({
    runtime,
    growUnitRef: existing.value.growUnitRef,
    eventType: contextEventTypes.messageListInvalidated,
    body: { messageListRef, reason: input.reason, replacementRef: input.replacementRef },
    source: input.source,
    audit: input.audit,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId })
  });
  return event.ok
    ? ok({ messageListRef, invalidationId: id, eventReceipt: event.value, recordWriteReceipt: write.value })
    : event;
}

interface GatheredSections {
  readonly sections: readonly ContextSection[];
  readonly entries: readonly SourceMapEntry[];
  readonly exclusions: readonly ExclusionRecord[];
  readonly unavailableSources: readonly string[];
  readonly sourceArtifactRefs: readonly ArtifactRef[];
  readonly excludedArtifactRefs: readonly ArtifactRef[];
}

async function gatherSections(
  runtime: ContextRuntime,
  input: ContextCompileInput,
  attemptIntentRef: ContextCompileInput["attemptIntentRef"] | undefined,
  messageListRef: MessageListRef
): Promise<Result<GatheredSections>> {
  const grow = await runtime.options.growUnitManager.buildGrowUnitSnapshot(input.growUnitRef, {
    includeActiveSkills: true,
    reason: input.compileReason
  });
  if (!grow.ok) return grow;
  const agenda = await runtime.options.agendaDoDManager.buildAgendaSummary(input.growUnitRef);
  if (!agenda.ok) return agenda;
  const admission = await runtime.options.admissionInbox.buildAdmissionSummary(input.growUnitRef);
  if (!admission.ok) return admission;
  const intent = attemptIntentRef === undefined
    ? undefined
    : await runtime.options.agendaDoDManager.explainAttemptIntent(attemptIntentRef);
  if (intent !== undefined && !intent.ok) return intent;
  const openGaps = await runtime.options.agendaDoDManager.listOpenGaps(input.growUnitRef);
  if (!openGaps.ok) return openGaps;
  const activeDoD = await runtime.options.agendaDoDManager.listActiveDoD(input.growUnitRef);
  if (!activeDoD.ok) return activeDoD;
  const state = { exclusions: [] as ExclusionRecord[], unavailable: [] as string[], sourceRefs: [] as ArtifactRef[], excludedRefs: [] as ArtifactRef[] };
  const composer = new SectionComposer();
  composer.addSection({ kind: "core_invariants", title: "Core Invariants", priority: 100, parts: coreInvariantParts() });
  composer.addSection({ kind: "grow_goal", title: "Grow Goal", priority: 95, parts: growGoalParts(grow.value) });
  await addTargetWorldSection(runtime, composer, input, grow.value.record.targetWorldSummaryRef, state);
  composer.addSection({ kind: "agenda_and_dod", title: "Agenda and DoD", priority: 90, parts: agendaParts(agenda.value, openGaps.value.records, activeDoD.value) });
  await addAdmissionSections(runtime, composer, input, intent?.value.inputCandidateRefs ?? [], admission.value.latestInboxRefs, admission.value.latestFeedbackRefs, state);
  await addArtifactSection(runtime, composer, input, uniqueArtifactRefs([...(input.artifactCandidateRefs ?? []), ...(intent?.value.requiredContextRefs ?? [])]), state);
  await addSkillSection(runtime, composer, input, grow.value.activeSkillSummaries, intent?.value.visibleSkillScopeSummary ?? [], state);
  composer.addSection({ kind: "visible_tools", title: "Visible Tools", priority: 55, parts: toolParts(input.toolSurfaceSummary ?? [], state.exclusions) });
  composer.addSection({ kind: "policy_boundaries", title: "Policy Boundaries", priority: 75, parts: policyParts(intent?.value.policyBoundarySummary, input.toolSurfaceSummary ?? []) });
  composer.addSection({ kind: "attempt_intent", title: "Attempt Intent", priority: 95, parts: attemptParts(intent?.value, attemptIntentRef) });
  composer.addSection({ kind: "output_expectation", title: "Output Expectation", priority: 80, parts: outputParts(intent?.value, activeDoD.value) });
  composer.addSection({ kind: "excluded_or_unavailable_summary", title: "Excluded or Unavailable", priority: 40, parts: exclusionParts(state.exclusions, messageListRef) });
  const built = composer.build();
  return ok({
    sections: built.sections,
    entries: built.entries,
    exclusions: state.exclusions,
    unavailableSources: state.unavailable,
    sourceArtifactRefs: uniqueArtifactRefs(state.sourceRefs),
    excludedArtifactRefs: uniqueArtifactRefs(state.excludedRefs)
  });
}

function newMessageListRef(): MessageListRef {
  const id = makeMessageListId(`message-list-${randomUUID()}`);
  return makeRef("message_list", id, { uri: `message-list://${id}` });
}

function messagesFromSections(sections: readonly ContextSection[]): readonly ProviderNeutralMessage[] {
  return [
    {
      role: "system",
      name: "feng_context_compiler",
      content: [{ type: "text", text: renderSections(sections) }],
      metadata: { schema: "provider-neutral-message-list/v1" }
    }
  ];
}

function renderSections(sections: readonly ContextSection[]): string {
  return sections
    .map((section) => `## ${section.title}\n${section.content}`)
    .join("\n\n");
}

function uniqueArtifactRefs(refs: readonly ArtifactRef[]): readonly ArtifactRef[] {
  const byId = new Map<string, ArtifactRef>();
  for (const ref of refs) byId.set(ref.id, ref);
  return [...byId.values()];
}

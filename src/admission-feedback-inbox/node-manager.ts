import type { FeedbackUnitRef, GrowUnitRef, PolicyDecisionId } from "../domain/index.js";
import type { FileNativeStore } from "../file-store/index.js";
import { createAdmissionRuntime, type AdmissionRuntime } from "./runtime.js";
import { receiveInboxItem, normalizeInbox, classifyInbox, decideInboxAdmission, listPendingInboxItems } from "./inbox-flow.js";
import {
  createFeedbackUnitRecord,
  linkFeedbackEvidenceRefs,
  listFeedbackUnits,
  redactFeedbackUnit,
  transitionFeedbackUnit
} from "./feedback-flow.js";
import { createUpstreamProposalRecord, recordUpstreamProposalResult } from "./upstream-flow.js";
import { buildAdmissionSummaryRecord, explainAdmissionRef } from "./summary-flow.js";
import type {
  AdmissionFeedbackInbox,
  AdmissionFeedbackInboxOptions,
  AdmissionDecisionInput,
  ClassifyInboxContext,
  CreateFeedbackInput,
  CreateUpstreamProposalInput,
  FeedbackQuery,
  FeedbackTransitionInput,
  InboxItemRef,
  InboxQuery,
  ReceivePayloadInput,
  UpstreamProposalRef,
  UpstreamResultInput
} from "./types.js";

export function createAdmissionFeedbackInbox(
  store: FileNativeStore,
  options: AdmissionFeedbackInboxOptions
): AdmissionFeedbackInbox {
  return new NodeAdmissionFeedbackInbox(createAdmissionRuntime(store, options));
}

class NodeAdmissionFeedbackInbox implements AdmissionFeedbackInbox {
  constructor(private readonly runtime: AdmissionRuntime) {}

  receiveUserInput(growUnitRef: GrowUnitRef, input: ReceivePayloadInput) {
    return receiveInboxItem(this.runtime, growUnitRef, "user_input", input);
  }

  receiveMaterial(growUnitRef: GrowUnitRef, input: ReceivePayloadInput) {
    return receiveInboxItem(this.runtime, growUnitRef, "file_material", input);
  }

  receiveRuntimeReport(growUnitRef: GrowUnitRef, input: ReceivePayloadInput) {
    return receiveInboxItem(this.runtime, growUnitRef, "runtime_report", input);
  }

  receiveExternalEvent(growUnitRef: GrowUnitRef, input: ReceivePayloadInput) {
    return receiveInboxItem(this.runtime, growUnitRef, "external_event", input);
  }

  normalizeInboxItem(inboxItemRef: InboxItemRef) {
    return normalizeInbox(this.runtime, inboxItemRef);
  }

  classifyInboxItem(inboxItemRef: InboxItemRef, context?: ClassifyInboxContext) {
    return classifyInbox(this.runtime, inboxItemRef, context);
  }

  decideAdmission(inboxItemRef: InboxItemRef, input: AdmissionDecisionInput) {
    return decideInboxAdmission(this.runtime, inboxItemRef, input);
  }

  listPendingInbox(growUnitRef: GrowUnitRef, query?: InboxQuery) {
    return listPendingInboxItems(this.runtime, growUnitRef, query);
  }

  createFeedbackUnit(input: CreateFeedbackInput) {
    return createFeedbackUnitRecord(this.runtime, input);
  }

  transitionFeedback(feedbackUnitRef: FeedbackUnitRef, input: FeedbackTransitionInput) {
    return transitionFeedbackUnit(this.runtime, feedbackUnitRef, input);
  }

  linkFeedbackEvidence(feedbackUnitRef: FeedbackUnitRef, evidenceRefs: Parameters<AdmissionFeedbackInbox["linkFeedbackEvidence"]>[1], reason: string) {
    return linkFeedbackEvidenceRefs(this.runtime, feedbackUnitRef, evidenceRefs, reason);
  }

  redactFeedback(feedbackUnitRef: FeedbackUnitRef, policyDecisionId: PolicyDecisionId) {
    return redactFeedbackUnit(this.runtime, feedbackUnitRef, policyDecisionId);
  }

  listFeedback(growUnitRef: GrowUnitRef, query?: FeedbackQuery) {
    return listFeedbackUnits(this.runtime, growUnitRef, query);
  }

  createUpstreamProposal(input: CreateUpstreamProposalInput) {
    return createUpstreamProposalRecord(this.runtime, input);
  }

  recordUpstreamResult(proposalRef: UpstreamProposalRef, input: UpstreamResultInput) {
    return recordUpstreamProposalResult(this.runtime, proposalRef, input);
  }

  buildAdmissionSummary(growUnitRef: GrowUnitRef) {
    return buildAdmissionSummaryRecord(this.runtime, growUnitRef);
  }

  explainAdmissionDecision(ref: Parameters<AdmissionFeedbackInbox["explainAdmissionDecision"]>[0]) {
    return explainAdmissionRef(this.runtime, ref);
  }
}

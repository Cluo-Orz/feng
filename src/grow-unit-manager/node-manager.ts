import type { PolicyDecision } from "../policy-boundary/index.js";
import { ok, type Result } from "../domain/result.js";
import type { AppendEventInput, EventAppendReceipt } from "../event-ledger/index.js";
import type { FileNativeStore, WorkspaceHandle } from "../file-store/index.js";
import { growUnitEventTypes, growUnitStream } from "./events.js";
import { growUnitErr } from "./errors.js";
import { assertTransition, lifecycleFromReadiness, phaseForLifecycle } from "./lifecycle.js";
import { checkExpectedVersion, checkRequestedFrom, createRecord, transitionRecord } from "./logic.js";
import { payload, refsPayload } from "./payloads.js";
import { evaluateArchivePolicy, transitionReceipt } from "./policy.js";
import { GrowUnitQueries } from "./queries.js";
import { GrowUnitStorage } from "./storage.js";
import type {
  ApplyReadinessVerdictInput,
  CreateGrowUnitInput,
  GrowUnitCoordinationReceipt,
  GrowUnitListQuery,
  GrowUnitManager,
  GrowUnitManagerOptions,
  GrowUnitPhase,
  GrowUnitRecord,
  GrowUnitReasonInput,
  GrowUnitTransitionInput,
  GrowUnitTransitionReceipt,
  LinkAdmissionInput,
  LinkAgendaInput,
  LinkAttemptInput,
  LinkHatchPackageInput,
  LinkMessageListInput,
  LinkTargetWorldInput,
  SupersedeGrowUnitInput,
  UpdateGoalBoundaryInput
} from "./types.js";

export function createGrowUnitManager(store: FileNativeStore, options: GrowUnitManagerOptions): GrowUnitManager {
  return new NodeGrowUnitManager(store, options);
}

class NodeGrowUnitManager implements GrowUnitManager {
  private readonly storage: GrowUnitStorage;
  private readonly queries: GrowUnitQueries;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly store: FileNativeStore,
    private readonly options: GrowUnitManagerOptions
  ) {
    this.storage = new GrowUnitStorage(store, options.workspace);
    this.queries = new GrowUnitQueries(this.storage, options);
  }

  async createGrowUnit(input: CreateGrowUnitInput) {
    const record = createRecord(input, this.options.workspace.id);
    if (!record.ok) return record;
    const event = await this.options.ledger.appendEvent(growUnitStream(record.value.growUnitRef), {
      eventType: growUnitEventTypes.created,
      eventVersion: "1",
      payload: payload({ record: record.value }),
      source: input.source,
      audit: input.audit,
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      producer: this.options.producer
    });
    if (!event.ok) return event;
    const write = await this.storage.writeRecord(record.value, "write created grow unit");
    if (!write.ok) return write;
    const indexed = await this.storage.addToIndex(record.value.growUnitRef);
    return indexed.ok ? ok(record.value.growUnitRef) : indexed;
  }

  async openGrowUnit(workspace: WorkspaceHandle) {
    return this.queries.openGrowUnit(workspace);
  }

  async getGrowUnit(growUnitRef: GrowUnitRecord["growUnitRef"]) {
    return this.queries.getGrowUnit(growUnitRef);
  }

  async transitionGrowUnit(growUnitRef: GrowUnitRecord["growUnitRef"], input: GrowUnitTransitionInput) {
    return this.withMutation(growUnitRef, async () => {
      const record = await this.getGrowUnit(growUnitRef);
      if (!record.ok) return record;
      const expected = checkExpectedVersion(record.value, input.expectedRecordVersion);
      if (!expected.ok) return expected;
      const from = checkRequestedFrom(record.value, input);
      if (!from.ok) return from;
      return this.writeTransition(record.value, input.to, input, growUnitEventTypes.lifecycleChanged);
    });
  }

  async archiveGrowUnit(growUnitRef: GrowUnitRecord["growUnitRef"], input: GrowUnitReasonInput) {
    return this.withMutation(growUnitRef, async () => {
      const record = await this.getGrowUnit(growUnitRef);
      if (!record.ok) return record;
      const policy = await evaluateArchivePolicy(this.options, record.value, input);
      if (!policy.ok) return policy;
      return this.writeTransition(record.value, "archived", input, growUnitEventTypes.archived, {
        allowBlocked: true,
        policyDecision: policy.value
      });
    });
  }

  async blockGrowUnit(growUnitRef: GrowUnitRecord["growUnitRef"], input: GrowUnitReasonInput) {
    return this.withMutation(growUnitRef, async () => {
      const record = await this.getGrowUnit(growUnitRef);
      if (!record.ok) return record;
      if (record.value.lifecycle === "blocked") {
        return growUnitErr({ code: "lifecycle_conflict", message: "grow unit is already blocked" });
      }
      return this.writeTransition(record.value, "blocked", input, growUnitEventTypes.blocked, { allowBlocked: true });
    });
  }

  async unblockGrowUnit(growUnitRef: GrowUnitRecord["growUnitRef"], input: GrowUnitReasonInput & { readonly to?: GrowUnitRecord["lifecycle"] }) {
    return this.withMutation(growUnitRef, async () => {
      const record = await this.getGrowUnit(growUnitRef);
      if (!record.ok) return record;
      if (record.value.lifecycle !== "blocked") {
        return growUnitErr({ code: "invalid_state", message: "only blocked grow unit can be unblocked" });
      }
      return this.writeTransition(record.value, input.to ?? "waiting_input", input, growUnitEventTypes.unblocked, { allowBlocked: true });
    });
  }

  async updateGoalBoundary(growUnitRef: GrowUnitRecord["growUnitRef"], input: UpdateGoalBoundaryInput) {
    if (input.goalBoundarySummary.trim().length === 0) {
      return growUnitErr({ code: "invalid_input", message: "goal boundary summary is required" });
    }
    return this.writeCoordination(growUnitRef, input, growUnitEventTypes.goalBoundaryUpdated, {
      goalBoundarySummary: input.goalBoundarySummary,
      ...(input.targetBehaviorSummary === undefined ? {} : { targetBehaviorSummary: input.targetBehaviorSummary })
    }, (record, now) => ({
      ...record,
      goalBoundarySummary: input.goalBoundarySummary,
      targetBehaviorSummary: input.targetBehaviorSummary ?? record.targetBehaviorSummary,
      updatedAt: now
    }));
  }

  async linkTargetWorld(growUnitRef: GrowUnitRecord["growUnitRef"], input: LinkTargetWorldInput) {
    return this.writeCoordination(growUnitRef, input, growUnitEventTypes.targetWorldLinked, {
      targetWorldSummaryRef: input.targetWorldSummaryRef,
      ...(input.targetBehaviorSummary === undefined ? {} : { targetBehaviorSummary: input.targetBehaviorSummary })
    }, (record, now) => ({
      ...record,
      targetWorldSummaryRef: input.targetWorldSummaryRef,
      targetBehaviorSummary: input.targetBehaviorSummary ?? record.targetBehaviorSummary,
      updatedAt: now
    }));
  }

  async linkAdmissionState(growUnitRef: GrowUnitRecord["growUnitRef"], input: LinkAdmissionInput) {
    return this.writeCoordination(growUnitRef, input, growUnitEventTypes.admissionStateLinked, {
      admissionInboxRef: input.admission.admissionInboxRef,
      admission: input.admission
    }, (record, now) => ({ ...record, admissionInboxRef: input.admission.admissionInboxRef, updatedAt: now }), input.recommendedLifecycle);
  }

  async linkAgendaState(growUnitRef: GrowUnitRecord["growUnitRef"], input: LinkAgendaInput) {
    return this.writeCoordination(growUnitRef, input, growUnitEventTypes.agendaStateLinked, {
      agendaRef: input.agenda.agendaRef,
      agenda: input.agenda
    }, (record, now) => ({ ...record, agendaRef: input.agenda.agendaRef, updatedAt: now }), input.recommendedLifecycle);
  }

  async linkAttempt(growUnitRef: GrowUnitRecord["growUnitRef"], input: LinkAttemptInput) {
    return this.writeCoordination(growUnitRef, input, growUnitEventTypes.attemptLinked, {
      attemptRef: input.attempt.attemptRef,
      attempt: input.attempt
    }, (record, now) => ({ ...record, activeAttemptRef: input.attempt.attemptRef, updatedAt: now }), undefined, true);
  }

  async linkMessageList(growUnitRef: GrowUnitRecord["growUnitRef"], input: LinkMessageListInput) {
    if (input.compiledBy !== "context-message-compiler") {
      return growUnitErr({ code: "invalid_input", message: "message list must be compiled by Context & Message Compiler" });
    }
    return this.writeCoordination(growUnitRef, input, growUnitEventTypes.messageListLinked, {
      messageListRef: input.messageList.messageListRef,
      messageList: input.messageList,
      compiledBy: input.compiledBy
    }, (record, now) => ({ ...record, latestMessageListRef: input.messageList.messageListRef, updatedAt: now }));
  }

  async applyReadinessVerdict(growUnitRef: GrowUnitRecord["growUnitRef"], input: ApplyReadinessVerdictInput) {
    return this.withMutation(growUnitRef, async () => {
      const artifact = await this.options.artifactRegistry.resolveArtifact(input.readinessVerdictRef);
      if (!artifact.ok) return artifact.error.code === "not_found"
        ? growUnitErr({ code: "artifact_unavailable", message: "readiness verdict artifact is missing" })
        : artifact;
      const record = await this.getGrowUnit(growUnitRef);
      if (!record.ok) return record;
      const expected = checkExpectedVersion(record.value, input.expectedRecordVersion);
      if (!expected.ok) return expected;
      if (record.value.lifecycle === "archived") return growUnitErr({ code: "grow_unit_archived", message: "archived grow unit cannot mutate" });
      const to = lifecycleFromReadiness(input.verdict.verdict);
      const base = {
        ...record.value,
        latestReadinessVerdictRef: input.readinessVerdictRef,
        ...(input.validationReportRef === undefined ? {} : { latestValidationReportRef: input.validationReportRef })
      };
      const transition = to === record.value.lifecycle ? undefined : assertTransition(base, to, { allowBlocked: to === "blocked", requireReadiness: to === "ready_to_hatch" });
      if (transition !== undefined && !transition.ok) return transition;
      return this.writeReadiness(base, to, input);
    });
  }

  async linkHatchPackage(growUnitRef: GrowUnitRecord["growUnitRef"], input: LinkHatchPackageInput) {
    return this.withMutation(growUnitRef, async () => {
      const record = await this.getGrowUnit(growUnitRef);
      if (!record.ok) return record;
      if (record.value.lifecycle !== "ready_to_hatch" && record.value.lifecycle !== "hatched") {
        return growUnitErr({ code: "readiness_failed", message: "hatch package can only link after ready_to_hatch" });
      }
      const patched = { ...record.value, latestHatchPackageRef: input.hatchPackageRef };
      return this.writeHatchPackage(patched, input);
    });
  }

  async supersedeGrowUnit(growUnitRef: GrowUnitRecord["growUnitRef"], input: SupersedeGrowUnitInput) {
    return this.writeCoordination(growUnitRef, input, growUnitEventTypes.superseded, {
      supersededBy: input.supersededBy,
      replacementReason: input.replacementReason
    }, (record, now) => ({ ...record, updatedAt: now }));
  }

  async buildGrowUnitSnapshot(growUnitRef: GrowUnitRecord["growUnitRef"], options: { readonly includeActiveSkills?: boolean; readonly reason: string }) {
    return this.queries.buildGrowUnitSnapshot(growUnitRef, options);
  }

  async explainGrowUnitState(growUnitRef: GrowUnitRecord["growUnitRef"]) {
    return this.queries.explainGrowUnitState(growUnitRef);
  }

  async listGrowUnits(query: GrowUnitListQuery = {}) {
    return this.queries.listGrowUnits(query);
  }

  private async writeTransition(
    record: GrowUnitRecord,
    to: GrowUnitRecord["lifecycle"],
    input: GrowUnitReasonInput,
    eventType: string,
    options: { readonly allowBlocked?: boolean; readonly policyDecision?: PolicyDecision } = {}
  ): Promise<Result<GrowUnitTransitionReceipt>> {
    const expected = checkExpectedVersion(record, input.expectedRecordVersion);
    if (!expected.ok) return expected;
    const valid = assertTransition(record, to, {
      ...(options.allowBlocked === undefined ? {} : { allowBlocked: options.allowBlocked }),
      requireReadiness: to === "ready_to_hatch",
      requireHatch: to === "hatched"
    });
    if (!valid.ok) return valid;
    const now = new Date().toISOString();
    const requestedPhase = (input as { readonly currentPhase?: GrowUnitPhase }).currentPhase;
    const currentPhase = requestedPhase ?? phaseForLifecycle(to);
    const event = await this.appendOne(record, input, eventType, { from: record.lifecycle, to, reason: input.reason, currentPhase });
    if (!event.ok) return event;
    const updated = transitionRecord(record, to, now, 1, currentPhase);
    const write = await this.storage.writeRecord(updated, input.reason);
    if (!write.ok) return write;
    return ok(transitionReceipt(record, updated, input.reason, event.value, write.value, options.policyDecision));
  }

  private async writeCoordination(
    growUnitRef: GrowUnitRecord["growUnitRef"],
    input: GrowUnitReasonInput,
    eventType: string,
    data: Record<string, unknown>,
    patch: (record: GrowUnitRecord, now: string) => GrowUnitRecord,
    recommendedLifecycle?: GrowUnitRecord["lifecycle"],
    rejectBlocked = false
  ): Promise<Result<GrowUnitCoordinationReceipt>> {
    return this.withMutation(growUnitRef, async () => {
      const record = await this.getGrowUnit(growUnitRef);
      if (!record.ok) return record;
      if (record.value.lifecycle === "archived") return growUnitErr({ code: "grow_unit_archived", message: "archived grow unit cannot mutate" });
      if (rejectBlocked && record.value.lifecycle === "blocked") return growUnitErr({ code: "grow_unit_blocked", message: "blocked grow unit cannot start attempt" });
      const expected = checkExpectedVersion(record.value, input.expectedRecordVersion);
      if (!expected.ok) return expected;
      let updated = patch(record.value, new Date().toISOString());
      const events: AppendEventInput[] = [this.eventInput(input, eventType, refsPayload({ ...data, reason: input.reason }))];
      if (recommendedLifecycle !== undefined && recommendedLifecycle !== record.value.lifecycle) {
        const valid = assertTransition(record.value, recommendedLifecycle);
        if (!valid.ok) return valid;
        updated = transitionRecord(updated, recommendedLifecycle, updated.updatedAt, 1);
        events.push(this.eventInput(input, growUnitEventTypes.lifecycleChanged, payload({
          from: record.value.lifecycle,
          to: recommendedLifecycle,
          reason: input.reason,
          currentPhase: updated.currentPhase
        })));
      }
      updated = { ...updated, recordVersion: record.value.recordVersion + events.length };
      const appended = await this.options.ledger.appendBatch(growUnitStream(growUnitRef), events);
      if (!appended.ok) return appended;
      const write = await this.storage.writeRecord(updated, input.reason);
      if (!write.ok) return write;
      return ok({ growUnitRef, kind: eventType, recordVersion: updated.recordVersion, eventReceipt: appended.value, recordWriteReceipt: write.value });
    });
  }

  private async writeReadiness(
    record: GrowUnitRecord,
    to: GrowUnitRecord["lifecycle"],
    input: ApplyReadinessVerdictInput
  ): Promise<Result<GrowUnitTransitionReceipt>> {
    const events = [this.eventInput(input, growUnitEventTypes.readinessVerdictApplied, refsPayload({
      readinessVerdictRef: input.readinessVerdictRef,
      verdict: input.verdict,
      ...(input.validationReportRef === undefined ? {} : { validationReportRef: input.validationReportRef })
    }))];
    let updated = { ...record, updatedAt: new Date().toISOString(), recordVersion: record.recordVersion + 1 };
    if (to !== record.lifecycle) {
      updated = transitionRecord(updated, to, updated.updatedAt, 1);
      events.push(this.eventInput(input, growUnitEventTypes.lifecycleChanged, payload({
        from: record.lifecycle,
        to,
        reason: input.reason,
        currentPhase: updated.currentPhase
      })));
    }
    const appended = await this.options.ledger.appendBatch(growUnitStream(record.growUnitRef), events);
    if (!appended.ok) return appended;
    const write = await this.storage.writeRecord(updated, input.reason);
    if (!write.ok) return write;
    return ok(transitionReceipt(record, updated, input.reason, appended.value, write.value));
  }

  private async writeHatchPackage(
    record: GrowUnitRecord,
    input: LinkHatchPackageInput
  ): Promise<Result<GrowUnitTransitionReceipt>> {
    const updated = transitionRecord(record, "hatched", new Date().toISOString(), 2, "hatch");
    const appended = await this.options.ledger.appendBatch(growUnitStream(record.growUnitRef), [
      this.eventInput(input, growUnitEventTypes.hatchPackageLinked, refsPayload({
        hatchPackageRef: input.hatchPackageRef,
        ...(input.hatchSummary === undefined ? {} : { hatchSummary: input.hatchSummary })
      })),
      this.eventInput(input, growUnitEventTypes.lifecycleChanged, payload({
        from: record.lifecycle,
        to: "hatched",
        reason: input.reason,
        currentPhase: "hatch"
      }))
    ]);
    if (!appended.ok) return appended;
    const write = await this.storage.writeRecord(updated, input.reason);
    if (!write.ok) return write;
    return ok(transitionReceipt(record, updated, input.reason, appended.value, write.value));
  }

  private appendOne(record: GrowUnitRecord, input: GrowUnitReasonInput, eventType: string, data: Record<string, unknown>) {
    return this.options.ledger.appendEvent(growUnitStream(record.growUnitRef), this.eventInput(input, eventType, payload(data)));
  }

  private eventInput(input: GrowUnitReasonInput, eventType: string, eventPayload: AppendEventInput["payload"]): AppendEventInput {
    return {
      eventType,
      eventVersion: "1",
      payload: eventPayload,
      source: input.source,
      audit: input.audit,
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      producer: this.options.producer
    };
  }

  private async withMutation<T>(growUnitRef: GrowUnitRecord["growUnitRef"], task: () => Promise<Result<T>>): Promise<Result<T>> {
    const key = growUnitRef.id;
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const current = previous.then(() => gate);
    this.locks.set(key, current);
    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.locks.get(key) === current) this.locks.delete(key);
    }
  }
}

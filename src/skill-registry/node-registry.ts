import { randomUUID } from "node:crypto";
import { makeSkillId, makeRef, type SkillRef } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import type { FileNativeStore } from "../file-store/index.js";
import { makePolicyRequestId, type PolicyDecision } from "../policy-boundary/index.js";
import { skillEventTypes } from "./events.js";
import { skillErr } from "./errors.js";
import { discoverSkillFiles } from "./discovery.js";
import { makeSkillActivationId } from "./brand.js";
import { scopeCoversRequest } from "./scope.js";
import { SkillRegistryStorage } from "./storage.js";
import { SkillEventWriter } from "./event-writer.js";
import {
  activationGuard,
  activationIsActive,
  candidateFor,
  changedFields,
  defaultPolicyContext,
  initialLifecycle,
  latestActivations,
  matchesQuery,
  recordUsable,
  summary,
  systemSource,
  validateRegisterInput
} from "./logic.js";
import type {
  ActiveSkillList,
  AddSkillVersionInput,
  DefaultFeedbackRouterInput,
  LoadSkillOptions,
  RegisterSkillInput,
  SkillActivation,
  SkillActivationInput,
  SkillActivationStatus,
  SkillBodyMaterialization,
  SkillCandidateContext,
  SkillCandidateExplanation,
  SkillCandidateList,
  SkillCatalogPage,
  SkillCatalogQuery,
  SkillDiscoveryReport,
  SkillDiscoveryScope,
  SkillLifecycle,
  SkillLifecycleReceipt,
  SkillRecord,
  SkillRegistry,
  SkillRegistryOptions,
  SkillSummaryMaterialization,
  SkillVersionDiffSummary
} from "./types.js";

export function createSkillRegistry(store: FileNativeStore, options: SkillRegistryOptions): SkillRegistry {
  return new NodeSkillRegistry(store, options);
}

class NodeSkillRegistry implements SkillRegistry {
  private readonly storage: SkillRegistryStorage;
  private readonly events: SkillEventWriter;

  constructor(
    private readonly store: FileNativeStore,
    private readonly options: SkillRegistryOptions
  ) {
    this.storage = new SkillRegistryStorage(store, options.workspace);
    this.events = new SkillEventWriter(options.ledger, options.producer);
  }

  async discoverSkills(scope: SkillDiscoveryScope): Promise<Result<SkillDiscoveryReport>> {
    const report = await discoverSkillFiles(this.store, this.options.workspace, scope);
    if (!report.ok) return report;
    const event = await this.events.catalog(skillEventTypes.discovered, report.value, {
      source: systemSource(this.options.workspace.id),
      reason: "discover skills"
    });
    return event.ok ? ok(report.value) : event;
  }

  async registerSkill(input: RegisterSkillInput): Promise<Result<SkillRef>> {
    return this.createRecord(input, undefined, skillEventTypes.registered);
  }

  async getSkill(skillRef: SkillRef): Promise<Result<SkillRecord>> {
    return this.storage.readRecord(skillRef);
  }

  async listSkills(query: SkillCatalogQuery = {}): Promise<Result<SkillCatalogPage>> {
    const records = await this.storage.readAllRecords();
    if (!records.ok) return records;
    const filtered = records.value.filter((record) => matchesQuery(record, query));
    const start = query.cursor === undefined ? 0 : Number.parseInt(query.cursor, 10);
    const limit = query.limit ?? 50;
    const page = filtered.slice(start, start + limit);
    const next = start + page.length;
    return ok({
      records: page,
      total: filtered.length,
      ...(next < filtered.length ? { nextCursor: String(next) } : {}),
      truncated: next < filtered.length
    });
  }

  async addSkillVersion(skillRef: SkillRef, input: AddSkillVersionInput): Promise<Result<SkillRef>> {
    const previous = await this.getSkill(skillRef);
    if (!previous.ok) return previous;
    return this.createRecord(
      { ...input, name: previous.value.name, family: previous.value.family, scope: previous.value.scope },
      previous.value.skillRef,
      skillEventTypes.versionAdded
    );
  }

  async compareSkillVersions(skillRef: SkillRef, versionA: string, versionB: string): Promise<Result<SkillVersionDiffSummary>> {
    const base = await this.getSkill(skillRef);
    if (!base.ok) return base;
    const records = await this.storage.recordsForFamily(base.value.family);
    if (!records.ok) return records;
    const from = records.value.find((record) => record.version.schemaVersion === versionA);
    const to = records.value.find((record) => record.version.schemaVersion === versionB);
    if (from === undefined || to === undefined) return skillErr({ code: "not_found", message: "skill version not found" });
    return ok({ family: base.value.family, from, to, changedFields: changedFields(from, to) });
  }

  async retractSkillVersion(skillRef: SkillRef, version: string, reason: string): Promise<Result<SkillLifecycleReceipt>> {
    const target = await this.storage.findVersion(skillRef, version);
    if (!target.ok) return target;
    return this.transitionLifecycle(target.value, "retracted", reason, skillEventTypes.versionRetracted);
  }

  async activateSkill(skillRef: SkillRef, input: SkillActivationInput): Promise<Result<SkillActivation>> {
    const record = await this.getSkill(skillRef);
    if (!record.ok) return record;
    const guard = activationGuard(record.value);
    if (!guard.ok) return guard;
    const decision = await this.evaluateActivationPolicy(record.value, input);
    if (!decision.ok) return decision;
    return this.writeActivation(record.value, input, "enabled", decision.value.policyDecisionId);
  }

  async disableSkill(skillRef: SkillRef, input: SkillActivationInput): Promise<Result<SkillActivation>> {
    const record = await this.getSkill(skillRef);
    if (!record.ok) return record;
    return this.writeActivation(record.value, input, "disabled", undefined);
  }

  async pinSkillVersion(skillRef: SkillRef, version: string, input: SkillActivationInput): Promise<Result<SkillActivation>> {
    const target = await this.storage.findVersion(skillRef, version);
    if (!target.ok) return target;
    const guard = activationGuard(target.value);
    if (!guard.ok) return guard;
    const decision = await this.evaluateActivationPolicy(target.value, input);
    if (!decision.ok) return decision;
    return this.writeActivation(target.value, input, "pinned", decision.value.policyDecisionId);
  }

  async rollbackSkill(skillRef: SkillRef, input: SkillActivationInput, rollbackTarget: SkillRef): Promise<Result<SkillActivation>> {
    const current = await this.getSkill(skillRef);
    if (!current.ok) return current;
    const target = await this.getSkill(rollbackTarget);
    if (!target.ok || target.value.family !== current.value.family) {
      return skillErr({ code: "rollback_target_missing", message: "rollback target is missing or from another family" });
    }
    const decision = await this.evaluateActivationPolicy(target.value, input);
    if (!decision.ok) return decision;
    return this.writeActivation(target.value, input, "rolled_back", decision.value.policyDecisionId, rollbackTarget);
  }

  async listActiveSkills(scope: SkillActivationInput["scope"]): Promise<Result<ActiveSkillList>> {
    const activations = await this.storage.readAllActivations();
    if (!activations.ok) return activations;
    const latest = latestActivations(activations.value.filter((item) => scopeCoversRequest(scope, item.scope)));
    const skills = [];
    for (const activation of latest) {
      if (!activationIsActive(activation)) continue;
      const record = await this.getSkill(activation.skillRef);
      if (record.ok && recordUsable(record.value)) skills.push({ record: record.value, activation });
    }
    return ok({ skills });
  }

  async loadSkillBody(skillRef: SkillRef, options: LoadSkillOptions): Promise<Result<SkillBodyMaterialization>> {
    const record = await this.getSkill(skillRef);
    if (!record.ok) return record;
    const materialized = await this.options.artifactRegistry.materializeArtifact(record.value.bodyRef, {
      reason: options.reason,
      allowArchived: true,
      ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes })
    });
    if (!materialized.ok) return materialized.error.code === "not_found"
      ? skillErr({ code: "artifact_unavailable", message: "skill body artifact is missing" })
      : materialized;
    if (materialized.value.status !== "available" || materialized.value.content === undefined) {
      return skillErr({
        code: materialized.value.status === "redacted" ? "privacy_blocked" : "artifact_unavailable",
        message: "skill body is not available"
      });
    }
    return ok({
      skillRef,
      bodyRef: record.value.bodyRef,
      content: materialized.value.content,
      version: record.value.version,
      privacyClass: record.value.privacyClass,
      ...(materialized.value.readReceipt === undefined ? {} : { readReceipt: materialized.value.readReceipt }),
      artifactMaterialization: materialized.value
    });
  }

  async loadSkillSummary(skillRef: SkillRef, _options: LoadSkillOptions): Promise<Result<SkillSummaryMaterialization>> {
    const record = await this.getSkill(skillRef);
    return record.ok ? ok(summary(record.value)) : record;
  }

  async findSkillCandidates(context: SkillCandidateContext): Promise<Result<SkillCandidateList>> {
    const active = await this.listActiveSkills(context.scope);
    if (!active.ok) return active;
    const candidates = active.value.skills
      .map(({ record, activation }) => candidateFor(record, activation, context))
      .filter((candidate) => candidate !== undefined)
      .sort((a, b) => b.score - a.score);
    return ok({ candidates });
  }

  async explainSkillCandidate(skillRef: SkillRef, context: SkillCandidateContext): Promise<Result<SkillCandidateExplanation>> {
    const record = await this.getSkill(skillRef);
    if (!record.ok) return record;
    const active = await this.listActiveSkills(context.scope);
    if (!active.ok) return active;
    const item = active.value.skills.find((candidate) => candidate.record.skillId === record.value.skillId);
    const candidate = item === undefined ? undefined : candidateFor(item.record, item.activation, context);
    return ok({
      skillRef,
      contextSummary: context.text,
      matched: candidate !== undefined,
      reasons: candidate === undefined ? ["skill is not active or did not match context"] : [candidate.reason],
      limitations: candidate?.limitations ?? ["active skill is still only a candidate for Context Compiler"]
    });
  }

  async ensureDefaultFeedbackRouter(input: DefaultFeedbackRouterInput): Promise<Result<SkillRef>> {
    const existing = await this.listSkills({ family: "default_feedback_router", includeRetracted: false, limit: 1 });
    if (!existing.ok) return existing;
    let skillRef = existing.value.records[0]?.skillRef;
    if (skillRef === undefined) {
      const registered = await this.registerSkill({
        ...input,
        name: "default-feedback-router",
        family: "default_feedback_router",
        sourceKind: "system_default"
      });
      if (!registered.ok) return registered;
      skillRef = registered.value;
    }
    if (input.activate !== undefined) {
      const activated = await this.activateSkill(skillRef, input.activate);
      if (!activated.ok) return activated;
    }
    return ok(skillRef);
  }

  private async createRecord(
    input: RegisterSkillInput,
    supersedesRef: SkillRef | undefined,
    eventType: string
  ): Promise<Result<SkillRef>> {
    const valid = validateRegisterInput(input);
    if (!valid.ok) return valid;
    const body = await this.options.artifactRegistry.registerArtifact({
      kind: "skill_body",
      content: input.body,
      mediaType: input.mediaType ?? "text/markdown",
      encoding: input.encoding ?? (typeof input.body === "string" ? "utf8" : "binary"),
      source: input.source,
      version: input.version,
      audit: input.audit,
      privacyClass: input.privacyClass,
      retentionClass: "grow_scoped",
      producerModule: input.producerModule ?? "human"
    });
    if (!body.ok) return body;
    const skillId = makeSkillId(`skill-${randomUUID()}`);
    const skillRef = makeRef("skill", skillId, { uri: `skill://${input.family ?? input.name}/${input.version.schemaVersion}` });
    const now = new Date().toISOString();
    const record: SkillRecord = {
      skillId,
      skillRef,
      name: input.name,
      family: input.family ?? input.name,
      version: input.version,
      lifecycle: initialLifecycle(input.sourceKind),
      sourceKind: input.sourceKind,
      source: input.source,
      scope: input.scope,
      description: input.description,
      triggerSummary: input.triggerSummary,
      bodyRef: body.value,
      assetRefs: input.assetRefs ?? [],
      referenceRefs: input.referenceRefs ?? [],
      declaredCapabilities: input.declaredCapabilities ?? [],
      declaredToolRefs: input.declaredToolRefs ?? [],
      compatibility: input.compatibility ?? {},
      privacyClass: input.privacyClass,
      evidenceRefs: input.evidenceRefs ?? [],
      ...(supersedesRef === undefined ? {} : { supersedesRef, rollbackTarget: supersedesRef }),
      audit: input.audit,
      createdAt: now,
      updatedAt: now
    };
    const write = await this.storage.writeRecord(record);
    if (!write.ok) return write;
    const indexed = await this.storage.addRecordToIndex(record.skillRef);
    if (!indexed.ok) return indexed;
    const event = await this.events.skill(record, eventType, { record: summary(record), supersedesRef });
    return event.ok ? ok(skillRef) : event;
  }

  private async evaluateActivationPolicy(record: SkillRecord, input: SkillActivationInput): Promise<Result<PolicyDecision>> {
    const decision = await this.options.policyBoundary.evaluateAction({
      requestId: makePolicyRequestId(`skill-activate-${randomUUID()}`),
      capability: "skill.activate",
      requestedByModule: "skill-registry",
      ...(input.scope.workspace === undefined ? {} : { workspace: input.scope.workspace }),
      ...(input.scope.growUnit === undefined ? {} : { growUnit: input.scope.growUnit }),
      ...(input.scope.attempt === undefined ? {} : { attempt: input.scope.attempt }),
      ...(input.scope.targetWorld === undefined ? {} : { targetWorld: input.scope.targetWorld }),
      skillRefs: [record.skillId],
      resourceSummary: `${record.family}:${record.name}@${record.version.schemaVersion}`,
      operation: "activate-skill",
      reason: input.reason,
      source: input.source
    }, input.policyContext ?? defaultPolicyContext());
    if (!decision.ok) return decision;
    if (decision.value.verdict === "allow" || decision.value.verdict === "allow_with_constraints") return decision;
    return skillErr({
      code: decision.value.verdict === "deny" ? "policy_blocked" : "activation_blocked",
      message: `skill activation blocked by policy verdict: ${decision.value.verdict}`
    });
  }

  private async writeActivation(
    record: SkillRecord,
    input: SkillActivationInput,
    status: SkillActivationStatus,
    policyDecisionId: PolicyDecision["policyDecisionId"] | undefined,
    rollbackTarget?: SkillRef
  ): Promise<Result<SkillActivation>> {
    const activation: SkillActivation = {
      activationId: makeSkillActivationId(`activation-${randomUUID()}`),
      skillRef: record.skillRef,
      version: record.version,
      scope: input.scope,
      status,
      ...(policyDecisionId === undefined ? {} : { policyDecisionId }),
      reason: input.reason,
      activatedBy: input.activatedBy,
      createdAt: new Date().toISOString(),
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      evidenceRefs: record.evidenceRefs,
      ...(rollbackTarget === undefined ? {} : { rollbackTarget }),
      audit: input.audit
    };
    const write = await this.storage.writeActivationRecord(activation);
    if (!write.ok) return write;
    const indexed = await this.storage.addActivationToIndex(activation.activationId);
    if (!indexed.ok) return indexed;
    const eventType = status === "disabled"
      ? skillEventTypes.disabled
      : status === "pinned"
        ? skillEventTypes.versionPinned
        : status === "rolled_back"
          ? skillEventTypes.rollbackRecorded
          : skillEventTypes.activationChanged;
    const event = await this.events.skill(record, eventType, { activation });
    return event.ok ? ok({ ...activation, eventReceipt: event.value }) : event;
  }

  private async transitionLifecycle(record: SkillRecord, to: SkillLifecycle, reason: string, eventType: string) {
    const updated = { ...record, lifecycle: to, updatedAt: new Date().toISOString() };
    const write = await this.storage.writeRecord(updated);
    if (!write.ok) return write;
    const event = await this.events.skill(updated, eventType, { skillRef: updated.skillRef, from: record.lifecycle, to, reason });
    return event.ok ? ok({ skillRef: updated.skillRef, from: record.lifecycle, to, reason, eventReceipt: event.value }) : event;
  }
}

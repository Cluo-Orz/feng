import { randomUUID } from "node:crypto";
import { makePolicyDecisionId } from "../domain/ids.js";
import { ok, type Result } from "../domain/result.js";
import {
  defaultConstraints,
  describeCapabilityBoundary,
  knownCapability,
  requireCapabilityBoundary
} from "./boundary.js";
import { policyErr } from "./errors.js";
import { policyEventTypes, policyStream } from "./events.js";
import { grantCoversRequest, grantMatchesFilter, normalizeGrantScope, requestGrantScope } from "./grants.js";
import { approvalPayload, decisionFromPayload, decisionPayload, grantFromPayload, grantPayload } from "./payloads.js";
import { evaluatePrivacyBoundary } from "./privacy.js";
import { defaultVerdictForCapability, matchRule } from "./rules.js";
import { makeApprovalId, makeCapabilityGrantId } from "./brand.js";
import type {
  ActionRequest,
  ApprovalInput,
  ApprovalReceipt,
  ArtifactPolicySummary,
  BoundaryLevel,
  CapabilityGrant,
  CapabilityGrantList,
  CapabilityGrantScope,
  EnvironmentCapabilitySummary,
  GrantInput,
  PolicyBoundary,
  PolicyBoundaryOptions,
  PolicyContext,
  PolicyDecision,
  PolicyDecisionExplanation,
  RevocationReceipt
} from "./types.js";

export function createPolicyBoundary(options: PolicyBoundaryOptions): PolicyBoundary {
  return new NodePolicyBoundary(options);
}

class NodePolicyBoundary implements PolicyBoundary {
  private readonly decisions = new Map<string, PolicyDecision>();
  private readonly decisionTtlMs: number;

  constructor(private readonly options: PolicyBoundaryOptions) {
    this.decisionTtlMs = options.decisionTtlMs ?? 15 * 60 * 1000;
  }

  async evaluateAction(request: ActionRequest, context: PolicyContext): Promise<Result<PolicyDecision>> {
    const valid = validateRequest(request);
    if (!valid.ok) return valid;
    const boundary = this.describeBoundary(request.capability, context.environment);
    if (!boundary.ok) return boundary;
    if (!knownCapability(request.capability) || boundary.value.level === "unsupported") {
      return this.recordDecision(request, context, "unsupported", defaultConstraints(request.capability, boundary.value), boundary.value);
    }

    const grant = await this.findGrant(request, context);
    if (!grant.ok) return grant;
    if (grant.value !== undefined) {
      return this.recordDecision(request, context, "allow", grant.value.constraints, boundary.value, "allowed by scoped grant");
    }

    const privacy = await evaluatePrivacyBoundary(request, context, this.options.artifactRegistry);
    if (!privacy.ok) return privacy;
    if (privacy.value !== undefined) {
      return this.recordDecision(
        request,
        context,
        privacy.value.verdict,
        privacy.value.constraints,
        boundary.value,
        privacy.value.explanation
      );
    }

    const rule = matchRule(request, context.rules);
    const verdict = rule?.verdict ?? defaultVerdictForCapability(request.capability);
    const constraints = unique([...(rule?.constraints ?? []), ...defaultConstraints(request.capability, boundary.value)]);
    return this.recordDecision(request, context, verdict, constraints, boundary.value, rule?.explanation);
  }

  async explainDecision(policyDecisionId: PolicyDecision["policyDecisionId"]): Promise<Result<PolicyDecisionExplanation>> {
    const existing = this.decisions.get(policyDecisionId);
    if (existing !== undefined) return ok({ decision: existing, summary: existing.explanation });
    const replay = await this.options.ledger.replayStream(policyStream, { reason: "explain policy decision" });
    if (!replay.ok) return replay;
    const decision = replay.value.events
      .filter((event) => event.eventType === policyEventTypes.decisionRecorded)
      .map((event) => decisionFromPayload(event.payload))
      .find((item) => item?.policyDecisionId === policyDecisionId);
    return decision === undefined
      ? policyErr({ code: "not_found", message: "policy decision not found" })
      : ok({ decision, summary: decision.explanation });
  }

  async recordApproval(request: ActionRequest, input: ApprovalInput): Promise<Result<ApprovalReceipt>> {
    const receipt: ApprovalReceipt = {
      approvalId: makeApprovalId(`approval-${randomUUID()}`),
      request,
      approvedBy: input.approvedBy,
      reason: input.reason,
      createdAt: new Date().toISOString(),
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      constraints: input.constraints ?? []
    };
    const event = await this.options.ledger.appendEvent(policyStream, {
      eventType: policyEventTypes.approvalRecorded,
      eventVersion: "1",
      payload: approvalPayload(receipt),
      source: input.source,
      audit: input.audit,
      ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId }),
      producer: this.options.producer
    });
    return event.ok ? ok({ ...receipt, eventReceipt: event.value }) : event;
  }

  async createGrant(input: GrantInput): Promise<Result<CapabilityGrant>> {
    const request = input.approval.request;
    const scope = normalizeGrantScope(request, input.scope);
    if (!scope.ok) return scope;
    const now = new Date().toISOString();
    const grant: CapabilityGrant = {
      grantId: makeCapabilityGrantId(`grant-${randomUUID()}`),
      capability: request.capability,
      scope: scope.value,
      subject: input.subject ?? input.approval.approvedBy,
      approvedBy: input.approval.approvedBy,
      reason: input.approval.reason,
      constraints: input.approval.constraints,
      createdAt: now,
      expiresAt: input.expiresAt,
      source: request.source,
      audit: { createdAt: now, createdBy: input.approval.approvedBy, reason: input.approval.reason }
    };
    if (Date.parse(grant.expiresAt) <= Date.now()) {
      return policyErr({ code: "grant_expired", message: "grant expires before it can be used" });
    }
    const event = await this.options.ledger.appendEvent(policyStream, {
      eventType: policyEventTypes.grantCreated,
      eventVersion: "1",
      payload: grantPayload(grant),
      source: grant.source,
      audit: grant.audit,
      ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId }),
      producer: this.options.producer
    });
    return event.ok ? ok(grant) : event;
  }

  async revokeGrant(grantId: CapabilityGrant["grantId"], reason: string): Promise<Result<RevocationReceipt>> {
    const existing = await this.findGrantById(grantId);
    if (!existing.ok) return existing;
    if (existing.value === undefined) return policyErr({ code: "not_found", message: "grant not found" });
    const revokedAt = new Date().toISOString();
    const receipt: RevocationReceipt = { grantId, reason, revokedAt };
    const event = await this.options.ledger.appendEvent(policyStream, {
      eventType: policyEventTypes.grantRevoked,
      eventVersion: "1",
      payload: { grantId, reason, revokedAt },
      source: existing.value.source,
      audit: { createdAt: revokedAt, createdBy: this.options.producer, reason },
      producer: this.options.producer
    });
    return event.ok ? ok({ ...receipt, eventReceipt: event.value }) : event;
  }

  async listActiveGrants(scope: CapabilityGrantScope): Promise<Result<CapabilityGrantList>> {
    const grants = await this.replayGrants();
    if (!grants.ok) return grants;
    return ok({ grants: grants.value.filter((grant) => grantMatchesFilter(scope, grant)) });
  }

  describeBoundary(capability: string, environment: EnvironmentCapabilitySummary) {
    return describeCapabilityBoundary(capability, environment);
  }

  requireBoundary(capability: string, requiredLevel: BoundaryLevel, environment: EnvironmentCapabilitySummary) {
    return requireCapabilityBoundary(capability, requiredLevel, environment);
  }

  async evaluateArtifactAccess(request: ActionRequest, artifactSummary: ArtifactPolicySummary) {
    return this.evaluateAction(request, summaryContext(request, artifactSummary));
  }

  async evaluateFeedbackUpstream(request: ActionRequest, feedbackSummary: ArtifactPolicySummary) {
    return this.evaluateAction({ ...request, capability: "feedback.upstream" }, summaryContext(request, feedbackSummary));
  }

  async evaluateHatchPublish(request: ActionRequest, hatchSummary: ArtifactPolicySummary) {
    return this.evaluateAction({ ...request, capability: "hatch.publish" }, summaryContext(request, hatchSummary));
  }

  private async recordDecision(
    request: ActionRequest,
    context: PolicyContext,
    verdict: PolicyDecision["verdict"],
    constraints: readonly string[],
    boundaryDeclaration: PolicyDecision["boundaryDeclaration"],
    explanation?: string
  ): Promise<Result<PolicyDecision>> {
    const decision: PolicyDecision = {
      policyDecisionId: makePolicyDecisionId(`policy-${randomUUID()}`),
      requestId: request.requestId,
      capability: request.capability,
      verdict,
      constraints: unique(constraints),
      ...decisionRequirements(verdict, request.capability),
      boundaryDeclaration,
      expiresAt: new Date(Date.now() + this.decisionTtlMs).toISOString(),
      source: request.source,
      audit: { createdAt: new Date().toISOString(), createdBy: this.options.producer, reason: request.reason },
      explanation: explanation ?? explain(verdict, constraints, boundaryDeclaration)
    };
    const event = await this.options.ledger.appendEvent(policyStream, {
      eventType: policyEventTypes.decisionRecorded,
      eventVersion: "1",
      payload: decisionPayload(decision),
      source: decision.source,
      audit: decision.audit,
      ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId }),
      producer: this.options.producer
    });
    if (!event.ok) return event;
    const recorded = { ...decision, eventReceipt: event.value };
    this.decisions.set(recorded.policyDecisionId, recorded);
    return ok(recorded);
  }

  private async findGrant(request: ActionRequest, context: PolicyContext): Promise<Result<CapabilityGrant | undefined>> {
    const scope = requestGrantScope(request);
    const contextGrant = context.activeGrants?.find((grant) => subjectMatches(grant, context.caller) && grantCoversRequest(scope, grant));
    if (contextGrant !== undefined) return ok(contextGrant);
    const listed = await this.listActiveGrants(scope);
    if (!listed.ok) return listed;
    return ok(listed.value.grants.find((grant) => subjectMatches(grant, context.caller) && grantCoversRequest(scope, grant)));
  }

  private async findGrantById(grantId: CapabilityGrant["grantId"]): Promise<Result<CapabilityGrant | undefined>> {
    const grants = await this.replayGrants();
    return grants.ok ? ok(grants.value.find((grant) => grant.grantId === grantId)) : grants;
  }

  private async replayGrants(): Promise<Result<readonly CapabilityGrant[]>> {
    const replay = await this.options.ledger.replayStream(policyStream, { reason: "replay policy grants" });
    if (!replay.ok) return replay;
    const grants = new Map<string, CapabilityGrant>();
    const revoked = new Map<string, string>();
    for (const event of replay.value.events) {
      if (event.eventType === policyEventTypes.grantCreated) {
        const grant = grantFromPayload(event.payload);
        if (grant !== undefined) grants.set(grant.grantId, grant);
      }
      if (event.eventType === policyEventTypes.grantRevoked) {
        const grantId = payloadString(event.payload, "grantId");
        const revokedAt = payloadString(event.payload, "revokedAt");
        if (grantId !== undefined && revokedAt !== undefined) revoked.set(grantId, revokedAt);
      }
    }
    return ok([...grants.values()].map((grant) => revoked.has(grant.grantId) ? { ...grant, revokedAt: revoked.get(grant.grantId)! } : grant));
  }
}

function validateRequest(request: ActionRequest): Result<void> {
  if (request.reason.trim().length === 0) return policyErr({ code: "invalid_input", message: "request reason is required" });
  if (request.resourceSummary.trim().length === 0) return policyErr({ code: "invalid_input", message: "resourceSummary is required" });
  if (request.requestedByModule.trim().length === 0) return policyErr({ code: "invalid_input", message: "requestedByModule is required" });
  if (request.operation.trim().length === 0) return policyErr({ code: "invalid_input", message: "operation is required" });
  return ok(undefined);
}

function decisionRequirements(verdict: PolicyDecision["verdict"], capability: string) {
  if (verdict === "ask") return { requiredApproval: `approval required for ${capability}` };
  if (verdict === "allow_with_redaction") return { requiredRedaction: `redaction required for ${capability}` };
  if (verdict === "allow_with_constraints") return { requiredEvidence: ["caller must preserve execution receipt"] };
  return {};
}

function explain(
  verdict: PolicyDecision["verdict"],
  constraints: readonly string[],
  boundary: PolicyDecision["boundaryDeclaration"]
): string {
  return `${verdict} under ${boundary.level}${constraints.length > 0 ? ` with ${constraints.length} constraint(s)` : ""}`;
}

function subjectMatches(grant: CapabilityGrant, caller: string): boolean {
  return grant.subject === caller || grant.subject === "*";
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function payloadString(payload: unknown, key: string): string | undefined {
  return typeof payload === "object" && payload !== null && key in payload
    ? String((payload as Record<string, unknown>)[key])
    : undefined;
}

function summaryContext(request: ActionRequest, artifact: ArtifactPolicySummary): PolicyContext {
  return {
    artifactSummaries: [artifact],
    caller: request.requestedByModule,
    environment: {
      hostSandboxAvailable: false,
      networkAvailable: true,
      externalEnforcementAvailable: false,
      secretStoreAvailable: false
    }
  };
}

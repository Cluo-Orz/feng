import { ok, type Result } from "../domain/result.js";
import { policyErr } from "./errors.js";
import { wildcard } from "./rules.js";
import type { ActionRequest, CapabilityGrant, CapabilityGrantScope } from "./types.js";

export function grantActive(grant: CapabilityGrant): boolean {
  return grant.revokedAt === undefined && Date.parse(grant.expiresAt) > Date.now();
}

export function requestGrantScope(request: ActionRequest): CapabilityGrantScope {
  return compactScope({
    workspace: request.workspace,
    growUnit: request.growUnit,
    runtime: request.runtime,
    targetWorld: request.targetWorld,
    capability: request.capability,
    resourcePattern: request.resourceSummary
  });
}

export function normalizeGrantScope(
  request: ActionRequest,
  scope: CapabilityGrantScope
): Result<CapabilityGrantScope> {
  if (scope.capability !== undefined && scope.capability !== request.capability) {
    return policyErr({ code: "invalid_input", message: "grant capability conflicts with approved request" });
  }
  const merged = compactScope({
    workspace: scope.workspace ?? request.workspace,
    growUnit: scope.growUnit ?? request.growUnit,
    runtime: scope.runtime ?? request.runtime,
    targetWorld: scope.targetWorld ?? request.targetWorld,
    capability: scope.capability ?? request.capability,
    resourcePattern: scope.resourcePattern ?? request.resourceSummary
  });
  if (!scopeWithinRequest(request, merged)) {
    return policyErr({ code: "invalid_input", message: "grant scope cannot exceed approved request boundary" });
  }
  if (Object.keys(merged).length < 2) {
    return policyErr({ code: "invalid_input", message: "grant must include capability plus a concrete scope" });
  }
  return ok(merged);
}

export function grantCoversRequest(request: CapabilityGrantScope, grant: CapabilityGrant): boolean {
  const scope = grant.scope;
  if (!grantActive(grant)) return false;
  if (scope.capability !== request.capability) return false;
  if (!sameScopedValue(request.workspace, scope.workspace)) return false;
  if (!sameScopedValue(request.growUnit, scope.growUnit)) return false;
  if (!sameScopedValue(request.runtime, scope.runtime)) return false;
  if (!sameScopedValue(request.targetWorld, scope.targetWorld)) return false;
  if (request.resourcePattern === undefined || scope.resourcePattern === undefined) return false;
  return wildcard(scope.resourcePattern, request.resourcePattern);
}

export function grantMatchesFilter(filter: CapabilityGrantScope, grant: CapabilityGrant): boolean {
  const scope = grant.scope;
  if (!grantActive(grant)) return false;
  if (filter.capability !== undefined && filter.capability !== grant.capability) return false;
  if (filter.workspace !== undefined && filter.workspace !== scope.workspace) return false;
  if (filter.growUnit !== undefined && filter.growUnit !== scope.growUnit) return false;
  if (filter.runtime !== undefined && filter.runtime !== scope.runtime) return false;
  if (filter.targetWorld !== undefined && filter.targetWorld !== scope.targetWorld) return false;
  if (filter.resourcePattern !== undefined && !wildcard(scope.resourcePattern ?? "", filter.resourcePattern)) return false;
  return true;
}

function compactScope(input: {
  readonly workspace?: CapabilityGrantScope["workspace"];
  readonly growUnit?: CapabilityGrantScope["growUnit"];
  readonly runtime?: string | undefined;
  readonly targetWorld?: CapabilityGrantScope["targetWorld"];
  readonly capability?: string | undefined;
  readonly resourcePattern?: string | undefined;
}): CapabilityGrantScope {
  return {
    ...(input.workspace === undefined ? {} : { workspace: input.workspace }),
    ...(input.growUnit === undefined ? {} : { growUnit: input.growUnit }),
    ...(input.runtime === undefined ? {} : { runtime: input.runtime }),
    ...(input.targetWorld === undefined ? {} : { targetWorld: input.targetWorld }),
    ...(input.capability === undefined ? {} : { capability: input.capability }),
    ...(input.resourcePattern === undefined ? {} : { resourcePattern: input.resourcePattern })
  };
}

function sameScopedValue(requestValue: string | undefined, grantValue: string | undefined): boolean {
  if (requestValue === undefined) return grantValue === undefined;
  return grantValue === requestValue;
}

function scopeWithinRequest(request: ActionRequest, scope: CapabilityGrantScope): boolean {
  if (request.workspace !== undefined && scope.workspace !== request.workspace) return false;
  if (request.growUnit !== undefined && scope.growUnit !== request.growUnit) return false;
  if (request.runtime !== undefined && scope.runtime !== request.runtime) return false;
  if (request.targetWorld !== undefined && scope.targetWorld !== request.targetWorld) return false;
  if (scope.resourcePattern !== undefined && !wildcard(scope.resourcePattern, request.resourceSummary)) return false;
  return true;
}

import type { SkillScope } from "./types.js";

export function scopeKey(scope: SkillScope): string {
  return JSON.stringify({
    workspace: scope.workspace,
    growUnit: scope.growUnit,
    attempt: scope.attempt,
    runtimeContract: scope.runtimeContract,
    hatchPackage: scope.hatchPackage,
    targetWorld: scope.targetWorld,
    systemDefault: scope.systemDefault === true
  });
}

export function scopeMatchesFilter(filter: SkillScope | undefined, scope: SkillScope): boolean {
  if (filter === undefined) return true;
  if (filter.workspace !== undefined && filter.workspace !== scope.workspace) return false;
  if (filter.growUnit !== undefined && filter.growUnit !== scope.growUnit) return false;
  if (filter.attempt !== undefined && filter.attempt !== scope.attempt) return false;
  if (filter.runtimeContract !== undefined && filter.runtimeContract !== scope.runtimeContract) return false;
  if (filter.hatchPackage !== undefined && filter.hatchPackage !== scope.hatchPackage) return false;
  if (filter.targetWorld !== undefined && filter.targetWorld !== scope.targetWorld) return false;
  if (filter.systemDefault !== undefined && filter.systemDefault !== scope.systemDefault) return false;
  return true;
}

export function scopeCoversRequest(request: SkillScope, scope: SkillScope): boolean {
  if (!same(request.workspace, scope.workspace)) return false;
  if (!same(request.growUnit, scope.growUnit)) return false;
  if (!same(request.attempt, scope.attempt)) return false;
  if (!same(request.runtimeContract, scope.runtimeContract)) return false;
  if (!same(request.hatchPackage, scope.hatchPackage)) return false;
  if (!same(request.targetWorld, scope.targetWorld)) return false;
  if (request.systemDefault !== undefined && request.systemDefault !== scope.systemDefault) return false;
  return true;
}

export function scopeSummary(scope: SkillScope): string {
  const parts = Object.entries(scope)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}:${String(value)}`);
  return parts.length === 0 ? "unscoped" : parts.join(",");
}

function same(requestValue: string | undefined, scopeValue: string | undefined): boolean {
  if (requestValue === undefined) return true;
  return requestValue === scopeValue;
}

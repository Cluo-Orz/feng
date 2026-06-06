import type { ContextCompilePlanId, ContextCompilePlanRef } from "./types.js";

export const makeContextCompilePlanRef = (id: ContextCompilePlanId): ContextCompilePlanRef => ({
  kind: "context_compile_plan",
  id,
  uri: `context-compile-plan://${id}`
});

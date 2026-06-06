import type { GrowLifecycle } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import { growUnitErr } from "./errors.js";
import type { GrowUnitPhase, GrowUnitRecord } from "./types.js";

const allowedTransitions: Record<GrowLifecycle, readonly GrowLifecycle[]> = {
  created: ["clarifying", "planning", "waiting_input", "blocked", "archived"],
  clarifying: ["planning", "waiting_input", "growing", "blocked", "archived"],
  planning: ["clarifying", "growing", "waiting_input", "blocked", "archived"],
  growing: ["planning", "waiting_input", "waiting_feedback", "verifying", "ready_to_hatch", "blocked", "archived"],
  waiting_input: ["clarifying", "planning", "growing", "blocked", "archived"],
  waiting_feedback: ["planning", "growing", "verifying", "blocked", "archived"],
  verifying: ["growing", "waiting_input", "waiting_feedback", "ready_to_hatch", "blocked", "archived"],
  ready_to_hatch: ["hatched", "growing", "verifying", "blocked", "archived"],
  hatched: ["growing", "waiting_feedback", "blocked", "archived"],
  blocked: ["waiting_input", "planning", "growing", "archived"],
  archived: []
};

export function phaseForLifecycle(lifecycle: GrowLifecycle): GrowUnitPhase {
  if (lifecycle === "created") return "intake";
  if (lifecycle === "clarifying" || lifecycle === "waiting_input") return "clarification";
  if (lifecycle === "planning") return "planning";
  if (lifecycle === "growing" || lifecycle === "waiting_feedback") return "growth";
  if (lifecycle === "verifying") return "verification";
  if (lifecycle === "ready_to_hatch" || lifecycle === "hatched") return "hatch";
  if (lifecycle === "blocked") return "blocked";
  return "archived";
}

export function assertTransition(
  record: GrowUnitRecord,
  to: GrowLifecycle,
  options: { readonly allowBlocked?: boolean; readonly requireReadiness?: boolean; readonly requireHatch?: boolean } = {}
): Result<void> {
  if (record.lifecycle === "archived") {
    return growUnitErr({ code: "grow_unit_archived", message: "archived grow unit cannot mutate" });
  }
  if (record.lifecycle === "blocked" && options.allowBlocked !== true && to !== "archived") {
    return growUnitErr({ code: "grow_unit_blocked", message: "blocked grow unit must be unblocked before this transition" });
  }
  if (!allowedTransitions[record.lifecycle].includes(to)) {
    return growUnitErr({
      code: "transition_conflict",
      message: `cannot transition grow unit from ${record.lifecycle} to ${to}`
    });
  }
  if (to === "ready_to_hatch" && record.latestReadinessVerdictRef === undefined && options.requireReadiness === true) {
    return growUnitErr({ code: "readiness_failed", message: "ready_to_hatch requires a readiness verdict ref" });
  }
  if (to === "hatched" && record.latestHatchPackageRef === undefined && options.requireHatch === true) {
    return growUnitErr({ code: "invalid_state", message: "hatched requires a hatch package ref" });
  }
  return ok(undefined);
}

export function lifecycleFromReadiness(verdict: string): GrowLifecycle {
  if (verdict === "ready_to_hatch") return "ready_to_hatch";
  if (verdict === "waiting_input") return "waiting_input";
  if (verdict === "waiting_feedback") return "waiting_feedback";
  if (verdict === "waiting_validation") return "verifying";
  if (verdict === "blocked") return "blocked";
  if (verdict === "continue_grow") return "growing";
  return "planning";
}

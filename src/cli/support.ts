import { makeRef, type Result } from "../domain/index.js";
import { ok } from "../domain/result.js";
import {
  makeArtifactId,
  makeAttemptId,
  makeFeedbackUnitId,
  makeGrowUnitId,
  makeHatchPackageId,
  makeSkillId,
  type ArtifactRef,
  type AttemptRef,
  type FeedbackUnitRef,
  type GrowUnitRef,
  type HatchPackageRef,
  type SkillRef
} from "../domain/index.js";
import {
  debugCorrelationRef,
  feedbackBridgePacketRef,
  makeDebugCorrelationId,
  makeFeedbackBridgePacketId,
  type DebugCorrelationRef,
  type FeedbackBridgePacketRef
} from "../debug-feedback-bridge/index.js";
import {
  makeRuntimeInvocationId,
  runtimeInvocationRef,
  type RuntimeInvocationRef
} from "../agent-runtime-kernel/index.js";
import { cliErr } from "./errors.js";
import type { CLICommandIntent, CLIHandlerResult, CLIRefView } from "./types.js";

export function requireValue(
  intent: CLICommandIntent,
  flag: string,
  position: number,
  label: string
): Result<string> {
  const value = intent.flags[flag] ?? intent.positionals[position];
  if (value === undefined || value.trim().length === 0) {
    return cliErr({ code: "invalid_input", message: `${label} is required`, severity: "warning" });
  }
  return ok(value);
}

export const growRef = (id: string): GrowUnitRef => makeRef("grow_unit", makeGrowUnitId(id));
export const artifactRef = (id: string): ArtifactRef => makeRef("artifact", makeArtifactId(id));
export const hatchRef = (id: string): HatchPackageRef => makeRef("hatch_package", makeHatchPackageId(id));
export const attemptRef = (id: string): AttemptRef => makeRef("attempt", makeAttemptId(id));
export const skillRef = (id: string): SkillRef => makeRef("skill", makeSkillId(id));
export const feedbackRef = (id: string): FeedbackUnitRef => makeRef("feedback_unit", makeFeedbackUnitId(id));
export const correlationRef = (id: string): DebugCorrelationRef => debugCorrelationRef(makeDebugCorrelationId(id));
export const packetRef = (id: string): FeedbackBridgePacketRef => feedbackBridgePacketRef(makeFeedbackBridgePacketId(id));
export const invocationRef = (id: string): RuntimeInvocationRef => runtimeInvocationRef(makeRuntimeInvocationId(id));

export function refView(label: string, ref: { readonly id: string; readonly uri?: string }): CLIRefView {
  return { label, ref: ref.id, ...(ref.uri === undefined ? {} : { uri: ref.uri }) };
}

export function success(
  headline: string,
  parts: Partial<Omit<CLIHandlerResult, "exitStatus" | "headline">> = {}
): CLIHandlerResult {
  const warnings = parts.warnings ?? [];
  return {
    exitStatus: warnings.length > 0 ? "succeeded_with_warnings" : "succeeded",
    headline,
    facts: parts.facts ?? [],
    refs: parts.refs ?? [],
    warnings,
    nextActions: parts.nextActions ?? [],
    ...(parts.data === undefined ? {} : { data: parts.data })
  };
}

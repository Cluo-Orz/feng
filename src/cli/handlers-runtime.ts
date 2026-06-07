import type { Result } from "../domain/result.js";
import { ok } from "../domain/result.js";
import { makePolicyDecisionId } from "../domain/index.js";
import type { CLIRuntime } from "./runtime.js";
import {
  artifactRef,
  attemptRef,
  correlationRef,
  growRef,
  hatchRef,
  invocationRef,
  packetRef,
  refView,
  requireValue,
  skillRef,
  success
} from "./support.js";
import type { CLIExecutionContext, CLIHandlerResult } from "./types.js";

type Handler = (runtime: CLIRuntime, ctx: CLIExecutionContext) => Promise<Result<CLIHandlerResult>>;

const environment = {
  hostSandboxAvailable: false,
  networkAvailable: true,
  externalEnforcementAvailable: false,
  secretStoreAvailable: false
} as const;

export const attemptHandler: Handler = async (runtime, ctx) => {
  const intent = ctx.intent;
  const runner = runtime.ports.attemptRunner;
  if (intent.action === "list" || intent.action === "default") {
    const grow = intent.flags["grow"];
    const page = await runner.listAttempts(grow === undefined ? {} : { growUnitRef: growRef(grow) });
    if (!page.ok) return page;
    return ok(success(`${page.value.total} attempt(s)`, {
      refs: page.value.records.map((record) => refView("attempt", record.attemptRef)),
      data: { total: page.value.total }
    }));
  }
  const ref = requireValue(intent, "attempt", 0, "attempt ref");
  if (!ref.ok) return ref;
  if (intent.action === "explain") {
    const explanation = await runner.explainAttempt(attemptRef(ref.value));
    if (!explanation.ok) return explanation;
    return ok(success("attempt explanation", { data: { explanation: explanation.value } }));
  }
  const record = await runner.readAttempt(attemptRef(ref.value));
  if (!record.ok) return record;
  return ok(success("attempt record", {
    refs: [refView("attempt", record.value.attemptRef)],
    data: { record: record.value }
  }));
};

export const readinessHandler: Handler = async (runtime, ctx) => {
  const grow = requireValue(ctx.intent, "grow", 0, "grow unit ref");
  if (!grow.ok) return grow;
  const ref = growRef(grow.value);
  if (ctx.intent.action === "evidence") {
    const page = await runtime.ports.evidenceReadiness.listEvidence(ref);
    if (!page.ok) return page;
    return ok(success(`${page.value.total} evidence record(s)`, { data: { total: page.value.total } }));
  }
  const summary = await runtime.ports.evidenceReadiness.buildReadinessSummary(ref);
  if (!summary.ok) return summary;
  const status: CLIHandlerResult["exitStatus"] = summary.value.readyToHatch ? "succeeded" : "blocked_by_readiness";
  return ok({
    exitStatus: status,
    headline: summary.value.readyToHatch ? "ready to hatch" : "not ready to hatch",
    facts: [`active DoD: ${summary.value.activeDoDCount}`, `blocking gaps: ${summary.value.blockingGapCount}`],
    refs: [],
    warnings: [],
    nextActions: [],
    data: { readiness: summary.value }
  });
};

export const hatchHandler: Handler = async (runtime, ctx) => {
  const intent = ctx.intent;
  const builder = runtime.ports.hatchBuilder;
  if (intent.action === "list" || intent.action === "default") {
    const grow = requireValue(intent, "grow", 0, "grow unit ref");
    if (!grow.ok) return grow;
    const page = await builder.listHatchPackages(growRef(grow.value));
    if (!page.ok) return page;
    return ok(success(`${page.value.total} hatch package(s)`, {
      refs: page.value.records.map((record) => refView("hatch_package", record.hatchPackageRef)),
      data: { total: page.value.total }
    }));
  }
  const ref = requireValue(intent, "package", 0, "hatch package ref");
  if (!ref.ok) return ref;
  if (intent.action === "explain") {
    const explanation = await builder.explainHatchPackage(hatchRef(ref.value));
    if (!explanation.ok) return explanation;
    return ok(success("hatch package explanation", { data: { explanation: explanation.value } }));
  }
  const record = await builder.getHatchPackage(hatchRef(ref.value));
  if (!record.ok) return record;
  return ok(success("hatch package record", {
    refs: [refView("hatch_package", record.value.hatchPackageRef)],
    data: { record: record.value }
  }));
};

export const runtimeHandler: Handler = async (runtime, ctx) => {
  const ref = requireValue(ctx.intent, "invocation", 0, "runtime invocation ref");
  if (!ref.ok) return ref;
  const kernel = runtime.ports.agentRuntimeKernel;
  if (ctx.intent.action === "hints") {
    const page = await kernel.listFeedbackCandidateHints(invocationRef(ref.value));
    if (!page.ok) return page;
    return ok(success("runtime feedback candidate hints", { data: { hints: page.value } }));
  }
  const explanation = await kernel.explainRuntimeInvocation(invocationRef(ref.value));
  if (!explanation.ok) return explanation;
  return ok(success("runtime invocation explanation", { data: { explanation: explanation.value } }));
};

export const debugHandler: Handler = async (runtime, ctx) => {
  const intent = ctx.intent;
  const bridge = runtime.ports.debugFeedbackBridge;
  if (intent.action === "explain") {
    const packet = requireValue(intent, "packet", 0, "bridge packet ref");
    if (!packet.ok) return packet;
    const explanation = await bridge.explainFeedbackBridgePacket(packetRef(packet.value));
    if (!explanation.ok) return explanation;
    return ok(success("bridge packet explanation", { data: { explanation: explanation.value } }));
  }
  const correlation = requireValue(intent, "correlation", 0, "debug correlation ref");
  if (!correlation.ok) return correlation;
  if (intent.action === "list") {
    const page = await bridge.listBridgePackets(correlationRef(correlation.value));
    if (!page.ok) return page;
    return ok(success(`${page.value.total} bridge packet(s)`, { data: { total: page.value.total } }));
  }
  const record = await bridge.getDebugCorrelation(correlationRef(correlation.value));
  if (!record.ok) return record;
  return ok(success(`debug correlation ${record.value.status}`, { data: { correlation: record.value } }));
};

export const policyHandler: Handler = async (runtime, ctx) => {
  const intent = ctx.intent;
  if (intent.action === "explain") {
    const decision = requireValue(intent, "decision", 0, "policy decision id");
    if (!decision.ok) return decision;
    const explanation = await runtime.ports.policyBoundary.explainDecision(makePolicyDecisionId(decision.value));
    if (!explanation.ok) return explanation;
    return ok(success("policy decision explanation", { data: { explanation: explanation.value } }));
  }
  const capability = requireValue(intent, "capability", 0, "capability");
  if (!capability.ok) return capability;
  const boundary = runtime.ports.policyBoundary.describeBoundary(capability.value, environment);
  if (!boundary.ok) return boundary;
  return ok(success(`boundary for ${capability.value}`, { data: { boundary: boundary.value } }));
};

export const artifactHandler: Handler = async (runtime, ctx) => {
  const ref = requireValue(ctx.intent, "artifact", 0, "artifact ref");
  if (!ref.ok) return ref;
  const registry = runtime.ports.artifactRegistry;
  if (ctx.intent.action === "preview") {
    const preview = await registry.readArtifactPreview(artifactRef(ref.value), { reason: "cli artifact preview" });
    if (!preview.ok) return preview;
    return ok(success("artifact preview", { data: { preview: preview.value } }));
  }
  const record = await registry.resolveArtifact(artifactRef(ref.value));
  if (!record.ok) return record;
  return ok(success("artifact metadata", {
    facts: [`privacy: ${record.value.privacyClass}`, `kind: ${record.value.kind}`],
    data: { record: record.value }
  }));
};

export const skillHandler: Handler = async (runtime, ctx) => {
  const intent = ctx.intent;
  const registry = runtime.ports.skillRegistry;
  if (intent.action === "show") {
    const ref = requireValue(intent, "skill", 0, "skill ref");
    if (!ref.ok) return ref;
    const record = await registry.getSkill(skillRef(ref.value));
    if (!record.ok) return record;
    return ok(success("skill record", { refs: [refView("skill", record.value.skillRef)], data: { record: record.value } }));
  }
  const page = await registry.listSkills(intent.flags["text"] === undefined ? {} : { text: intent.flags["text"] });
  if (!page.ok) return page;
  return ok(success(`${page.value.total} skill(s)`, {
    refs: page.value.records.map((record) => refView("skill", record.skillRef)),
    data: { total: page.value.total }
  }));
};


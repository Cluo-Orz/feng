import { ok, type Result } from "../domain/result.js";
import type { FengHost } from "./runtime-host.js";
import type { FeedbackLayer } from "../runtime-package/index.js";

interface StoredCandidate {
  readonly issueKind: string;
  readonly layer: FeedbackLayer;
  readonly severity: string;
  readonly detail: string;
  readonly routingReason: string;
  readonly chapterNumber: number;
}

export interface RouteFeedbackResult {
  readonly totalCandidates: number;
  readonly byLayer: Record<FeedbackLayer, number>;
  readonly absorbedToAgent: number;
  readonly absorbedToFeng: number;
  readonly keptLocal: number;
}

const RUNTIME_CHAPTERS = ".feng/runtime/chapters";

async function readAllCandidates(host: FengHost): Promise<Result<readonly StoredCandidate[]>> {
  const listing = await host.store.listDirectory(host.workspace, RUNTIME_CHAPTERS, { reason: "route-feedback: list chapters", recursive: false });
  if (!listing.ok) {
    return listing.error.code === "not_found" ? ok([]) : listing;
  }
  const candidates: StoredCandidate[] = [];
  for (const entry of listing.value.entries) {
    if (entry.kind !== "directory") continue;
    const read = await host.store.readText(host.workspace, `${RUNTIME_CHAPTERS}/${entry.name}/feedback.json`, { reason: "route-feedback: read feedback", maxBytes: 256 * 1024 });
    if (!read.ok) continue;
    try {
      const parsed = JSON.parse(read.value.content) as { readonly candidates?: readonly StoredCandidate[] };
      for (const candidate of parsed.candidates ?? []) candidates.push(candidate);
    } catch {
      continue;
    }
  }
  return ok(candidates);
}

async function absorb(host: FengHost, layer: string, candidates: readonly StoredCandidate[]): Promise<Result<number>> {
  if (candidates.length === 0) return ok(0);
  const at = new Date().toISOString();
  const source = { kind: "runtime" as const, origin: "feng-feedback-router", userProvided: false, receivedAt: at, privacyLevel: "workspace_private" as const };
  const version = { schemaVersion: "1.0.0", producerVersion: "feng-feedback-router" };
  const audit = { createdAt: at, createdBy: "feng-feedback-router", reason: `absorb ${layer} feedback` };
  const grow = await host.grow.createGrowUnit({
    title: `absorbed ${layer} feedback`,
    goalBoundarySummary: `吸收来自下游作品项目的${layer}级反馈候选并归因。`,
    targetBehaviorSummary: "将已归因的反馈作为 feedback 候选准入，待 grow 决定是否吸收。",
    source, version, audit
  });
  if (!grow.ok) return grow;
  let count = 0;
  for (const candidate of candidates) {
    const received = await host.admission.receiveRuntimeReport(grow.value, {
      content: `[${candidate.issueKind}] ${candidate.detail}`,
      normalizedSummary: `ch${candidate.chapterNumber} ${candidate.issueKind}: ${candidate.routingReason}`,
      mediaType: "text/plain", encoding: "utf8", privacyClass: "workspace_private",
      version, source, audit
    });
    if (!received.ok) return received;
    const normalized = await host.admission.normalizeInboxItem(received.value);
    if (!normalized.ok) return normalized;
    const classified = await host.admission.classifyInboxItem(received.value);
    if (!classified.ok) return classified;
    const decided = await host.admission.decideAdmission(received.value, { decision: "admit_as_feedback_candidate", reason: `absorb ${layer} feedback`, source, audit });
    if (!decided.ok) return decided;
    count += 1;
  }
  return ok(count);
}

// Concept (novel-case-flow.md 226-251): work facts stay local; only capability
// gaps flow to the agent project and system gaps to feng. This never blindly
// pushes work facts upstream.
export async function routeProjectFeedback(input: {
  readonly workHost: FengHost;
  readonly agentHost?: FengHost;
  readonly fengHost?: FengHost;
}): Promise<Result<RouteFeedbackResult>> {
  const all = await readAllCandidates(input.workHost);
  if (!all.ok) return all;
  const byLayer: Record<FeedbackLayer, number> = { work: 0, capability: 0, system: 0 };
  for (const candidate of all.value) byLayer[candidate.layer] += 1;
  const capability = all.value.filter((c) => c.layer === "capability");
  const system = all.value.filter((c) => c.layer === "system");

  let absorbedToAgent = 0;
  if (input.agentHost !== undefined) {
    const res = await absorb(input.agentHost, "capability", capability);
    if (!res.ok) return res;
    absorbedToAgent = res.value;
  }
  let absorbedToFeng = 0;
  if (input.fengHost !== undefined) {
    const res = await absorb(input.fengHost, "system", system);
    if (!res.ok) return res;
    absorbedToFeng = res.value;
  }
  return ok({
    totalCandidates: all.value.length,
    byLayer,
    absorbedToAgent,
    absorbedToFeng,
    keptLocal: byLayer.work
  });
}

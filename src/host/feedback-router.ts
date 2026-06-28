import { ok, type Result } from "../domain/result.js";
import { domainErr } from "../domain/index.js";
import type { FengHost } from "./runtime-host.js";
import type { FeedbackLayer } from "../runtime-package/index.js";
import { inboxRecordPath } from "../admission-feedback-inbox/paths.js";
import {
  RUNTIME_DEBUG_REPORT_PATH,
  WORK_CHAPTER_QUALITY_GATE_FILE,
  type QualityGateLayer,
  type QualityGateRecord,
  type QualityGateSet,
  type RuntimeDebugReport
} from "../authoring-runtime/index.js";

interface StoredCandidate {
  readonly issueKind: string;
  readonly layer: FeedbackLayer;
  readonly severity: string;
  readonly detail: string;
  readonly routingReason: string;
  readonly chapterNumber: number;
  readonly source?: "feedback" | "quality_gate" | "author_feedback" | "debug_report";
  readonly gateId?: string;
  readonly qualityGateStatus?: string;
  readonly artifactPath?: string;
  readonly admissionRef?: string;
  readonly admissionRecordPath?: string;
  readonly admissionDecision?: "admit_as_feedback_candidate";
  readonly admissionGrowUnitId?: string;
}

export interface FeedbackDigestDetail {
  readonly issueKind: string;
  readonly chapter?: number;
  readonly detail: string;
  readonly source?: "feedback" | "quality_gate" | "author_feedback" | "debug_report";
  readonly gateId?: string;
  readonly qualityGateStatus?: string;
  readonly artifactPath?: string;
  readonly feedbackKey?: string;
  readonly admissionRef?: string;
  readonly admissionRecordPath?: string;
  readonly admissionDecision?: "admit_as_feedback_candidate";
  readonly admissionGrowUnitId?: string;
}

export interface RouteFeedbackResult {
  readonly totalCandidates: number;
  readonly byLayer: Record<FeedbackLayer, number>;
  readonly absorbedToAgent: number;
  readonly absorbedToFeng: number;
  readonly keptLocal: number;
  readonly capabilityDigestPath?: string;
  readonly systemDigestPath?: string;
}

const RUNTIME_CHAPTERS = ".feng/runtime/chapters";
export const CAPABILITY_DIGEST_PATH = ".feng/grow-inbox/capability-feedback.json";
export const SYSTEM_DIGEST_PATH = ".feng/grow-inbox/system-feedback.json";
export const SYSTEM_RESOLUTION_PATH = ".feng/grow-inbox/system-feedback-resolution.json";

export type SystemFeedbackDecision = "resolved" | "rejected";

export interface SystemFeedbackResolution {
  readonly schemaVersion: "1.0.0";
  readonly kind: "system_feedback_resolution";
  readonly sourcePath: string;
  readonly decisions: readonly {
    readonly issueKind: string;
    readonly feedbackKeys?: readonly string[];
    readonly decision: SystemFeedbackDecision;
    readonly reason: string;
    readonly evidenceRefs?: readonly string[];
    readonly resolvedAt: string;
  }[];
  readonly updatedAt: string;
}

export interface ResolveSystemFeedbackInput {
  readonly issueKind: string;
  readonly decision: SystemFeedbackDecision;
  readonly reason: string;
  readonly evidenceRefs?: readonly string[];
  readonly feedbackKeys?: readonly string[];
}

function parseChapterNumber(name: string): number {
  const match = /chapter-(\d+)/.exec(name);
  return match === null ? 0 : Number.parseInt(match[1] as string, 10);
}

function chapterNameForNumber(chapterNumber: number): string {
  return `chapter-${String(chapterNumber).padStart(2, "0")}`;
}

function feedbackLayerForGate(layer: QualityGateLayer): FeedbackLayer {
  return layer === "runtime" ? "system" : layer;
}

function severityForGate(status: string): "warning" | "error" {
  return status === "failed" ? "error" : "warning";
}

function candidateKey(candidate: Pick<StoredCandidate, "chapterNumber" | "issueKind" | "layer" | "detail" | "gateId">): string {
  return [candidate.chapterNumber, candidate.issueKind, candidate.layer, candidate.gateId ?? "", candidate.detail].join("|");
}

function candidateGateKey(candidate: Pick<StoredCandidate, "chapterNumber" | "gateId">): string | undefined {
  return candidate.gateId === undefined ? undefined : `${candidate.chapterNumber}:${candidate.gateId}`;
}

function detailGateKey(detail: Pick<FeedbackDigestDetail, "chapter" | "gateId">): string | undefined {
  return detail.chapter === undefined || detail.gateId === undefined ? undefined : `${detail.chapter}:${detail.gateId}`;
}

export function feedbackDigestDetailKey(detail: Pick<FeedbackDigestDetail, "issueKind" | "chapter" | "detail" | "gateId" | "artifactPath">): string {
  return [detail.issueKind, String(detail.chapter ?? ""), detail.detail, detail.gateId ?? "", detail.artifactPath ?? ""].join("|");
}

function withFeedbackKey(detail: FeedbackDigestDetail): FeedbackDigestDetail {
  return {
    ...detail,
    feedbackKey: detail.feedbackKey ?? feedbackDigestDetailKey(detail)
  };
}

function gateCandidate(chapterName: string, gate: QualityGateRecord): StoredCandidate {
  const layer = feedbackLayerForGate(gate.layer);
  const issueKind = gate.issueKinds[0] ?? `gate:${gate.gateId}`;
  const chapterNumber = parseChapterNumber(chapterName);
  return {
    issueKind,
    layer,
    severity: severityForGate(gate.status),
    detail: `${gate.title}: ${gate.sourceRequirement} (${gate.status})`,
    routingReason: gate.notes.length > 0 ? gate.notes.join("; ") : gate.evidenceRequired,
    chapterNumber,
    source: "quality_gate",
    gateId: gate.gateId,
    qualityGateStatus: gate.status,
    artifactPath: `${RUNTIME_CHAPTERS}/${chapterName}/${WORK_CHAPTER_QUALITY_GATE_FILE}`
  };
}

async function readGateCandidates(
  host: FengHost,
  chapterName: string,
  existingKeys: Set<string>,
  existingGateKeys: Set<string>
): Promise<readonly StoredCandidate[]> {
  const path = `${RUNTIME_CHAPTERS}/${chapterName}/${WORK_CHAPTER_QUALITY_GATE_FILE}`;
  const read = await host.store.readText(host.workspace, path, { reason: "route-feedback: read quality gates", maxBytes: 256 * 1024 });
  if (!read.ok) return [];
  try {
    const parsed = JSON.parse(read.value.content) as QualityGateSet;
    const candidates: StoredCandidate[] = [];
    for (const gate of parsed.gates) {
      if (gate.status === "passed") continue;
      const candidate = gateCandidate(chapterName, gate);
      const gateKey = candidateGateKey(candidate);
      if ((gateKey !== undefined && existingGateKeys.has(gateKey)) || existingKeys.has(candidateKey(candidate))) continue;
      candidates.push(candidate);
      existingKeys.add(candidateKey(candidate));
      if (gateKey !== undefined) existingGateKeys.add(gateKey);
    }
    return candidates;
  } catch {
    return [];
  }
}

async function readPassedGateIds(host: FengHost, chapterName: string): Promise<ReadonlySet<string>> {
  const path = `${RUNTIME_CHAPTERS}/${chapterName}/${WORK_CHAPTER_QUALITY_GATE_FILE}`;
  const read = await host.store.readText(host.workspace, path, { reason: "route-feedback: read passed quality gates", maxBytes: 256 * 1024 });
  if (!read.ok) return new Set();
  try {
    const parsed = JSON.parse(read.value.content) as QualityGateSet;
    return new Set(parsed.gates.filter((gate) => gate.status === "passed").map((gate) => gate.gateId));
  } catch {
    return new Set();
  }
}

async function readPassedGateKeys(host: FengHost): Promise<Result<ReadonlySet<string>>> {
  const listing = await host.store.listDirectory(host.workspace, RUNTIME_CHAPTERS, { reason: "route-feedback: list chapters for passed gates", recursive: false });
  if (!listing.ok) return listing.error.code === "not_found" ? ok(new Set<string>()) : listing;
  const keys = new Set<string>();
  for (const entry of listing.value.entries) {
    if (entry.kind !== "directory") continue;
    const chapterNumber = parseChapterNumber(entry.name);
    if (chapterNumber <= 0) continue;
    const passed = await readPassedGateIds(host, entry.name);
    for (const gateId of passed) keys.add(`${chapterNumber}:${gateId}`);
  }
  return ok(keys);
}

async function readAllCandidates(host: FengHost): Promise<Result<readonly StoredCandidate[]>> {
  const listing = await host.store.listDirectory(host.workspace, RUNTIME_CHAPTERS, { reason: "route-feedback: list chapters", recursive: false });
  const candidates: StoredCandidate[] = [];
  if (listing.ok) {
    for (const entry of listing.value.entries) {
      if (entry.kind !== "directory") continue;
      const existingKeys = new Set<string>();
      const existingGateKeys = new Set<string>();
      const passedGateIds = await readPassedGateIds(host, entry.name);
      const read = await host.store.readText(host.workspace, `${RUNTIME_CHAPTERS}/${entry.name}/feedback.json`, { reason: "route-feedback: read feedback", maxBytes: 256 * 1024 });
      if (read.ok) {
        try {
          const parsed = JSON.parse(read.value.content) as { readonly candidates?: readonly StoredCandidate[] };
          for (const candidate of parsed.candidates ?? []) {
            if (candidate.gateId !== undefined && passedGateIds.has(candidate.gateId)) continue;
            const withSource: StoredCandidate = { ...candidate, source: candidate.source ?? "feedback" };
            candidates.push(withSource);
            existingKeys.add(candidateKey(withSource));
            const gateKey = candidateGateKey(withSource);
            if (gateKey !== undefined) existingGateKeys.add(gateKey);
          }
        } catch {
          // Ignore malformed per-chapter feedback and continue scanning other
          // file-native evidence from the same run.
        }
      }
      candidates.push(...await readGateCandidates(host, entry.name, existingKeys, existingGateKeys));
    }
  } else if (listing.error.code !== "not_found") {
    return listing;
  }
  const debugCandidates = await readDebugReportCandidates(host, new Set(candidates.map(candidateKey)));
  if (!debugCandidates.ok) return debugCandidates;
  return ok([...candidates, ...debugCandidates.value]);
}

async function readDebugReportCandidates(host: FengHost, existingKeys: Set<string>): Promise<Result<readonly StoredCandidate[]>> {
  const read = await host.store.readText(host.workspace, RUNTIME_DEBUG_REPORT_PATH, { reason: "route-feedback: read runtime debug report", maxBytes: 512 * 1024 });
  if (!read.ok) return read.error.code === "not_found" ? ok([]) : read;
  try {
    const parsed = JSON.parse(read.value.content) as RuntimeDebugReport;
    if (parsed.kind !== "runtime_debug_report" || parsed.rawContentIncluded !== false) return ok([]);
    const candidates: StoredCandidate[] = [];
    const passedByChapter = new Map<number, ReadonlySet<string>>();
    const currentPassedGateIds = async (chapterNumber: number): Promise<ReadonlySet<string>> => {
      const cached = passedByChapter.get(chapterNumber);
      if (cached !== undefined) return cached;
      const passed = await readPassedGateIds(host, chapterNameForNumber(chapterNumber));
      passedByChapter.set(chapterNumber, passed);
      return passed;
    };
    for (const candidate of parsed.feedbackCandidates ?? []) {
      if (candidate.gateId !== undefined) {
        const passedGateIds = await currentPassedGateIds(candidate.chapterNumber);
        if (passedGateIds.has(candidate.gateId)) continue;
      }
      const stored: StoredCandidate = {
        issueKind: candidate.issueKind,
        layer: candidate.layer,
        severity: candidate.severity,
        detail: candidate.detail,
        routingReason: `${candidate.routingReason}; debugReport=${RUNTIME_DEBUG_REPORT_PATH}; privacy=${parsed.privacyBoundary}`,
        chapterNumber: candidate.chapterNumber,
        source: "debug_report",
        artifactPath: RUNTIME_DEBUG_REPORT_PATH,
        ...(candidate.gateId === undefined ? {} : { gateId: candidate.gateId }),
        ...(candidate.qualityGateStatus === undefined ? {} : { qualityGateStatus: candidate.qualityGateStatus })
      };
      const key = candidateKey(stored);
      if (existingKeys.has(key)) continue;
      candidates.push(stored);
      existingKeys.add(key);
    }
    return ok(candidates);
  } catch (cause) {
    return domainErr({ module: "feedback-router", code: "schema_incompatible", message: "runtime debug report is invalid JSON", severity: "error", cause });
  }
}

async function absorb(host: FengHost, layer: string, candidates: readonly StoredCandidate[]): Promise<Result<readonly StoredCandidate[]>> {
  if (candidates.length === 0) return ok([]);
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
  const absorbed: StoredCandidate[] = [];
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
    absorbed.push({
      ...candidate,
      admissionRef: received.value.uri ?? `${received.value.kind}:${received.value.id}`,
      admissionRecordPath: inboxRecordPath(received.value.id),
      admissionDecision: "admit_as_feedback_candidate",
      admissionGrowUnitId: grow.value.id
    });
  }
  return ok(absorbed);
}

async function readExistingDigestDetails(host: FengHost, path: string, layer: FeedbackLayer): Promise<Result<readonly FeedbackDigestDetail[]>> {
  const read = await host.store.readText(host.workspace, path, { reason: `read existing ${layer} feedback digest`, maxBytes: 512 * 1024 });
  if (!read.ok) return read.error.code === "not_found" ? ok([]) : read;
  try {
    const parsed = JSON.parse(read.value.content) as {
      readonly layer?: string;
      readonly details?: readonly FeedbackDigestDetail[];
    };
    return parsed.layer === layer ? ok((parsed.details ?? []).map(withFeedbackKey)) : ok([]);
  } catch {
    return ok([]);
  }
}

async function writeDigest(
  host: FengHost,
  path: string,
  layer: FeedbackLayer,
  candidates: readonly StoredCandidate[],
  clearedGateKeys: ReadonlySet<string>
): Promise<Result<string | undefined>> {
  const existing = await readExistingDigestDetails(host, path, layer);
  if (!existing.ok) return existing;
  const incoming: readonly FeedbackDigestDetail[] = candidates.map((c) => ({
    issueKind: c.issueKind,
    chapter: c.chapterNumber,
    detail: c.detail,
    source: c.source ?? "feedback",
    ...(c.gateId === undefined ? {} : { gateId: c.gateId }),
    ...(c.qualityGateStatus === undefined ? {} : { qualityGateStatus: c.qualityGateStatus }),
    ...(c.artifactPath === undefined ? {} : { artifactPath: c.artifactPath }),
    ...(c.admissionRef === undefined ? {} : { admissionRef: c.admissionRef }),
    ...(c.admissionRecordPath === undefined ? {} : { admissionRecordPath: c.admissionRecordPath }),
    ...(c.admissionDecision === undefined ? {} : { admissionDecision: c.admissionDecision }),
    ...(c.admissionGrowUnitId === undefined ? {} : { admissionGrowUnitId: c.admissionGrowUnitId })
  }));
  const detailsByKey = new Map<string, FeedbackDigestDetail>();
  for (const detail of [...existing.value, ...incoming].map(withFeedbackKey)) {
    detailsByKey.set(detail.feedbackKey ?? feedbackDigestDetailKey(detail), detail);
  }
  const details = [...detailsByKey.values()].filter((detail) => {
    const gateKey = detailGateKey(detail);
    return gateKey === undefined || !clearedGateKeys.has(gateKey);
  });
  const existingKeys = existing.value.map((detail) => detail.feedbackKey ?? feedbackDigestDetailKey(detail)).sort();
  const nextKeys = details.map((detail) => detail.feedbackKey ?? feedbackDigestDetailKey(detail)).sort();
  const changed = candidates.length > 0 ||
    existingKeys.length !== nextKeys.length ||
    existingKeys.some((key, index) => key !== nextKeys[index]);
  if (!changed) return ok(undefined);
  const kinds = [...new Set(details.map((c) => c.issueKind))];
  const digest = JSON.stringify({
    schemaVersion: "1.0.0",
    kind: `${layer}_feedback_digest`,
    layer,
    issueKinds: kinds,
    count: details.length,
    updatedAt: new Date().toISOString(),
    details
  }, null, 2);
  const wrote = await host.store.writeTextAtomic(host.workspace, path, digest, { reason: `write ${layer} feedback digest`, createParents: true });
  return wrote.ok ? ok(path) : wrote;
}

async function newDigestCandidates(
  host: FengHost,
  path: string,
  layer: FeedbackLayer,
  candidates: readonly StoredCandidate[]
): Promise<Result<readonly StoredCandidate[]>> {
  if (candidates.length === 0) return ok([]);
  const existing = await readExistingDigestDetails(host, path, layer);
  if (!existing.ok) return existing;
  const existingKeys = new Set(existing.value.map((detail) => detail.feedbackKey ?? feedbackDigestDetailKey(detail)));
  return ok(candidates.filter((candidate) => {
    const key = feedbackDigestDetailKey({
      issueKind: candidate.issueKind,
      chapter: candidate.chapterNumber,
      detail: candidate.detail,
      ...(candidate.gateId === undefined ? {} : { gateId: candidate.gateId }),
      ...(candidate.artifactPath === undefined ? {} : { artifactPath: candidate.artifactPath })
    });
    return !existingKeys.has(key);
  }));
}

export async function readSystemFeedbackResolution(host: FengHost): Promise<Result<SystemFeedbackResolution | undefined>> {
  const read = await host.store.readText(host.workspace, SYSTEM_RESOLUTION_PATH, { reason: "read system feedback resolution", maxBytes: 256 * 1024 });
  if (!read.ok) return read.error.code === "not_found" ? ok(undefined) : read;
  try {
    return ok(JSON.parse(read.value.content) as SystemFeedbackResolution);
  } catch (cause) {
    return domainErr({ module: "feedback-router", code: "schema_incompatible", message: "system feedback resolution is invalid JSON", severity: "error", cause });
  }
}

function normalizeEvidenceRefs(refs: readonly string[] | undefined): readonly string[] {
  return [...new Set((refs ?? []).map((ref) => ref.trim()).filter((ref) => ref.length > 0))];
}

function normalizeFeedbackKeys(keys: readonly string[] | undefined): readonly string[] {
  return [...new Set((keys ?? []).map((key) => key.trim()).filter((key) => key.length > 0))];
}

function decisionHasValidEvidence(decision: SystemFeedbackResolution["decisions"][number]): boolean {
  if (decision.decision === "rejected") return true;
  return (decision.evidenceRefs ?? []).length > 0;
}

export function systemFeedbackDecisionClearsHatch(
  decision: SystemFeedbackResolution["decisions"][number],
  detail?: Pick<FeedbackDigestDetail, "issueKind" | "chapter" | "detail" | "gateId" | "artifactPath" | "feedbackKey">
): boolean {
  if (!decisionHasValidEvidence(decision)) return false;
  const keys = decision.feedbackKeys ?? [];
  if (detail === undefined) return keys.length > 0;
  if (keys.length === 0) return false;
  return keys.includes(detail.feedbackKey ?? feedbackDigestDetailKey(detail));
}

export async function resolveSystemFeedback(host: FengHost, input: ResolveSystemFeedbackInput): Promise<Result<string>> {
  const issueKind = input.issueKind.trim();
  if (issueKind.length === 0) {
    return domainErr({ module: "feedback-router", code: "invalid_input", message: "--issue-kind is required", severity: "warning" });
  }
  if (input.reason.trim().length === 0) {
    return domainErr({ module: "feedback-router", code: "invalid_input", message: "--reason is required", severity: "warning" });
  }
  const evidenceRefs = normalizeEvidenceRefs(input.evidenceRefs);
  if (input.decision === "resolved" && evidenceRefs.length === 0) {
    return domainErr({ module: "feedback-router", code: "invalid_input", message: "resolved system feedback requires at least one --evidence file", severity: "warning" });
  }
  for (const ref of evidenceRefs) {
    const evidence = await host.store.readText(host.workspace, ref, { reason: "read system feedback resolution evidence", maxBytes: 512 * 1024 });
    if (!evidence.ok) {
      return domainErr({ module: "feedback-router", code: "evidence_unavailable", message: `system feedback evidence is unavailable: ${ref}`, severity: "error", cause: evidence.error });
    }
  }
  const digestDetails = await readExistingDigestDetails(host, SYSTEM_DIGEST_PATH, "system");
  if (!digestDetails.ok) return digestDetails;
  const matchingDetails = digestDetails.value.filter((detail) => detail.issueKind === issueKind);
  const matchingKeys = new Set(matchingDetails.map((detail) => detail.feedbackKey ?? feedbackDigestDetailKey(detail)));
  const requestedKeys = normalizeFeedbackKeys(input.feedbackKeys);
  const unknownKeys = requestedKeys.filter((key) => !matchingKeys.has(key));
  if (unknownKeys.length > 0) {
    return domainErr({
      module: "feedback-router",
      code: "invalid_input",
      message: `--feedback-key does not match current ${issueKind} system feedback: ${unknownKeys.join(", ")}`,
      severity: "warning"
    });
  }
  const feedbackKeys = requestedKeys.length > 0 ? requestedKeys : [...matchingKeys];
  const existing = await readSystemFeedbackResolution(host);
  if (!existing.ok) return existing;
  const now = new Date().toISOString();
  const newKeySet = new Set(feedbackKeys);
  const prior = existing.value?.decisions.filter((item) => {
    if (item.issueKind !== issueKind) return true;
    const oldKeys = item.feedbackKeys ?? [];
    if (newKeySet.size === 0) return oldKeys.length > 0;
    if (oldKeys.length === 0) return true;
    return oldKeys.every((key) => !newKeySet.has(key));
  }) ?? [];
  const record: SystemFeedbackResolution = {
    schemaVersion: "1.0.0",
    kind: "system_feedback_resolution",
    sourcePath: SYSTEM_DIGEST_PATH,
    decisions: [...prior, {
      issueKind,
      ...(feedbackKeys.length === 0 ? {} : { feedbackKeys }),
      decision: input.decision,
      reason: input.reason,
      ...(evidenceRefs.length === 0 ? {} : { evidenceRefs }),
      resolvedAt: now
    }],
    updatedAt: now
  };
  const wrote = await host.store.writeTextAtomic(host.workspace, SYSTEM_RESOLUTION_PATH, JSON.stringify(record, null, 2), {
    reason: "write system feedback resolution",
    createParents: true
  });
  return wrote.ok ? ok(SYSTEM_RESOLUTION_PATH) : wrote;
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
  const clearedGateKeys = await readPassedGateKeys(input.workHost);
  if (!clearedGateKeys.ok) return clearedGateKeys;
  const byLayer: Record<FeedbackLayer, number> = { work: 0, capability: 0, system: 0 };
  for (const candidate of all.value) byLayer[candidate.layer] += 1;
  const capability = all.value.filter((c) => c.layer === "capability");
  const system = all.value.filter((c) => c.layer === "system");

  let absorbedToAgent = 0;
  let capabilityDigestPath: string | undefined;
  if (input.agentHost !== undefined) {
    const newCapability = await newDigestCandidates(input.agentHost, CAPABILITY_DIGEST_PATH, "capability", capability);
    if (!newCapability.ok) return newCapability;
    const absorbed = await absorb(input.agentHost, "capability", newCapability.value);
    if (!absorbed.ok) return absorbed;
    absorbedToAgent = absorbed.value.length;
    // File-native projection the agent's grow loop consumes to seed writing
    // constraints on its next re-grow. The admission inbox remains the audited
    // record; this digest is the grow-consumable view of downstream capability
    // feedback, so re-grow is actually driven by the work project, not staged.
    const wrote = await writeDigest(input.agentHost, CAPABILITY_DIGEST_PATH, "capability", absorbed.value, clearedGateKeys.value);
    if (!wrote.ok) return wrote;
    capabilityDigestPath = wrote.value;
  }
  let absorbedToFeng = 0;
  let systemDigestPath: string | undefined;
  if (input.fengHost !== undefined) {
    const newSystem = await newDigestCandidates(input.fengHost, SYSTEM_DIGEST_PATH, "system", system);
    if (!newSystem.ok) return newSystem;
    const absorbed = await absorb(input.fengHost, "system", newSystem.value);
    if (!absorbed.ok) return absorbed;
    absorbedToFeng = absorbed.value.length;
    // System feedback is the feng-level counterpart of capability feedback:
    // an auditable, file-native projection that feng can later evaluate in its
    // own grow loop without reading the entire downstream work project.
    const wrote = await writeDigest(input.fengHost, SYSTEM_DIGEST_PATH, "system", absorbed.value, clearedGateKeys.value);
    if (!wrote.ok) return wrote;
    systemDigestPath = wrote.value;
  }
  return ok({
    totalCandidates: all.value.length,
    byLayer,
    absorbedToAgent,
    absorbedToFeng,
    keptLocal: byLayer.work,
    ...(capabilityDigestPath === undefined ? {} : { capabilityDigestPath }),
    ...(systemDigestPath === undefined ? {} : { systemDigestPath })
  });
}

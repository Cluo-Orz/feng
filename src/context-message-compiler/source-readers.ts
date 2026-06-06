import type { ArtifactRef } from "../domain/index.js";
import type { ArtifactRegistry } from "../artifact-registry/index.js";
import { sha256Text } from "../event-ledger/stable-json.js";
import type { ContextSectionKind, ExclusionRecord } from "./types.js";
import type { SectionPart } from "./section-builder.js";

export interface ArtifactReadResult {
  readonly part?: SectionPart;
  readonly exclusions: readonly ExclusionRecord[];
  readonly unavailableSources: readonly string[];
  readonly sourceArtifactRefs: readonly ArtifactRef[];
  readonly excludedArtifactRefs: readonly ArtifactRef[];
}

export async function readArtifactForContext(input: {
  readonly registry: ArtifactRegistry;
  readonly ref: ArtifactRef;
  readonly reason: string;
  readonly section: ContextSectionKind;
  readonly maxBytes: number;
}): Promise<ArtifactReadResult> {
  const record = await input.registry.resolveArtifact(input.ref);
  if (!record.ok) {
    return excluded("artifact_unavailable", `Artifact ${input.ref.id} could not be resolved`, input.ref, input.section);
  }
  if (record.value.privacyClass === "contains_secret" || record.value.privacyClass === "unknown" || record.value.privacyClass === "redacted") {
    return excluded("privacy_blocked", `Artifact ${input.ref.id} hidden by privacy metadata`, input.ref, input.section);
  }
  if (record.value.lifecycle === "redacted") return excluded("redacted", `Artifact ${input.ref.id} is redacted`, input.ref, input.section);
  if (record.value.lifecycle === "retracted") return excluded("retracted", `Artifact ${input.ref.id} is retracted`, input.ref, input.section);
  if (record.value.lifecycle === "deleted" || record.value.lifecycle === "unavailable") {
    return excluded("artifact_unavailable", `Artifact ${input.ref.id} content is unavailable`, input.ref, input.section);
  }
  const materialized = await input.registry.materializeArtifact(input.ref, {
    reason: input.reason,
    maxBytes: input.maxBytes,
    allowArchived: true
  });
  if (!materialized.ok) {
    return excluded("artifact_unavailable", `Artifact ${input.ref.id} failed to materialize`, input.ref, input.section);
  }
  if (materialized.value.status !== "available" || materialized.value.content === undefined) {
    const reason = materialized.value.status === "redacted"
      ? "redacted"
      : materialized.value.status === "retracted"
        ? "retracted"
        : "artifact_unavailable";
    return excluded(reason, `Artifact ${input.ref.id} status=${materialized.value.status}`, input.ref, input.section);
  }
  const content = typeof materialized.value.content === "string"
    ? materialized.value.content
    : `<binary artifact ${materialized.value.content.length} bytes; hash=${sha256Text(Buffer.from(materialized.value.content).toString("base64"))}>`;
  const truncated = record.value.size !== undefined && record.value.size > input.maxBytes;
  return {
    part: {
      text: `Artifact ${input.ref.id}: ${content}`,
      sourceType: "artifact",
      sourceRef: input.ref,
      sourceVersion: record.value.version,
      inclusionReason: "required or supplied artifact materialized through Artifact Registry",
      transformation: truncated ? "bounded materialization" : "materialized content",
      truncated
    },
    exclusions: truncated ? [{
      sourceType: "artifact",
      sourceRef: input.ref,
      reason: "out_of_budget",
      summary: `Artifact ${input.ref.id} was bounded to ${input.maxBytes} bytes`,
      section: input.section
    }] : [],
    unavailableSources: [],
    sourceArtifactRefs: [input.ref],
    excludedArtifactRefs: []
  };
}

function excluded(
  reason: ExclusionRecord["reason"],
  summary: string,
  ref: ArtifactRef,
  section: ContextSectionKind
): ArtifactReadResult {
  return {
    exclusions: [{ sourceType: "artifact", sourceRef: ref, reason, summary, section }],
    unavailableSources: [summary],
    sourceArtifactRefs: [],
    excludedArtifactRefs: [ref]
  };
}

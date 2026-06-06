import type { ArtifactRef } from "../domain/index.js";
import { ok, type Result } from "../domain/result.js";
import type { AgendaRuntime } from "./runtime.js";
import type { AgendaInputRef, DoDRef, GapRef } from "./types.js";

export async function ensureArtifacts(
  runtime: AgendaRuntime,
  refs: readonly ArtifactRef[]
): Promise<Result<readonly ArtifactRef[]>> {
  for (const ref of refs) {
    const record = await runtime.options.artifactRegistry.resolveArtifact(ref);
    if (!record.ok) return record;
  }
  return ok(refs);
}

export async function ensureInputArtifacts(
  runtime: AgendaRuntime,
  refs: readonly AgendaInputRef[]
): Promise<Result<readonly AgendaInputRef[]>> {
  const artifacts = refs.filter((ref): ref is ArtifactRef => ref.kind === "artifact");
  const checked = await ensureArtifacts(runtime, artifacts);
  return checked.ok ? ok(refs) : checked;
}

export async function ensureKnownGaps(runtime: AgendaRuntime, refs: readonly GapRef[]): Promise<Result<readonly GapRef[]>> {
  for (const ref of refs) {
    const record = await runtime.storage.readGap(ref);
    if (!record.ok) return record;
  }
  return ok(refs);
}

export async function ensureKnownDoD(runtime: AgendaRuntime, refs: readonly DoDRef[]): Promise<Result<readonly DoDRef[]>> {
  for (const ref of refs) {
    const record = await runtime.storage.readDoD(ref);
    if (!record.ok) return record;
  }
  return ok(refs);
}

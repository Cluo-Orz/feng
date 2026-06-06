import type { ArtifactId } from "../domain/ids.js";

const artifactRoot = ".feng/artifacts";

export function artifactRecordPath(artifactId: ArtifactId): string {
  return `${artifactRoot}/records/${encodeSegment(artifactId)}.json`;
}

export function artifactContentPath(artifactId: ArtifactId): string {
  return `${artifactRoot}/content/${encodeSegment(artifactId)}.bin`;
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value).replaceAll("%", "~");
}

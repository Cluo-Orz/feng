import type { LedgerStream, ProjectionKey, ProjectionName } from "./types.js";

const ledgerRoot = ".feng/ledger";

export function streamPath(stream: LedgerStream): string {
  return `${ledgerRoot}/streams/${encodeSegment(stream.streamType)}/${encodeSegment(stream.streamId)}.jsonl`;
}

export function projectionPath(name: ProjectionName, key: ProjectionKey): string {
  return `${ledgerRoot}/projections/${encodeSegment(name)}/${encodeSegment(key)}.json`;
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value).replaceAll("%", "~");
}

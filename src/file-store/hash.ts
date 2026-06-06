import { createHash } from "node:crypto";
import type { ContentHash } from "./types.js";

export function sha256Content(content: string | Uint8Array): ContentHash {
  return {
    algorithm: "sha256",
    value: createHash("sha256").update(content).digest("hex")
  };
}

export function stableWorkspaceFingerprint(root: string): string {
  return createHash("sha256").update(root).digest("hex").slice(0, 16);
}

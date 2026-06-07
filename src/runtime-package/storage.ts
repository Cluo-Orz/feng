import { ok, type Result } from "../domain/result.js";
import { domainErr } from "../domain/index.js";
import type { FileNativeStore, WorkspaceHandle } from "../file-store/index.js";
import type { AuthoringRuntimePackage } from "./types.js";

// The package lives at a stable, copyable path so it can be `cp`'d from the
// agent grow project (xiaoshuo) into a work project (libai).
export const PACKAGE_PATH = ".feng/hatch/xiaoshuo-runtime.json";

export async function savePackage(
  store: FileNativeStore,
  workspace: WorkspaceHandle,
  pkg: AuthoringRuntimePackage
): Promise<Result<string>> {
  const written = await store.writeTextAtomic(workspace, PACKAGE_PATH, JSON.stringify(pkg, null, 2), {
    reason: "hatch authoring runtime package",
    createParents: true
  });
  return written.ok ? ok(PACKAGE_PATH) : written;
}

export async function loadPackage(
  store: FileNativeStore,
  workspace: WorkspaceHandle,
  pathOverride?: string
): Promise<Result<AuthoringRuntimePackage>> {
  const path = pathOverride ?? PACKAGE_PATH;
  const read = await store.readText(workspace, path, { reason: "load authoring runtime package", maxBytes: 1024 * 1024 });
  if (!read.ok) {
    return read.error.code === "not_found"
      ? domainErr({ module: "runtime-package", code: "package_unavailable", message: `no runtime package at ${path}; hatch one in the agent project first`, severity: "error" })
      : read;
  }
  try {
    const parsed = JSON.parse(read.value.content) as AuthoringRuntimePackage;
    if (parsed.kind !== "serialized_authoring_agent" || typeof parsed.writingStrategy?.systemPrompt !== "string") {
      return domainErr({ module: "runtime-package", code: "schema_incompatible", message: "runtime package is missing required fields", severity: "error" });
    }
    return ok(parsed);
  } catch (cause) {
    return domainErr({ module: "runtime-package", code: "schema_incompatible", message: "runtime package is not valid JSON", severity: "error", cause });
  }
}

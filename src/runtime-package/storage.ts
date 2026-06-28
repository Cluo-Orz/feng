import { createHash } from "node:crypto";
import { ok, type Result } from "../domain/result.js";
import { domainErr } from "../domain/index.js";
import type { ContentHash, FileNativeStore, WorkspaceHandle } from "../file-store/index.js";
import { defaultCoveragePolicy, defaultHarness, defaultStoryModel } from "./defaults.js";
import type { AuthoringRuntimePackage } from "./types.js";

// The package lives at a stable, copyable path so it can be `cp`'d from the
// agent grow project (xiaoshuo) into a work project (libai).
export const PACKAGE_PATH = ".feng/hatch/xiaoshuo-runtime.json";
export const RUNTIME_PACKAGE_LOCK_PATH = ".feng/runtime/package-lock.json";
export const RUNTIME_PACKAGE_INSTALL_PATH = ".feng/runtime/package-install.json";

export interface LoadedAuthoringRuntimePackage {
  readonly pkg: AuthoringRuntimePackage;
  readonly packagePath: string;
  readonly contentHash: ContentHash;
}

export interface RuntimePackageLock {
  readonly schemaVersion: "1.0.0";
  readonly kind: "runtime_package_lock";
  readonly packagePath: string;
  readonly packageId: string;
  readonly name: string;
  readonly version: string;
  readonly contentHash: ContentHash;
  readonly readiness: "ready" | "draft";
  readonly locked: boolean;
  readonly acceptedAt: string;
  readonly acceptedReason: string;
}

export interface RuntimePackageLockResult {
  readonly lockPath: string;
  readonly status: "created" | "matched" | "updated";
}

export interface RuntimePackageInstallRecord {
  readonly schemaVersion: "1.0.0";
  readonly kind: "runtime_package_install";
  readonly sourceWorkspaceRoot: string;
  readonly sourcePackagePath: string;
  readonly systemWorkspaceRoot?: string;
  readonly installedPackagePath: string;
  readonly packageId: string;
  readonly name: string;
  readonly version: string;
  readonly contentHash: ContentHash;
  readonly readiness: "ready" | "draft";
  readonly locked: boolean;
  readonly status: "installed" | "matched" | "updated";
  readonly installedAt: string;
  readonly installedReason: string;
}

export interface RuntimePackageInstallResult {
  readonly packagePath: string;
  readonly installPath: string;
  readonly status: RuntimePackageInstallRecord["status"];
  readonly contentHash: ContentHash;
}

function hashContent(content: string): ContentHash {
  return { algorithm: "sha256", value: createHash("sha256").update(content, "utf8").digest("hex") };
}

function sameHash(a: ContentHash, b: ContentHash): boolean {
  return a.algorithm === b.algorithm && a.value === b.value;
}

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
  const loaded = await loadPackageWithMetadata(store, workspace, pathOverride);
  return loaded.ok ? ok(loaded.value.pkg) : loaded;
}

export async function loadPackageWithMetadata(
  store: FileNativeStore,
  workspace: WorkspaceHandle,
  pathOverride?: string
): Promise<Result<LoadedAuthoringRuntimePackage>> {
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
    const normalized: AuthoringRuntimePackage = {
      ...parsed,
      storyModel: parsed.storyModel ?? defaultStoryModel,
      harness: parsed.harness ?? defaultHarness,
      coveragePolicy: parsed.coveragePolicy ?? defaultCoveragePolicy
    };
    return ok({ pkg: normalized, packagePath: path, contentHash: read.value.stat.contentHash ?? hashContent(read.value.content) });
  } catch (cause) {
    return domainErr({ module: "runtime-package", code: "schema_incompatible", message: "runtime package is not valid JSON", severity: "error", cause });
  }
}

async function existingPackageHash(
  store: FileNativeStore,
  workspace: WorkspaceHandle
): Promise<Result<ContentHash | undefined>> {
  const existing = await loadPackageWithMetadata(store, workspace);
  if (!existing.ok) {
    return existing.error.code === "package_unavailable" ? ok(undefined) : existing;
  }
  return ok(existing.value.contentHash);
}

export async function installRuntimePackage(
  store: FileNativeStore,
  workspace: WorkspaceHandle,
  loaded: LoadedAuthoringRuntimePackage,
  input: {
    readonly sourceWorkspaceRoot: string;
    readonly sourcePackagePath?: string;
    readonly systemWorkspaceRoot?: string;
    readonly allowUnlocked?: boolean;
    readonly acceptUpdate?: boolean;
    readonly reason?: string;
    readonly now?: () => string;
  }
): Promise<Result<RuntimePackageInstallResult>> {
  if ((!loaded.pkg.locked || loaded.pkg.validation.readiness !== "ready") && input.allowUnlocked !== true) {
    return domainErr({
      module: "runtime-package",
      code: "production_lock_violation",
      message: `refusing to install ${loaded.pkg.name}@${loaded.pkg.version}: package is not locked and ready (locked=${loaded.pkg.locked}, readiness=${loaded.pkg.validation.readiness}); pass --allow-unlocked only for local debugging`,
      severity: "error"
    });
  }
  const content = JSON.stringify(loaded.pkg, null, 2);
  const installedHash = hashContent(content);
  const currentHash = await existingPackageHash(store, workspace);
  if (!currentHash.ok) return currentHash;
  const status: RuntimePackageInstallRecord["status"] = currentHash.value === undefined
    ? "installed"
    : sameHash(currentHash.value, installedHash)
      ? "matched"
      : "updated";
  if (status === "updated" && input.acceptUpdate !== true) {
    return domainErr({
      module: "runtime-package",
      code: "production_lock_violation",
      message: `installed runtime package would change from ${currentHash.value?.value} to ${installedHash.value}; pass --accept-package-update to update ${PACKAGE_PATH}`,
      severity: "error"
    });
  }
  const wrotePackage = await store.writeTextAtomic(workspace, PACKAGE_PATH, content, {
    reason: "install copied hatch runtime package",
    createParents: true
  });
  if (!wrotePackage.ok) return wrotePackage;
  const record: RuntimePackageInstallRecord = {
    schemaVersion: "1.0.0",
    kind: "runtime_package_install",
    sourceWorkspaceRoot: input.sourceWorkspaceRoot,
    sourcePackagePath: input.sourcePackagePath ?? loaded.packagePath,
    ...(input.systemWorkspaceRoot === undefined ? {} : { systemWorkspaceRoot: input.systemWorkspaceRoot }),
    installedPackagePath: PACKAGE_PATH,
    packageId: loaded.pkg.packageId,
    name: loaded.pkg.name,
    version: loaded.pkg.version,
    contentHash: installedHash,
    readiness: loaded.pkg.validation.readiness,
    locked: loaded.pkg.locked,
    status,
    installedAt: (input.now ?? (() => new Date().toISOString()))(),
    installedReason: input.reason ?? "install runtime package"
  };
  const wroteRecord = await store.writeTextAtomic(workspace, RUNTIME_PACKAGE_INSTALL_PATH, JSON.stringify(record, null, 2), {
    reason: "write runtime package install record",
    createParents: true
  });
  if (!wroteRecord.ok) return wroteRecord;
  return ok({
    packagePath: PACKAGE_PATH,
    installPath: RUNTIME_PACKAGE_INSTALL_PATH,
    status,
    contentHash: installedHash
  });
}

export async function readRuntimePackageInstall(
  store: FileNativeStore,
  workspace: WorkspaceHandle
): Promise<Result<RuntimePackageInstallRecord | undefined>> {
  const read = await store.readText(workspace, RUNTIME_PACKAGE_INSTALL_PATH, { reason: "read runtime package install record", maxBytes: 256 * 1024 });
  if (!read.ok) return read.error.code === "not_found" ? ok(undefined) : read;
  try {
    const parsed = JSON.parse(read.value.content) as RuntimePackageInstallRecord;
    if (parsed.kind !== "runtime_package_install" || typeof parsed.sourceWorkspaceRoot !== "string") {
      return domainErr({ module: "runtime-package", code: "schema_incompatible", message: "runtime package install record is missing required fields", severity: "error" });
    }
    return ok(parsed);
  } catch (cause) {
    return domainErr({ module: "runtime-package", code: "schema_incompatible", message: "runtime package install record is not valid JSON", severity: "error", cause });
  }
}

export async function readRuntimePackageLock(
  store: FileNativeStore,
  workspace: WorkspaceHandle
): Promise<Result<RuntimePackageLock | undefined>> {
  const read = await store.readText(workspace, RUNTIME_PACKAGE_LOCK_PATH, { reason: "read runtime package lock", maxBytes: 256 * 1024 });
  if (!read.ok) return read.error.code === "not_found" ? ok(undefined) : read;
  try {
    return ok(JSON.parse(read.value.content) as RuntimePackageLock);
  } catch (cause) {
    return domainErr({ module: "runtime-package", code: "schema_incompatible", message: "runtime package lock is not valid JSON", severity: "error", cause });
  }
}

function lockFor(loaded: LoadedAuthoringRuntimePackage, reason: string): RuntimePackageLock {
  return {
    schemaVersion: "1.0.0",
    kind: "runtime_package_lock",
    packagePath: loaded.packagePath,
    packageId: loaded.pkg.packageId,
    name: loaded.pkg.name,
    version: loaded.pkg.version,
    contentHash: loaded.contentHash,
    readiness: loaded.pkg.validation.readiness,
    locked: loaded.pkg.locked,
    acceptedAt: new Date().toISOString(),
    acceptedReason: reason
  };
}

function lockMatches(loaded: LoadedAuthoringRuntimePackage, lock: RuntimePackageLock): boolean {
  return lock.packagePath === loaded.packagePath &&
    lock.packageId === loaded.pkg.packageId &&
    lock.name === loaded.pkg.name &&
    lock.version === loaded.pkg.version &&
    lock.contentHash.algorithm === loaded.contentHash.algorithm &&
    lock.contentHash.value === loaded.contentHash.value &&
    lock.locked === loaded.pkg.locked &&
    lock.readiness === loaded.pkg.validation.readiness;
}

async function writeRuntimePackageLock(
  store: FileNativeStore,
  workspace: WorkspaceHandle,
  loaded: LoadedAuthoringRuntimePackage,
  reason: string,
  status: RuntimePackageLockResult["status"]
): Promise<Result<RuntimePackageLockResult>> {
  const wrote = await store.writeTextAtomic(workspace, RUNTIME_PACKAGE_LOCK_PATH, JSON.stringify(lockFor(loaded, reason), null, 2), {
    reason: "write runtime package lock",
    createParents: true
  });
  return wrote.ok ? ok({ lockPath: RUNTIME_PACKAGE_LOCK_PATH, status }) : wrote;
}

export async function ensureRuntimePackageLock(
  store: FileNativeStore,
  workspace: WorkspaceHandle,
  loaded: LoadedAuthoringRuntimePackage,
  input: { readonly acceptUpdate: boolean; readonly reason: string }
): Promise<Result<RuntimePackageLockResult>> {
  const current = await readRuntimePackageLock(store, workspace);
  if (!current.ok) return current;
  if (current.value === undefined) {
    return writeRuntimePackageLock(store, workspace, loaded, input.reason, "created");
  }
  if (lockMatches(loaded, current.value)) return ok({ lockPath: RUNTIME_PACKAGE_LOCK_PATH, status: "matched" });
  if (!input.acceptUpdate) {
    return domainErr({
      module: "runtime-package",
      code: "production_lock_violation",
      message: `runtime package changed from ${current.value.name}@${current.value.version} (${current.value.contentHash.value}) to ${loaded.pkg.name}@${loaded.pkg.version} (${loaded.contentHash.value}); pass --accept-package-update to update ${RUNTIME_PACKAGE_LOCK_PATH}`,
      severity: "error"
    });
  }
  return writeRuntimePackageLock(store, workspace, loaded, input.reason, "updated");
}

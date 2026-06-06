import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { makeNonEmptyBrand } from "../domain/brand.js";
import { makeWorkspaceId } from "../domain/ids.js";
import { ok, type Result } from "../domain/result.js";
import { fileStoreErr, ioErr, isNodeNotFound } from "./errors.js";
import { stableWorkspaceFingerprint } from "./hash.js";
import type {
  OpenWorkspaceInput,
  ResolvePathOptions,
  ResolvedWorkspacePath,
  WorkspaceAbsolutePath,
  WorkspaceHandle,
  WorkspaceRelativePath,
  WorkspaceRoot
} from "./types.js";

export function asWorkspaceRoot(value: string): WorkspaceRoot {
  return makeNonEmptyBrand("WorkspaceRoot", value);
}

export function asWorkspaceRelativePath(value: string): WorkspaceRelativePath {
  return makeNonEmptyBrand("WorkspaceRelativePath", value);
}

export function asWorkspaceAbsolutePath(value: string): WorkspaceAbsolutePath {
  return makeNonEmptyBrand("WorkspaceAbsolutePath", value);
}

export async function openWorkspaceHandle(input: OpenWorkspaceInput): Promise<Result<WorkspaceHandle>> {
  if (input.root.trim().length === 0) {
    return fileStoreErr({ code: "invalid_input", message: "workspace root cannot be empty" });
  }

  try {
    const root = await realpath(path.resolve(input.root));
    const stat = await lstat(root);
    if (!stat.isDirectory()) {
      return fileStoreErr({ code: "invalid_input", message: "workspace root must be a directory" });
    }

    return ok({
      id: input.id ?? makeWorkspaceId(`workspace-${stableWorkspaceFingerprint(root)}`),
      root: asWorkspaceRoot(root),
      openedAt: new Date().toISOString()
    });
  } catch (error) {
    if (isNodeNotFound(error)) {
      return fileStoreErr({ code: "not_found", message: "workspace root does not exist", cause: error });
    }
    return ioErr("failed to open workspace", error);
  }
}

export async function resolveWorkspacePath(
  workspace: WorkspaceHandle,
  logicalPath: string,
  options: ResolvePathOptions = {}
): Promise<Result<ResolvedWorkspacePath>> {
  const normalized = normalizeLogicalPath(logicalPath, options.allowAbsolute ?? false, workspace.root);
  if (!normalized.ok) return normalized;

  const absolute = path.resolve(workspace.root, normalized.value);
  if (!containsPath(workspace.root, absolute)) {
    return fileStoreErr({ code: "path_escape_rejected", message: "path escapes workspace boundary" });
  }

  const canonical = await canonicalizeContained(workspace.root, absolute, options.rejectSymlinkEscape ?? true);
  if (!canonical.ok) return canonical;
  if (!canonical.value.exists && options.allowMissing !== true) {
    return fileStoreErr({ code: "not_found", message: `path does not exist: ${normalized.value}` });
  }

  return ok({
    workspaceId: workspace.id,
    logicalPath: asWorkspaceRelativePath(normalized.value),
    absolutePath: asWorkspaceAbsolutePath(canonical.value.absolutePath),
    exists: canonical.value.exists
  });
}

export function containsPath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeLogicalPath(
  input: string,
  allowAbsolute: boolean,
  workspaceRoot: string
): Result<string> {
  if (input.trim().length === 0) {
    return fileStoreErr({ code: "invalid_input", message: "logical path cannot be empty" });
  }
  if (input.includes("\0")) {
    return fileStoreErr({ code: "invalid_input", message: "logical path cannot contain null bytes" });
  }

  const absoluteLike = path.isAbsolute(input) || /^[A-Za-z]:[\\/]/.test(input);
  if (absoluteLike) {
    if (!allowAbsolute) {
      return fileStoreErr({ code: "path_escape_rejected", message: "absolute paths are rejected by default" });
    }
    const absolute = path.resolve(input);
    if (!containsPath(workspaceRoot, absolute)) {
      return fileStoreErr({ code: "path_escape_rejected", message: "absolute path escapes workspace" });
    }
    return ok(path.relative(workspaceRoot, absolute).replaceAll("\\", "/") || ".");
  }

  const slashPath = input.replaceAll("\\", "/");
  const normalized = path.posix.normalize(slashPath);
  if (normalized === ".." || normalized.startsWith("../")) {
    return fileStoreErr({ code: "path_escape_rejected", message: "path traversal is rejected" });
  }
  return ok(normalized);
}

async function canonicalizeContained(
  workspaceRoot: string,
  absolute: string,
  rejectSymlinkEscape: boolean
): Promise<Result<{ readonly absolutePath: string; readonly exists: boolean }>> {
  if (!rejectSymlinkEscape) return ok({ absolutePath: absolute, exists: await exists(absolute) });

  try {
    const canonical = await realpath(absolute);
    if (!containsPath(workspaceRoot, canonical)) {
      return fileStoreErr({ code: "symlink_escape_rejected", message: "symlink target escapes workspace" });
    }
    return ok({ absolutePath: canonical, exists: true });
  } catch (error) {
    if (!isNodeNotFound(error)) return ioErr("failed to resolve path", error);
  }

  const ancestor = await nearestExistingAncestor(workspaceRoot, absolute);
  if (!ancestor.ok) return ancestor;
  const canonicalAncestor = await realpath(ancestor.value);
  if (!containsPath(workspaceRoot, canonicalAncestor)) {
    return fileStoreErr({ code: "symlink_escape_rejected", message: "ancestor symlink escapes workspace" });
  }

  const suffix = path.relative(ancestor.value, absolute);
  return ok({ absolutePath: path.resolve(canonicalAncestor, suffix), exists: false });
}

async function nearestExistingAncestor(workspaceRoot: string, absolute: string): Promise<Result<string>> {
  let current = absolute;
  while (containsPath(workspaceRoot, current)) {
    if (await exists(current)) return ok(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return fileStoreErr({ code: "path_escape_rejected", message: "no contained ancestor exists" });
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (isNodeNotFound(error)) return false;
    throw error;
  }
}

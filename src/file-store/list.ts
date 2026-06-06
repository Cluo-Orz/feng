import path from "node:path";
import { readdir } from "node:fs/promises";
import { ok, type Result } from "../domain/result.js";
import { fileStoreErr, ioErr } from "./errors.js";
import { directoryEntry, fileStat, receipt } from "./metadata.js";
import { resolveWorkspacePath } from "./path.js";
import type { DirectoryEntry, DirectoryListing, ListDirectoryOptions, WorkspaceHandle } from "./types.js";

interface ListLimits {
  readonly maxDepth: number;
  readonly maxEntries: number;
}

interface QueueItem {
  readonly logicalPath: DirectoryListing["logicalPath"];
  readonly absolutePath: string;
  readonly depth: number;
}

export async function listDirectory(
  workspace: WorkspaceHandle,
  logicalPath: string,
  options: ListDirectoryOptions
): Promise<Result<DirectoryListing>> {
  const resolved = await resolveWorkspacePath(workspace, logicalPath);
  if (!resolved.ok) return resolved;
  const statResult = await fileStat(workspace, resolved.value, false);
  if (!statResult.ok) return statResult;
  if (statResult.value.kind !== "directory") {
    return fileStoreErr({ code: "invalid_input", message: "path is not a directory" });
  }
  const limits = listLimits(options);
  if (!limits.ok) return limits;

  const entries: DirectoryEntry[] = [];
  const queue: QueueItem[] = [
    { logicalPath: resolved.value.logicalPath, absolutePath: resolved.value.absolutePath, depth: 1 }
  ];
  let truncated = false;

  while (queue.length > 0 && !truncated) {
    const current = queue.shift()!;
    const names = await sortedNames(current.absolutePath);
    if (!names.ok) return names;
    for (const name of names.value) {
      if (entries.length >= limits.value.maxEntries) {
        truncated = true;
        break;
      }
      const entry = await directoryEntry(
        workspace,
        current.logicalPath,
        current.absolutePath,
        name,
        options.includeContentHash ?? false
      );
      if (!entry.ok) return entry;
      entries.push(entry.value);
      if (options.recursive && entry.value.kind === "directory" && current.depth < limits.value.maxDepth) {
        queue.push({
          logicalPath: entry.value.logicalPath,
          absolutePath: path.join(current.absolutePath, name),
          depth: current.depth + 1
        });
      }
    }
  }

  return ok({
    logicalPath: resolved.value.logicalPath,
    entries,
    truncated,
    receipt: {
      ...receipt(workspace, resolved.value.logicalPath, "list_directory", options),
      entriesRead: entries.length,
      truncated
    }
  });
}

function listLimits(options: ListDirectoryOptions): Result<ListLimits> {
  const maxEntries = options.maxEntries ?? 2_000;
  if (maxEntries < 1) return fileStoreErr({ code: "invalid_input", message: "maxEntries must be positive" });
  if (!options.recursive) return ok({ maxDepth: 1, maxEntries });
  if (options.maxDepth === undefined || options.maxDepth < 1) {
    return fileStoreErr({ code: "invalid_input", message: "recursive listing requires positive maxDepth" });
  }
  if (options.maxEntries === undefined) {
    return fileStoreErr({ code: "invalid_input", message: "recursive listing requires maxEntries" });
  }
  return ok({ maxDepth: options.maxDepth, maxEntries });
}

async function sortedNames(absolutePath: string): Promise<Result<string[]>> {
  try {
    return ok((await readdir(absolutePath)).sort());
  } catch (error) {
    return ioErr("failed to list directory", error);
  }
}

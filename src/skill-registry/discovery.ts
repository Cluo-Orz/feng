import path from "node:path";
import { ok, type Result } from "../domain/result.js";
import type { FileNativeStore, WorkspaceHandle } from "../file-store/index.js";
import { skillErr } from "./errors.js";
import type { DiscoveredSkillSummary, SkillDiscoveryScope } from "./types.js";

export async function discoverSkillFiles(
  store: FileNativeStore,
  workspace: WorkspaceHandle,
  scope: SkillDiscoveryScope
): Promise<Result<{ readonly discovered: readonly DiscoveredSkillSummary[]; readonly ignored: readonly string[] }>> {
  const discovered: DiscoveredSkillSummary[] = [];
  const ignored: string[] = [];
  for (const root of scope.searchPaths) {
    const listing = await store.listDirectory(workspace, root, {
      reason: "discover skills",
      recursive: true,
      maxDepth: scope.maxDepth ?? 4,
      maxEntries: 500
    });
    if (!listing.ok) {
      ignored.push(root);
      continue;
    }
    for (const entry of listing.value.entries) {
      if (entry.kind !== "file" || !looksLikeSkillFile(entry.logicalPath)) continue;
      const read = await store.readText(workspace, entry.logicalPath, {
        reason: "read discovered skill",
        maxBytes: 256 * 1024
      });
      if (!read.ok) {
        ignored.push(entry.logicalPath);
        continue;
      }
      const parsed = parseSkillMarkdown(entry.logicalPath, read.value.content, scope.sourceKind ?? "workspace_local");
      parsed.ok ? discovered.push(parsed.value) : ignored.push(entry.logicalPath);
    }
  }
  return ok({ discovered, ignored });
}

export function parseSkillMarkdown(
  logicalPath: string,
  content: string,
  sourceKind: DiscoveredSkillSummary["sourceKind"]
): Result<DiscoveredSkillSummary> {
  const parsed = parseFrontmatter(content);
  const name = parsed.frontmatter.name ?? inferName(logicalPath);
  const description = parsed.frontmatter.description ?? firstParagraph(parsed.body);
  if (name.trim().length === 0 || description.trim().length === 0) {
    return skillErr({ code: "schema_incompatible", message: "skill markdown requires name and description" });
  }
  return ok({
    logicalPath,
    name,
    description,
    version: { schemaVersion: parsed.frontmatter.version ?? "1" },
    sourceKind
  });
}

function looksLikeSkillFile(logicalPath: string): boolean {
  const name = path.posix.basename(String(logicalPath));
  return name === "SKILL.md" || name.endsWith(".skill.md");
}

function inferName(logicalPath: string): string {
  const base = path.posix.basename(String(logicalPath), ".md");
  return base === "SKILL" ? path.posix.basename(path.posix.dirname(String(logicalPath))) : base.replace(/\.skill$/, "");
}

function firstParagraph(content: string): string {
  return content
    .split(/\r?\n\r?\n/)
    .map((item) => item.replace(/^#+\s*/g, "").trim())
    .find((item) => item.length > 0) ?? "";
}

function parseFrontmatter(content: string): { readonly frontmatter: Record<string, string>; readonly body: string } {
  if (!content.startsWith("---")) return { frontmatter: {}, body: content };
  const end = content.indexOf("\n---", 3);
  if (end < 0) return { frontmatter: {}, body: content };
  const raw = content.slice(3, end).trim();
  const frontmatter: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index < 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key.length > 0) frontmatter[key] = value;
  }
  return { frontmatter, body: content.slice(end + 4) };
}

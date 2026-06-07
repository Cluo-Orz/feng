import { ok, type Result } from "../domain/result.js";
import { domainErr } from "../domain/index.js";
import type { FileNativeStore, WorkspaceHandle } from "../file-store/index.js";

// The work project (libai) provides these facts; the runtime reads them.
export interface ProjectConfig {
  readonly premise: string;
  readonly title: string;
  readonly characterBible?: string;
  readonly worldBible?: string;
  readonly establishedYear?: number;
  readonly establishedCharacters?: readonly string[];
  readonly conflictTerms?: readonly string[];
  readonly chapterGoals?: readonly string[];
}

export interface RuntimeChapterRecord {
  readonly number: number;
  readonly outline: string;
  readonly chapterPath: string;
  readonly chars: number;
  readonly qualityPassed: boolean;
  readonly issueCount: number;
}

export interface RuntimeNovelState {
  readonly premise: string;
  readonly title: string;
  readonly chapters: readonly RuntimeChapterRecord[];
}

export const PROJECT_PATH = ".feng/runtime/project.json";
export const STATE_PATH = ".feng/runtime/novel-state.json";

export const chapterDir = (n: number): string => `.feng/runtime/chapters/chapter-${String(n).padStart(2, "0")}`;
export const chapterFilePath = (n: number): string => `chapters/chapter-${String(n).padStart(2, "0")}.md`;

export interface ParsedChapter {
  readonly chapter: string;
  readonly outline: string;
}

export function parseChapterOutput(raw: string, chapterNumber: number): ParsedChapter {
  const marker = "===OUTLINE===";
  const idx = raw.indexOf(marker);
  if (idx === -1) {
    const flat = raw.trim().replace(/\s+/g, "");
    return { chapter: raw.trim(), outline: `第${chapterNumber}章：${flat.slice(0, 50)}` };
  }
  const chapter = raw.slice(0, idx).trim();
  const outline = raw.slice(idx + marker.length).trim();
  const flat = chapter.replace(/\s+/g, "");
  return { chapter, outline: outline.length === 0 ? `第${chapterNumber}章：${flat.slice(0, 50)}` : outline };
}

async function readJson<T>(store: FileNativeStore, workspace: WorkspaceHandle, path: string): Promise<Result<T | undefined>> {
  const read = await store.readText(workspace, path, { reason: `read ${path}`, maxBytes: 1024 * 1024 });
  if (!read.ok) return read.error.code === "not_found" ? ok(undefined) : read;
  try {
    return ok(JSON.parse(read.value.content) as T);
  } catch (cause) {
    return domainErr({ module: "authoring-runtime", code: "schema_incompatible", message: `invalid json at ${path}`, severity: "error", cause });
  }
}

export function readProjectConfig(store: FileNativeStore, workspace: WorkspaceHandle): Promise<Result<ProjectConfig | undefined>> {
  return readJson<ProjectConfig>(store, workspace, PROJECT_PATH);
}

export function readNovelState(store: FileNativeStore, workspace: WorkspaceHandle): Promise<Result<RuntimeNovelState | undefined>> {
  return readJson<RuntimeNovelState>(store, workspace, STATE_PATH);
}

export function writeJsonFile(
  store: FileNativeStore,
  workspace: WorkspaceHandle,
  path: string,
  value: unknown,
  reason: string
): Promise<Result<{ readonly bytesWritten: number }>> {
  return store.writeTextAtomic(workspace, path, JSON.stringify(value, null, 2), { reason, createParents: true }) as Promise<Result<{ readonly bytesWritten: number }>>;
}

export function writeTextFile(
  store: FileNativeStore,
  workspace: WorkspaceHandle,
  path: string,
  content: string,
  reason: string
): Promise<Result<{ readonly bytesWritten: number }>> {
  return store.writeTextAtomic(workspace, path, content, { reason, createParents: true }) as Promise<Result<{ readonly bytesWritten: number }>>;
}

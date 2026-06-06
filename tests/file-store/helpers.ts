import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { expect } from "vitest";
import { createNodeFileNativeStore, type FileNativeStore, type WorkspaceHandle } from "../../src/file-store/index.js";

export interface TempWorkspace {
  readonly root: string;
  readonly store: FileNativeStore;
  readonly workspace: WorkspaceHandle;
}

export async function withWorkspace(testBody: (workspace: TempWorkspace) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "feng-file-store-"));
  const store = createNodeFileNativeStore({ defaultMaxReadBytes: 64 });
  try {
    const opened = await store.openWorkspace({ root });
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error(opened.error.message);
    await testBody({ root, store, workspace: opened.value });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

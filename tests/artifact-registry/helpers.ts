import {
  createArtifactRegistry,
  type ArtifactRegistry,
  type RegisterArtifactInput
} from "../../src/artifact-registry/index.js";
import { createEventLedger } from "../../src/event-ledger/index.js";
import type { VersionDescriptor } from "../../src/domain/index.js";
import { audit, source } from "../event-ledger/helpers.js";
import type { TempWorkspace } from "../file-store/helpers.js";

export interface ArtifactFixture extends TempWorkspace {
  readonly registry: ArtifactRegistry;
}

export function makeArtifactFixture(workspace: TempWorkspace): ArtifactFixture {
  const ledger = createEventLedger(workspace.store, {
    workspace: workspace.workspace,
    producer: "artifact-registry-test"
  });
  return {
    ...workspace,
    registry: createArtifactRegistry(workspace.store, {
      workspace: workspace.workspace,
      ledger,
      producer: "artifact-registry-test",
      defaultPreviewChars: 12
    })
  };
}

export const version: VersionDescriptor = {
  schemaVersion: "1",
  producerVersion: "test"
};

export function textArtifact(workspace: TempWorkspace, content = "hello artifact"): RegisterArtifactInput {
  return {
    kind: "source_material",
    content,
    mediaType: "text/plain",
    encoding: "utf8",
    source: source(workspace.workspace),
    version,
    audit: audit("register artifact"),
    privacyClass: "workspace_private",
    retentionClass: "grow_scoped",
    producerModule: "human"
  };
}

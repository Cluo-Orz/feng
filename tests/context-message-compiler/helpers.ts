import {
  createContextMessageCompiler,
  type ContextMessageCompiler,
  type ContextCompileInput
} from "../../src/context-message-compiler/index.js";
import type { AgendaFixture } from "../agenda-dod-manager/helpers.js";
import {
  audit,
  makeAgendaFixture,
  source,
  version
} from "../agenda-dod-manager/helpers.js";
import type { TempWorkspace } from "../file-store/helpers.js";
import type { GrowUnitRef } from "../../src/domain/index.js";

export interface ContextFixture extends AgendaFixture {
  readonly context: ContextMessageCompiler;
}

export function makeContextFixture(workspace: TempWorkspace): ContextFixture {
  const fixture = makeAgendaFixture(workspace);
  return {
    ...fixture,
    context: createContextMessageCompiler(workspace.store, {
      workspace: workspace.workspace,
      ledger: fixture.ledger,
      artifactRegistry: fixture.artifacts,
      policyBoundary: fixture.policy,
      skillRegistry: fixture.skills,
      growUnitManager: fixture.grow,
      admissionInbox: fixture.admission,
      agendaDoDManager: fixture.agenda,
      producer: "context-test",
      defaultBudgetTokens: 2_000
    })
  };
}

export function compileInput(
  fixture: ContextFixture,
  growUnitRef: GrowUnitRef,
  extra: Partial<ContextCompileInput> = {}
): ContextCompileInput {
  return {
    growUnitRef,
    compileReason: "compile next grow attempt",
    source: source(fixture, "system"),
    version,
    audit: audit("compile context"),
    ...extra
  };
}

export function parseArtifactJson<T>(content: string | Uint8Array | undefined): T {
  if (typeof content !== "string") throw new Error("expected utf8 artifact content");
  return JSON.parse(content) as T;
}

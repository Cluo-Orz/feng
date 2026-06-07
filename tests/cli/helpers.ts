import { createContextMessageCompiler } from "../../src/context-message-compiler/index.js";
import { createLLMGateway } from "../../src/llm-gateway/index.js";
import { createGrowAttemptRunner } from "../../src/grow-attempt-runner/index.js";
import { createFengCli, type FengCli } from "../../src/cli/index.js";
import type { CLIPorts } from "../../src/cli/index.js";
import type { TempWorkspace } from "../file-store/helpers.js";
import { makeBridgeFixture, type BridgeFixture } from "../debug-feedback-bridge/helpers.js";

export interface CliFixture extends BridgeFixture {
  readonly cli: FengCli;
  readonly ports: CLIPorts;
}

export function makeCliFixture(workspace: TempWorkspace): CliFixture {
  const fixture = makeBridgeFixture(workspace);
  const context = createContextMessageCompiler(fixture.store, {
    workspace: fixture.workspace,
    ledger: fixture.ledger,
    artifactRegistry: fixture.artifacts,
    policyBoundary: fixture.policy,
    skillRegistry: fixture.skills,
    growUnitManager: fixture.grow,
    admissionInbox: fixture.admission,
    agendaDoDManager: fixture.agenda,
    producer: "cli-test",
    defaultBudgetTokens: 2_000
  });
  const llm = createLLMGateway({
    workspace: fixture.workspace,
    ledger: fixture.ledger,
    artifactRegistry: fixture.artifacts,
    policyBoundary: fixture.policy,
    producer: "cli-test",
    adapters: []
  });
  const runner = createGrowAttemptRunner({
    workspace: fixture.workspace,
    store: fixture.store,
    ledger: fixture.ledger,
    artifactRegistry: fixture.artifacts,
    policyBoundary: fixture.policy,
    growUnitManager: fixture.grow,
    admissionInbox: fixture.admission,
    agendaDoDManager: fixture.agenda,
    contextCompiler: context,
    llmGateway: llm,
    toolRuntime: fixture.toolRuntime,
    producer: "cli-test"
  });
  const ports: CLIPorts = {
    store: fixture.store,
    ledger: fixture.ledger,
    artifactRegistry: fixture.artifacts,
    policyBoundary: fixture.policy,
    skillRegistry: fixture.skills,
    growUnitManager: fixture.grow,
    admissionInbox: fixture.admission,
    agendaManager: fixture.agenda,
    evidenceReadiness: fixture.evidence,
    attemptRunner: runner,
    hatchBuilder: fixture.hatch,
    agentRuntimeKernel: fixture.agentRuntime,
    debugFeedbackBridge: fixture.bridge
  };
  return {
    ...fixture,
    ports,
    cli: createFengCli({ ports, producer: "cli-test" }, fixture.root)
  };
}

export async function expectEnvelope(fixture: CliFixture, argv: readonly string[]) {
  const result = await fixture.cli.run(argv);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

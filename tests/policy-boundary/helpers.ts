import {
  createPolicyBoundary,
  makePolicyRequestId,
  type ActionRequest,
  type PolicyBoundary,
  type PolicyContext
} from "../../src/policy-boundary/index.js";
import { createArtifactRegistry, type ArtifactRegistry } from "../../src/artifact-registry/index.js";
import { createEventLedger, type EventLedger } from "../../src/event-ledger/index.js";
import type { TempWorkspace } from "../file-store/helpers.js";
import { audit, source } from "../event-ledger/helpers.js";

export interface PolicyFixture extends TempWorkspace {
  readonly ledger: EventLedger;
  readonly registry: ArtifactRegistry;
  readonly policy: PolicyBoundary;
}

let requestSequence = 0;

export function makePolicyFixture(workspace: TempWorkspace): PolicyFixture {
  const ledger = createEventLedger(workspace.store, {
    workspace: workspace.workspace,
    producer: "policy-test"
  });
  const registry = createArtifactRegistry(workspace.store, {
    workspace: workspace.workspace,
    ledger,
    producer: "policy-test"
  });
  return {
    ...workspace,
    ledger,
    registry,
    policy: createPolicyBoundary({ ledger, artifactRegistry: registry, producer: "policy-test" })
  };
}

export function actionRequest(
  fixture: PolicyFixture,
  capability: string,
  extra: Partial<ActionRequest> = {}
): ActionRequest {
  requestSequence += 1;
  return {
    requestId: makePolicyRequestId(`request-${requestSequence}`),
    capability,
    requestedByModule: "tool-runtime",
    workspace: fixture.workspace.id,
    resourceSummary: capability === "command.run" ? "npm test" : "docs/idea.md",
    operation: "execute",
    reason: "unit test policy decision",
    source: source(fixture.workspace),
    ...extra
  };
}

export function policyContext(extra: Partial<PolicyContext> = {}): PolicyContext {
  return {
    caller: "tool-runtime",
    environment: {
      hostSandboxAvailable: true,
      networkAvailable: true,
      externalEnforcementAvailable: true,
      secretStoreAvailable: true
    },
    ...extra
  };
}

export const approvalInput = {
  approvedBy: "developer",
  reason: "test approval",
  constraints: ["approved for this request only"],
  source: {
    kind: "user" as const,
    origin: "policy-test",
    userProvided: true,
    receivedAt: "2026-06-06T00:00:00.000Z",
    privacyLevel: "workspace_private" as const
  },
  audit: audit("approve policy request")
};

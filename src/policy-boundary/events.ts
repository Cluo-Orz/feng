import { makeLedgerStreamId, type LedgerStream } from "../event-ledger/index.js";

export const policyStream: LedgerStream = {
  streamType: "policy",
  streamId: makeLedgerStreamId("policy")
};

export const policyEventTypes = {
  decisionRecorded: "policy_decision_recorded",
  approvalRecorded: "approval_recorded",
  grantCreated: "capability_grant_created",
  grantRevoked: "capability_grant_revoked",
  boundaryDeclared: "policy_boundary_declared",
  decisionSuperseded: "policy_decision_superseded"
} as const;

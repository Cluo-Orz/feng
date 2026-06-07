import type { AuditDescriptor, SourceDescriptor } from "../domain/index.js";
import type { Result } from "../domain/result.js";
import type { EventAppendReceipt } from "../event-ledger/index.js";
import type { WorkspaceHandle, WriteReceipt } from "../file-store/index.js";
import type { CLIInvocationId } from "./brand.js";

export const cliCommandFamilies = [
  "workspace",
  "grow",
  "input",
  "status",
  "explain",
  "attempt",
  "readiness",
  "hatch",
  "runtime",
  "debug",
  "feedback",
  "policy",
  "artifact",
  "skill"
] as const;
export type CLICommandFamily = (typeof cliCommandFamilies)[number];

export const cliRequestedModes = [
  "normal",
  "dry_run",
  "debug",
  "replay",
  "explain_only",
  "machine_readable"
] as const;
export type CLIRequestedMode = (typeof cliRequestedModes)[number];

export const cliApprovalModes = ["never", "ask", "preapproved_scope", "explain_only"] as const;
export type CLIApprovalMode = (typeof cliApprovalModes)[number];

export const cliDisplayModes = ["human_summary", "json", "quiet", "verbose", "source_refs"] as const;
export type CLIDisplayMode = (typeof cliDisplayModes)[number];

export const cliExitStatuses = [
  "succeeded",
  "succeeded_with_warnings",
  "waiting_input",
  "waiting_approval",
  "blocked_by_policy",
  "blocked_by_privacy",
  "blocked_by_readiness",
  "unsupported",
  "failed",
  "interrupted"
] as const;
export type CLIExitStatus = (typeof cliExitStatuses)[number];

export const cliNextActionKinds = [
  "run_command",
  "provide_input",
  "request_approval",
  "inspect_ref",
  "wait"
] as const;
export type CLINextActionKind = (typeof cliNextActionKinds)[number];

export interface CLINextAction {
  readonly kind: CLINextActionKind;
  readonly summary: string;
  readonly command?: string;
}

export interface CLIRefView {
  readonly label: string;
  readonly ref: string;
  readonly uri?: string;
}

export interface CLICommandIntent {
  readonly raw: readonly string[];
  readonly family: CLICommandFamily;
  readonly action: string;
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string>>;
  readonly requestedMode: CLIRequestedMode;
  readonly approvalMode: CLIApprovalMode;
  readonly displayMode: CLIDisplayMode;
  readonly workspaceRoot: string;
}

export interface CLIExecutionContext {
  readonly invocationId: CLIInvocationId;
  readonly intent: CLICommandIntent;
  readonly workspace: WorkspaceHandle;
  readonly startedAt: string;
}

export interface CLIHandlerResult {
  readonly exitStatus: CLIExitStatus;
  readonly headline: string;
  readonly facts: readonly string[];
  readonly refs: readonly CLIRefView[];
  readonly warnings: readonly string[];
  readonly nextActions: readonly CLINextAction[];
  readonly data?: Record<string, unknown>;
}

export interface CLIOutputEnvelope {
  readonly invocationId: CLIInvocationId;
  readonly family: CLICommandFamily;
  readonly action: string;
  readonly exitStatus: CLIExitStatus;
  readonly displayMode: CLIDisplayMode;
  readonly headline: string;
  readonly facts: readonly string[];
  readonly refs: readonly CLIRefView[];
  readonly warnings: readonly string[];
  readonly nextActions: readonly CLINextAction[];
  readonly data?: Record<string, unknown>;
  readonly rendered: string;
  readonly exitCode: number;
}

export interface CLIInvocationReceipt {
  readonly invocationId: CLIInvocationId;
  readonly family: CLICommandFamily;
  readonly action: string;
  readonly exitStatus: CLIExitStatus;
  readonly requestedMode: CLIRequestedMode;
  readonly approvalMode: CLIApprovalMode;
  readonly displayMode: CLIDisplayMode;
  readonly workspace: string;
  readonly headline: string;
  readonly warnings: readonly string[];
  readonly refs: readonly CLIRefView[];
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly recordVersion: number;
  readonly source: SourceDescriptor;
  readonly audit: AuditDescriptor;
}

export interface CLIInvocationIndex {
  readonly invocationIds: readonly string[];
}

export interface FengCli {
  readonly run: (argv: readonly string[]) => Promise<Result<CLIOutputEnvelope>>;
  readonly getInvocationReceipt: (id: CLIInvocationId) => Promise<Result<CLIInvocationReceipt>>;
  readonly listInvocations: () => Promise<Result<readonly CLIInvocationReceipt[]>>;
}

export interface CLIPersistResult {
  readonly eventReceipt?: EventAppendReceipt;
  readonly recordWriteReceipt?: WriteReceipt;
}

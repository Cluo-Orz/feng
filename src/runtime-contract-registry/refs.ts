import { makeRuntimeContractId, makeRef, type RuntimeContractRef } from "../domain/index.js";
import type {
  ActionBoundaryId,
  ActionBoundaryRef,
  CompatibilityId,
  CompatibilityRef,
  ContractReportId,
  ContractReportRef,
  DebugContractId,
  DebugContractRef,
  FailureContractId,
  FailureContractRef,
  FeedbackContractId,
  FeedbackContractRef,
  InputContractId,
  InputContractRef,
  ObservabilityContractId,
  ObservabilityContractRef,
  OutputContractId,
  OutputContractRef
} from "./types.js";

export const makeRuntimeContractRef = (value: string): RuntimeContractRef =>
  makeRef("runtime_contract", makeRuntimeContractId(value), { uri: `runtime-contract://${value}` });
export const inputRef = (id: InputContractId): InputContractRef => ({ kind: "input_contract", id, uri: `input-contract://${id}` });
export const outputRef = (id: OutputContractId): OutputContractRef => ({ kind: "output_contract", id, uri: `output-contract://${id}` });
export const actionBoundaryRef = (id: ActionBoundaryId): ActionBoundaryRef => ({ kind: "action_boundary", id, uri: `action-boundary://${id}` });
export const debugRef = (id: DebugContractId): DebugContractRef => ({ kind: "debug_contract", id, uri: `debug-contract://${id}` });
export const feedbackRef = (id: FeedbackContractId): FeedbackContractRef => ({ kind: "feedback_contract", id, uri: `feedback-contract://${id}` });
export const failureRef = (id: FailureContractId): FailureContractRef => ({ kind: "failure_contract", id, uri: `failure-contract://${id}` });
export const observabilityRef = (id: ObservabilityContractId): ObservabilityContractRef => ({ kind: "observability_contract", id, uri: `observability-contract://${id}` });
export const compatibilityRef = (id: CompatibilityId): CompatibilityRef => ({ kind: "version_compatibility", id, uri: `version-compatibility://${id}` });
export const reportRef = (id: ContractReportId): ContractReportRef => ({ kind: "contract_report", id, uri: `contract-report://${id}` });

import { makeNonEmptyBrand } from "../domain/brand.js";
import type {
  ActionBoundaryId,
  CompatibilityId,
  ContractReportId,
  DebugContractId,
  FailureContractId,
  FeedbackContractId,
  InputContractId,
  ObservabilityContractId,
  OutputContractId
} from "./types.js";

export const makeInputContractId = (value: string): InputContractId => makeNonEmptyBrand("InputContractId", value);
export const makeOutputContractId = (value: string): OutputContractId => makeNonEmptyBrand("OutputContractId", value);
export const makeActionBoundaryId = (value: string): ActionBoundaryId => makeNonEmptyBrand("ActionBoundaryId", value);
export const makeDebugContractId = (value: string): DebugContractId => makeNonEmptyBrand("DebugContractId", value);
export const makeFeedbackContractId = (value: string): FeedbackContractId => makeNonEmptyBrand("FeedbackContractId", value);
export const makeFailureContractId = (value: string): FailureContractId => makeNonEmptyBrand("FailureContractId", value);
export const makeObservabilityContractId = (value: string): ObservabilityContractId =>
  makeNonEmptyBrand("ObservabilityContractId", value);
export const makeCompatibilityId = (value: string): CompatibilityId => makeNonEmptyBrand("CompatibilityId", value);
export const makeContractReportId = (value: string): ContractReportId => makeNonEmptyBrand("ContractReportId", value);

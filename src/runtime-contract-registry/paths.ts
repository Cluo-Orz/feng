import type { ContractReportId } from "./types.js";
import type { RuntimeContractRef } from "../domain/index.js";

const root = ".feng/runtime-contracts";

export const runtimeContractIndexPath = `${root}/index.json`;
export const runtimeContractRecordPath = (ref: RuntimeContractRef): string => `${root}/records/${ref.id}.json`;
export const contractReportPath = (id: ContractReportId): string => `${root}/reports/${id}.json`;

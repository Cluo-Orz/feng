import type { TargetWorldId } from "../domain/index.js";
import type {
  TargetActionRequestId,
  TargetDebugSignalId,
  TargetFailureMappingId,
  TargetValidationReportId,
  TargetWorldAdapterId,
  TargetWorldCompatibilityReportId,
  WorldInputId,
  WorldOutputId
} from "./brand.js";

const root = ".feng/target-world-adapter";

const enc = (value: string): string => encodeURIComponent(value).replaceAll("%", "~");

export const targetWorldIndexPath = `${root}/worlds/index.json`;
export const adapterIndexPath = `${root}/adapters/index.json`;
export const compatibilityIndexPath = `${root}/compatibility/index.json`;
export const worldInputIndexPath = `${root}/world-inputs/index.json`;
export const worldOutputIndexPath = `${root}/world-outputs/index.json`;
export const targetActionIndexPath = `${root}/actions/index.json`;
export const validationIndexPath = `${root}/validations/index.json`;
export const failureMappingIndexPath = `${root}/failures/index.json`;
export const debugSignalIndexPath = `${root}/debug-signals/index.json`;

export const targetWorldPath = (id: TargetWorldId): string => `${root}/worlds/${enc(id)}.json`;
export const adapterPath = (id: TargetWorldAdapterId): string => `${root}/adapters/${enc(id)}.json`;
export const compatibilityPath = (id: TargetWorldCompatibilityReportId): string => `${root}/compatibility/${enc(id)}.json`;
export const worldInputPath = (id: WorldInputId): string => `${root}/world-inputs/${enc(id)}.json`;
export const worldOutputPath = (id: WorldOutputId): string => `${root}/world-outputs/${enc(id)}.json`;
export const targetActionPath = (id: TargetActionRequestId): string => `${root}/actions/${enc(id)}.json`;
export const validationPath = (id: TargetValidationReportId): string => `${root}/validations/${enc(id)}.json`;
export const failureMappingPath = (id: TargetFailureMappingId): string => `${root}/failures/${enc(id)}.json`;
export const debugSignalPath = (id: TargetDebugSignalId): string => `${root}/debug-signals/${enc(id)}.json`;

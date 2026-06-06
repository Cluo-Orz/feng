import type { ToolId } from "../domain/index.js";
import type {
  ToolExecutionId,
  ToolInputValidationId,
  ToolSettlementId,
  ToolSurfaceId
} from "./types.js";

export const toolIndexPath = ".feng/tools/index.json";

export function toolRecordPath(toolId: ToolId): string {
  return `.feng/tools/records/${toolId}.json`;
}

export function toolSurfacePath(surfaceId: ToolSurfaceId): string {
  return `.feng/tools/surfaces/${surfaceId}.json`;
}

export function toolValidationPath(validationId: ToolInputValidationId): string {
  return `.feng/tools/validations/${validationId}.json`;
}

export function toolExecutionReceiptPath(executionId: ToolExecutionId): string {
  return `.feng/tools/executions/${executionId}.json`;
}

export function toolSettlementPath(settlementId: ToolSettlementId): string {
  return `.feng/tools/settlements/${settlementId}.json`;
}

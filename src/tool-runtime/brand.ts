import { makeNonEmptyBrand } from "../domain/brand.js";
import type {
  ToolCallId,
  ToolExecutionId,
  ToolInputValidationId,
  ToolSettlementId,
  ToolSurfaceId
} from "./types.js";

export const makeToolCallId = (value: string): ToolCallId =>
  makeNonEmptyBrand("ToolCallId", value);

export const makeToolSurfaceId = (value: string): ToolSurfaceId =>
  makeNonEmptyBrand("ToolSurfaceId", value);

export const makeToolInputValidationId = (value: string): ToolInputValidationId =>
  makeNonEmptyBrand("ToolInputValidationId", value);

export const makeToolExecutionId = (value: string): ToolExecutionId =>
  makeNonEmptyBrand("ToolExecutionId", value);

export const makeToolSettlementId = (value: string): ToolSettlementId =>
  makeNonEmptyBrand("ToolSettlementId", value);

import { ok, type Result } from "../domain/result.js";
import type { ArtifactRef, ToolRef } from "../domain/index.js";
import type { FileNativeStore, WorkspaceHandle, WriteReceipt } from "../file-store/index.js";
import { toolRuntimeErr } from "./errors.js";
import {
  toolExecutionReceiptPath,
  toolIndexPath,
  toolRecordPath,
  toolSettlementPath,
  toolSurfacePath,
  toolValidationPath
} from "./paths.js";
import type {
  ToolDefinition,
  ToolExecutionId,
  ToolExecutionReceipt,
  ToolInputValidation,
  ToolInputValidationId,
  ToolRegistryIndex,
  ToolSettlement,
  ToolSettlementId,
  ToolSurfaceId,
  ToolSurfaceSummary
} from "./types.js";

export class ToolRuntimeStorage {
  constructor(
    private readonly store: FileNativeStore,
    private readonly workspace: WorkspaceHandle
  ) {}

  async readTool(toolRef: ToolRef): Promise<Result<ToolDefinition>> {
    const read = await this.store.readText(this.workspace, toolRecordPath(toolRef.id), {
      reason: "read tool record",
      maxBytes: 512 * 1024
    });
    if (!read.ok) return read.error.code === "not_found" ? toolRuntimeErr({ code: "not_found", message: "tool not found" }) : read;
    return parseJson<ToolDefinition>(read.value.content, "tool record is invalid JSON");
  }

  async writeTool(record: ToolDefinition): Promise<Result<WriteReceipt>> {
    return this.store.writeTextAtomic(this.workspace, toolRecordPath(record.toolId), JSON.stringify(record, null, 2), {
      reason: "write tool record",
      createParents: true
    });
  }

  async addToolToIndex(toolRef: ToolRef): Promise<Result<WriteReceipt>> {
    const index = await this.readIndex();
    if (!index.ok) return index;
    const refs = index.value.toolRefs.some((ref) => ref.id === toolRef.id)
      ? index.value.toolRefs
      : [...index.value.toolRefs, toolRef];
    return this.store.writeTextAtomic(this.workspace, toolIndexPath, JSON.stringify({ toolRefs: refs }, null, 2), {
      reason: "write tool index",
      createParents: true
    });
  }

  async readAllTools(): Promise<Result<readonly ToolDefinition[]>> {
    const index = await this.readIndex();
    if (!index.ok) return index;
    const records: ToolDefinition[] = [];
    for (const ref of index.value.toolRefs) {
      const record = await this.readTool(ref);
      if (record.ok) {
        records.push(record.value);
        continue;
      }
      if (record.error.code !== "not_found") return record;
    }
    return ok(records);
  }

  async writeSurface(surface: ToolSurfaceSummary): Promise<Result<WriteReceipt>> {
    return this.store.writeTextAtomic(
      this.workspace,
      toolSurfacePath(surface.surfaceId),
      JSON.stringify(surface, null, 2),
      { reason: "write tool surface", createParents: true }
    );
  }

  async writeValidation(validation: ToolInputValidation): Promise<Result<WriteReceipt>> {
    return this.store.writeTextAtomic(
      this.workspace,
      toolValidationPath(validation.validationId),
      JSON.stringify(validation, null, 2),
      { reason: "write tool input validation", createParents: true }
    );
  }

  async readValidation(validationId: ToolInputValidationId): Promise<Result<ToolInputValidation>> {
    const read = await this.store.readText(this.workspace, toolValidationPath(validationId), {
      reason: "read tool input validation",
      maxBytes: 512 * 1024
    });
    if (!read.ok) return read.error.code === "not_found" ? toolRuntimeErr({ code: "not_found", message: "validation not found" }) : read;
    return parseJson<ToolInputValidation>(read.value.content, "tool validation is invalid JSON");
  }

  async writeExecutionReceipt(receipt: ToolExecutionReceipt): Promise<Result<WriteReceipt>> {
    return this.store.writeTextAtomic(
      this.workspace,
      toolExecutionReceiptPath(receipt.executionId),
      JSON.stringify(receipt, null, 2),
      { reason: "write tool execution receipt", createParents: true }
    );
  }

  async readExecutionReceipt(executionId: ToolExecutionId): Promise<Result<ToolExecutionReceipt>> {
    const read = await this.store.readText(this.workspace, toolExecutionReceiptPath(executionId), {
      reason: "read tool execution receipt",
      maxBytes: 512 * 1024
    });
    if (!read.ok) return read.error.code === "not_found" ? toolRuntimeErr({ code: "not_found", message: "execution receipt not found" }) : read;
    return parseJson<ToolExecutionReceipt>(read.value.content, "tool execution receipt is invalid JSON");
  }

  async writeSettlement(settlement: ToolSettlement): Promise<Result<WriteReceipt>> {
    return this.store.writeTextAtomic(
      this.workspace,
      toolSettlementPath(settlement.settlementId),
      JSON.stringify(settlement, null, 2),
      { reason: "write tool settlement", createParents: true }
    );
  }

  async readSettlement(settlementId: ToolSettlementId): Promise<Result<ToolSettlement>> {
    const read = await this.store.readText(this.workspace, toolSettlementPath(settlementId), {
      reason: "read tool settlement",
      maxBytes: 512 * 1024
    });
    if (!read.ok) return read.error.code === "not_found" ? toolRuntimeErr({ code: "not_found", message: "settlement not found" }) : read;
    return parseJson<ToolSettlement>(read.value.content, "tool settlement is invalid JSON");
  }

  async readArtifactJson<T>(artifactRef: ArtifactRef, materialize: (ref: ArtifactRef) => Promise<Result<string>>): Promise<Result<T>> {
    const content = await materialize(artifactRef);
    return content.ok ? parseJson<T>(content.value, "tool artifact JSON is invalid") : content;
  }

  private async readIndex(): Promise<Result<ToolRegistryIndex>> {
    const read = await this.store.readText(this.workspace, toolIndexPath, {
      reason: "read tool index",
      maxBytes: 512 * 1024
    });
    if (!read.ok) return read.error.code === "not_found" ? ok({ toolRefs: [] }) : read;
    return parseJson<ToolRegistryIndex>(read.value.content, "tool index is invalid JSON");
  }
}

function parseJson<T>(content: string, message: string): Result<T> {
  try {
    return ok(JSON.parse(content) as T);
  } catch (cause) {
    return toolRuntimeErr({ code: "schema_incompatible", message, cause });
  }
}

import { createReadStream } from "node:fs";
import { readFile, stat as nodeStat } from "node:fs/promises";
import { TextDecoder } from "node:util";
import { ok, type Result } from "../domain/result.js";
import { fileStoreErr, ioErr, isNodeNotFound } from "./errors.js";
import { sha256Content } from "./hash.js";
import { fileStat, receipt } from "./metadata.js";
import { resolveWorkspacePath } from "./path.js";
import type {
  BinaryRead,
  LineRange,
  ReadOptions,
  ReadReceipt,
  TextRead,
  TextReadOptions,
  WorkspaceHandle
} from "./types.js";

export async function readBinary(
  workspace: WorkspaceHandle,
  logicalPath: string,
  options: ReadOptions,
  defaultMaxReadBytes: number
): Promise<Result<BinaryRead>> {
  const resolved = await resolveWorkspacePath(workspace, logicalPath);
  if (!resolved.ok) return resolved;
  try {
    const info = await nodeStat(resolved.value.absolutePath);
    if (!info.isFile()) return fileStoreErr({ code: "invalid_input", message: "path is not a file" });
    const maxBytes = options.maxBytes ?? defaultMaxReadBytes;
    if (info.size > maxBytes) {
      return fileStoreErr({ code: "file_too_large", message: `file exceeds ${maxBytes} byte read guard` });
    }
    const content = await readFile(resolved.value.absolutePath);
    const contentHash = sha256Content(content);
    const statResult = await fileStat(workspace, resolved.value, false);
    if (!statResult.ok) return statResult;
    return ok({
      logicalPath: resolved.value.logicalPath,
      content,
      stat: { ...statResult.value, contentHash, contentHashAvailable: true },
      receipt: {
        ...receipt(workspace, resolved.value.logicalPath, "read", options),
        contentHash,
        bytesRead: content.length
      } satisfies ReadReceipt
    });
  } catch (error) {
    if (isNodeNotFound(error)) return fileStoreErr({ code: "not_found", message: "file does not exist" });
    return ioErr("failed to read file", error);
  }
}

export async function readText(
  workspace: WorkspaceHandle,
  logicalPath: string,
  options: TextReadOptions,
  defaultMaxReadBytes: number
): Promise<Result<TextRead>> {
  if (options.encoding !== undefined && options.encoding !== "utf8") {
    return fileStoreErr({ code: "unsupported_encoding", message: "only utf8 text reads are supported" });
  }
  const read = await readBinary(workspace, logicalPath, options, defaultMaxReadBytes);
  if (!read.ok) return read;
  try {
    return ok({
      logicalPath: read.value.logicalPath,
      content: new TextDecoder("utf-8", { fatal: true }).decode(read.value.content),
      encoding: "utf8",
      stat: read.value.stat,
      receipt: read.value.receipt
    });
  } catch (error) {
    if (error instanceof TypeError) {
      return fileStoreErr({ code: "unsupported_encoding", message: "file is not valid utf8", cause: error });
    }
    return ioErr("failed to read text range", error);
  }
}

export async function readTextRange(
  workspace: WorkspaceHandle,
  logicalPath: string,
  range: LineRange,
  options: TextReadOptions,
  defaultMaxReadBytes: number
): Promise<Result<TextRead>> {
  if (range.offset < 1 || range.limit < 1) {
    return fileStoreErr({ code: "invalid_input", message: "line range offset and limit must be positive" });
  }
  if (options.encoding !== undefined && options.encoding !== "utf8") {
    return fileStoreErr({ code: "unsupported_encoding", message: "only utf8 text reads are supported" });
  }
  const resolved = await resolveWorkspacePath(workspace, logicalPath);
  if (!resolved.ok) return resolved;
  const statResult = await fileStat(workspace, resolved.value, false);
  if (!statResult.ok) return statResult;
  if (statResult.value.kind !== "file") return fileStoreErr({ code: "invalid_input", message: "path is not a file" });

  const scanLimit = options.maxBytes ?? defaultMaxReadBytes;
  const selected: string[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "";
  let lineNo = 1;
  let scannedBytes = 0;

  const acceptLine = (line: string) => {
    if (lineNo >= range.offset && selected.length < range.limit) selected.push(line);
    lineNo += 1;
  };

  try {
    const stream = createReadStream(resolved.value.absolutePath);
    for await (const chunk of stream) {
      const bytes = chunk as Buffer;
      scannedBytes += bytes.length;
      if (scannedBytes > scanLimit) {
        stream.destroy();
        return fileStoreErr({ code: "file_too_large", message: `range scan exceeds ${scanLimit} byte guard` });
      }
      pending += decoder.decode(bytes, { stream: true });
      let newline = pending.search(/\r?\n/);
      while (newline !== -1) {
        const line = pending.slice(0, newline);
        const newlineLength = pending[newline] === "\r" && pending[newline + 1] === "\n" ? 2 : 1;
        pending = pending.slice(newline + newlineLength);
        acceptLine(line);
        if (selected.length >= range.limit) break;
        newline = pending.search(/\r?\n/);
      }
      if (selected.length >= range.limit) {
        stream.destroy();
        break;
      }
    }
    const tail = decoder.decode();
    pending += tail;
    if (selected.length < range.limit && pending.length > 0) acceptLine(pending);
  } catch (error) {
    return fileStoreErr({ code: "unsupported_encoding", message: "file is not valid utf8", cause: error });
  }

  const content = selected.join("\n");
  const contentHash = sha256Content(content);
  return ok({
    logicalPath: resolved.value.logicalPath,
    content,
    encoding: "utf8",
    range,
    stat: statResult.value,
    receipt: {
      ...receipt(workspace, resolved.value.logicalPath, "read", options),
      contentHash,
      bytesRead: Buffer.byteLength(content, "utf8")
    }
  });
}

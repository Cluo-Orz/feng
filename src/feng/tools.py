from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .artifacts import write_artifact
from .events import append_event
from .permissions import PermissionDenied, check_command, check_file_read, check_file_write
from .utils import ensure_dir, rel_path, run_process


MAX_INLINE_RESULT = 8000


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    input_schema: dict[str, Any]
    handler: Callable[[Path, dict[str, Any]], dict[str, Any]]

    def schema_for_provider(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.input_schema,
            },
        }


def _result(content: str, artifact: dict[str, Any] | None = None, is_error: bool = False) -> dict[str, Any]:
    return {"content": content, "artifact": artifact, "is_error": is_error}


def _maybe_artifact(workspace: Path, source: str, content: str, summary: str) -> dict[str, Any]:
    if len(content) <= MAX_INLINE_RESULT:
        return _result(content)
    artifact = write_artifact(
        workspace,
        "tool-output",
        source,
        content,
        summary,
        "tool output exceeded inline message budget",
        extension="txt",
        snippets=[content[:1000]],
    )
    return _result(json.dumps({"artifact_ref": artifact}, ensure_ascii=False), artifact=artifact)


def run_read_file(workspace: Path, args: dict[str, Any]) -> dict[str, Any]:
    path = check_file_read(workspace, str(args.get("path", "")))
    limit = int(args.get("limit", 40000))
    text = path.read_text(encoding="utf-8", errors="replace")
    if len(text) > limit:
        text = text[:limit] + "\n[truncated]\n"
    append_event(workspace, "tool_called", {"tool": "read_file", "path": rel_path(workspace, path)})
    return _maybe_artifact(workspace, f"read_file:{rel_path(workspace, path)}", text, "read_file output")


def run_write_file(workspace: Path, args: dict[str, Any]) -> dict[str, Any]:
    path = check_file_write(workspace, str(args.get("path", "")))
    content = str(args.get("content", ""))
    ensure_dir(path.parent)
    path.write_text(content, encoding="utf-8")
    append_event(workspace, "tool_called", {"tool": "write_file", "path": rel_path(workspace, path)})
    return _result(f"wrote {rel_path(workspace, path)} ({len(content)} chars)")


def run_list_files(workspace: Path, args: dict[str, Any]) -> dict[str, Any]:
    root_raw = str(args.get("path", "."))
    root = check_file_read(workspace, root_raw)
    max_files = int(args.get("max_files", 300))
    files: list[str] = []
    if root.is_file():
        files.append(rel_path(workspace, root))
    elif root.exists():
        for path in sorted(root.rglob("*")):
            rel = rel_path(workspace, path)
            if ".git/" in rel or rel.startswith(".git"):
                continue
            if path.is_file():
                files.append(rel)
            if len(files) >= max_files:
                files.append("[truncated]")
                break
    append_event(workspace, "tool_called", {"tool": "list_files", "path": root_raw})
    return _maybe_artifact(workspace, f"list_files:{root_raw}", "\n".join(files), "list_files output")


def run_run_command(workspace: Path, args: dict[str, Any]) -> dict[str, Any]:
    command = str(args.get("command", "")).strip()
    timeout = int(args.get("timeout", 60))
    if not command:
        return _result("command is required", is_error=True)
    check_command(workspace, command)
    code, output = run_process([command], cwd=workspace, timeout=timeout, shell=True)
    append_event(workspace, "tool_called", {"tool": "run_command", "command": command, "exit_code": code})
    prefix = f"exit_code={code}\n"
    result = _maybe_artifact(workspace, f"run_command:{command}", prefix + output, "run_command output")
    result["is_error"] = code != 0
    return result


BOOTSTRAP_TOOLS: list[Tool] = [
    Tool(
        "read_file",
        "Read a UTF-8 file from the workspace.",
        {
            "type": "object",
            "properties": {"path": {"type": "string"}, "limit": {"type": "integer"}},
            "required": ["path"],
        },
        run_read_file,
    ),
    Tool(
        "write_file",
        "Write a UTF-8 file inside the workspace.",
        {
            "type": "object",
            "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
            "required": ["path", "content"],
        },
        run_write_file,
    ),
    Tool(
        "list_files",
        "List files under a workspace path.",
        {
            "type": "object",
            "properties": {"path": {"type": "string"}, "max_files": {"type": "integer"}},
            "required": [],
        },
        run_list_files,
    ),
    Tool(
        "run_command",
        "Run an allowed shell command in the workspace.",
        {
            "type": "object",
            "properties": {"command": {"type": "string"}, "timeout": {"type": "integer"}},
            "required": ["command"],
        },
        run_run_command,
    ),
]


def tool_registry(_workspace: Path) -> list[Tool]:
    return list(BOOTSTRAP_TOOLS)


def active_tool_pack(workspace: Path, _mode: str, _latest_event: str) -> list[Tool]:
    return tool_registry(workspace)


def execute_tool(workspace: Path, tools: list[Tool], name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    tool = next((item for item in tools if item.name == name), None)
    if tool is None:
        return _result(f"unknown tool: {name}", is_error=True)
    try:
        return tool.handler(workspace, arguments)
    except PermissionDenied as exc:
        append_event(workspace, "tool_denied", {"tool": name, "reason": str(exc)})
        return _result(str(exc), is_error=True)
    except Exception as exc:  # keep the loop alive and make the failure observable
        return _result(f"{type(exc).__name__}: {exc}", is_error=True)

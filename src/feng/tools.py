from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .artifacts import write_artifact
from .events import append_event
from .permissions import PermissionDenied, check_command, check_file_read, check_file_write
from .utils import FengError, ensure_dir, read_jsonish, redact_secret_text, rel_path, run_process


MAX_INLINE_RESULT = 8000


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    input_schema: dict[str, Any]
    handler: Callable[[Path, dict[str, Any]], dict[str, Any]]
    source: str = ""
    selection_terms: tuple[str, ...] = ()
    always_active: bool = False

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
    return {"content": redact_secret_text(content), "artifact": artifact, "is_error": is_error}


def _maybe_artifact(workspace: Path, source: str, content: str, summary: str) -> dict[str, Any]:
    content = redact_secret_text(content)
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
    root_rel = rel_path(workspace, root)
    if root.is_file():
        files.append(root_rel)
    elif root.exists():
        for directory, dirs, names in os.walk(root):
            current = Path(directory)
            dirs.sort()
            names.sort()
            dirs[:] = [
                name
                for name in dirs
                if not _skip_list_dir(rel_path(workspace, current / name), root_rel)
            ]
            for name in names:
                path = current / name
                rel = rel_path(workspace, path)
                if _skip_list_file(rel):
                    continue
                files.append(rel)
                if len(files) >= max_files:
                    files.append("[truncated]")
                    dirs[:] = []
                    break
            if len(files) >= max_files:
                break
    append_event(workspace, "tool_called", {"tool": "list_files", "path": root_raw})
    return _maybe_artifact(workspace, f"list_files:{root_raw}", "\n".join(files), "list_files output")


def _skip_list_dir(rel: str, root_rel: str) -> bool:
    rel = rel.replace("\\", "/").strip("/")
    root_rel = root_rel.replace("\\", "/").strip("/")
    if not rel or rel == "." or rel == root_rel:
        return False
    base = Path(rel).name
    if rel in {".git", ".feng", "dist", "bin", "build", "out", "coverage"}:
        return True
    if rel in {".feng/cache", ".feng/runs"}:
        return True
    return base in {
        "__pycache__",
        "node_modules",
        "vendor",
        "target",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        ".tox",
        ".venv",
        "venv",
        ".next",
        ".nuxt",
        ".turbo",
        ".cache",
    }


def _skip_list_file(rel: str) -> bool:
    base = Path(rel).name
    return base.endswith((".pyc", ".test", ".exe"))


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


def _valid_tool_name(name: str) -> bool:
    return re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", name) is not None


def _command_tool(workspace: Path, path: Path) -> Tool | None:
    try:
        data = read_jsonish(path, {})
    except FengError as exc:
        append_event(workspace, "tool_load_failed", {"path": rel_path(workspace, path), "reason": str(exc)})
        return None
    if not isinstance(data, dict) or data.get("type") != "command":
        return None
    name = str(data.get("name") or path.stem.split(".")[0])
    command = str(data.get("command") or "").strip()
    if not _valid_tool_name(name) or not command:
        append_event(workspace, "tool_load_failed", {"path": rel_path(workspace, path), "reason": "invalid name or command"})
        return None
    description = str(data.get("description") or f"Run the self-defined command tool {name}.")
    input_schema = data.get("input_schema") or {"type": "object", "properties": {}, "required": []}
    timeout = int(data.get("timeout", 60))
    source = rel_path(workspace, path)

    def handler(tool_workspace: Path, args: dict[str, Any]) -> dict[str, Any]:
        check_command(tool_workspace, command)
        code, output = run_process(
            [command],
            cwd=tool_workspace,
            timeout=timeout,
            shell=True,
            env={
                "FENG_TOOL_ARGS": json.dumps(args, ensure_ascii=False),
                "FENG_TOOL_NAME": name,
                "FENG_TOOL_SOURCE": source,
            },
        )
        append_event(tool_workspace, "tool_called", {"tool": name, "command": command, "exit_code": code})
        result = _maybe_artifact(tool_workspace, f"{name}:{command}", f"exit_code={code}\n{output}", f"{name} output")
        result["is_error"] = code != 0
        return result

    return Tool(
        name,
        description[:500],
        input_schema,
        handler,
        source=source,
        selection_terms=tuple(_selection_terms(name, source, description, data)),
        always_active=_boolish(data.get("always")),
    )


def self_repo_tools(workspace: Path) -> list[Tool]:
    tools_dir = workspace / "tools"
    if not tools_dir.exists():
        return []
    loaded: list[Tool] = []
    seen = {tool.name for tool in BOOTSTRAP_TOOLS}
    for path in sorted(tools_dir.rglob("*")):
        if not path.is_file() or not path.name.endswith((".tool.yaml", ".tool.json")):
            continue
        tool = _command_tool(workspace, path)
        if not tool or tool.name in seen:
            continue
        seen.add(tool.name)
        loaded.append(tool)
    return loaded


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
    return [*BOOTSTRAP_TOOLS, *self_repo_tools(_workspace)]


def active_tool_pack(workspace: Path, mode: str, latest_event: str) -> list[Tool]:
    bootstrap = list(BOOTSTRAP_TOOLS)
    self_tools = self_repo_tools(workspace)
    if not self_tools:
        return bootstrap
    if mode in {"check", "checking"}:
        return [*bootstrap, *self_tools]
    query = _selection_query(mode, latest_event)
    selected = _select_self_tools(self_tools, query, _active_self_tool_limit())
    return [*bootstrap, *selected]


def _selection_query(mode: str, latest_event: str) -> str:
    return f"{mode}\n{latest_event}".lower()


def _select_self_tools(tools: list[Tool], query: str, limit: int) -> list[Tool]:
    scored: list[tuple[int, str, Tool]] = []
    for tool in tools:
        score = 0
        if tool.always_active:
            score += 100
        if _selection_match(query, tool.name):
            score += 10
        for term in tool.selection_terms:
            if _selection_match(query, term):
                score += 3
        if score > 0:
            scored.append((score, tool.name, tool))
    scored.sort(key=lambda item: (-item[0], item[1]))
    return [item[2] for item in scored[: max(0, min(limit, len(scored)))]]


def _active_self_tool_limit() -> int:
    raw = os.environ.get("FENG_ACTIVE_SELF_TOOL_LIMIT", "").strip()
    if raw:
        try:
            return max(0, min(32, int(raw)))
        except ValueError:
            pass
    return 8


def _selection_terms(name: str, source: str, description: str, data: dict[str, Any]) -> list[str]:
    seen: set[str] = set()
    terms: list[str] = []

    def add(value: str) -> None:
        term = value.strip().lower()
        if not term or term in seen:
            return
        seen.add(term)
        terms.append(term)

    for value in re.split(r"[^A-Za-z0-9_]+", name + " " + Path(source).stem):
        add(value)
    for key in ("when", "keywords", "tags"):
        raw = data.get(key)
        values = raw if isinstance(raw, list) else [raw]
        for value in values:
            if value is not None:
                add(str(value))
    stop = {"with", "from", "this", "that", "tool", "command", "self", "defined", "through", "using"}
    for value in re.split(r"[^A-Za-z0-9_]+", description):
        term = value.lower()
        if len(term) >= 4 and term not in stop:
            add(term)
        if len(terms) >= 20:
            break
    return terms


def _boolish(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() == "true"
    return False


def _selection_match(query: str, term: str) -> bool:
    term = term.strip().lower()
    return len(term) >= 3 and bool(query) and term in query


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

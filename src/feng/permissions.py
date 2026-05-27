from __future__ import annotations

from pathlib import Path

from .artifacts import write_artifact
from .utils import FengError, matches_any, read_jsonish, redact_secret_text, rel_path, safe_join


class PermissionDenied(FengError):
    pass


BUILT_IN_DENIED_COMMANDS = [
    "git reset --hard",
    "git push",
    "rm -rf",
    "remove-item -recurse",
    "del /s",
]


def load_permissions(workspace: Path) -> dict:
    return read_jsonish(workspace / "permissions.yaml", {}) or {}


def check_file_read(workspace: Path, raw_path: str) -> Path:
    try:
        target = safe_join(workspace, raw_path)
    except FengError as exc:
        _deny(workspace, "file_read", raw_path, str(exc), "file read target must stay inside the workspace")
    rel = rel_path(workspace, target)
    patterns = load_permissions(workspace).get("files", {}).get("read", ["**"])
    if not matches_any(rel, patterns):
        _deny(workspace, "file_read", rel, f"file read denied: {rel}", "file read path did not match permissions.yaml")
    return target


def check_file_write(workspace: Path, raw_path: str) -> Path:
    try:
        target = safe_join(workspace, raw_path)
    except FengError as exc:
        _deny(workspace, "file_write", raw_path, str(exc), "file write target must stay inside the workspace")
    rel = rel_path(workspace, target)
    if rel.startswith(".git/") or rel == ".git":
        _deny(workspace, "file_write", rel, "writing .git is denied", "runtime owns Git metadata; tools cannot write .git directly")
    patterns = load_permissions(workspace).get("files", {}).get("write", [])
    if not matches_any(rel, patterns):
        _deny(workspace, "file_write", rel, f"file write denied: {rel}", "file write path did not match permissions.yaml")
    return target


def check_command(workspace: Path, command: str) -> None:
    perms = load_permissions(workspace).get("commands", {})
    deny = perms.get("deny", [])
    allow = perms.get("allow", [])
    lowered = _normalized_command(command)
    for pattern in BUILT_IN_DENIED_COMMANDS:
        if _normalized_command(pattern) in lowered:
            _deny(
                workspace,
                "run_command",
                command,
                f"command denied by built-in rule: {pattern}",
                "dangerous command matched built-in deny rule",
            )
    for pattern in deny:
        if _normalized_command(str(pattern)) in lowered:
            _deny(workspace, "run_command", command, f"command denied by rule: {pattern}", "dangerous command matched deny rule")
    if allow and not any(command == item or command.startswith(f"{item} ") for item in allow):
        _deny(workspace, "run_command", command, f"command is not in allow list: {command}", "command did not match permissions.yaml allow list")


def _normalized_command(command: str) -> str:
    return " ".join(command.lower().split())


def _deny(workspace: Path, source: str, attempted: str, message: str, why_relevant: str) -> None:
    write_artifact(workspace, "permission-denied", source, attempted, message, why_relevant)
    raise PermissionDenied(redact_secret_text(message))

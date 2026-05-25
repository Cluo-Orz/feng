from __future__ import annotations

from pathlib import Path

from .artifacts import write_artifact
from .utils import FengError, matches_any, read_jsonish, rel_path, safe_join


class PermissionDenied(FengError):
    pass


def load_permissions(workspace: Path) -> dict:
    return read_jsonish(workspace / "permissions.yaml", {}) or {}


def check_file_read(workspace: Path, raw_path: str) -> Path:
    target = safe_join(workspace, raw_path)
    rel = rel_path(workspace, target)
    patterns = load_permissions(workspace).get("files", {}).get("read", ["**"])
    if not matches_any(rel, patterns):
        raise PermissionDenied(f"file read denied: {rel}")
    return target


def check_file_write(workspace: Path, raw_path: str) -> Path:
    target = safe_join(workspace, raw_path)
    rel = rel_path(workspace, target)
    if rel.startswith(".git/") or rel == ".git":
        raise PermissionDenied("writing .git is denied")
    patterns = load_permissions(workspace).get("files", {}).get("write", [])
    if not matches_any(rel, patterns):
        raise PermissionDenied(f"file write denied: {rel}")
    return target


def check_command(workspace: Path, command: str) -> None:
    perms = load_permissions(workspace).get("commands", {})
    deny = perms.get("deny", [])
    allow = perms.get("allow", [])
    lowered = command.lower()
    for pattern in deny:
        if pattern.lower() in lowered:
            write_artifact(
                workspace,
                "permission-denied",
                "run_command",
                command,
                f"Denied command: {pattern}",
                "dangerous command matched deny rule",
            )
            raise PermissionDenied(f"command denied by rule: {pattern}")
    if allow and not any(command == item or command.startswith(f"{item} ") for item in allow):
        raise PermissionDenied(f"command is not in allow list: {command}")

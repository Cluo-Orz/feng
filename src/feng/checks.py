from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .artifacts import write_artifact
from .events import append_event
from .git_utils import checkpoint_commit
from .llm import load_provider_profile
from .message_context import compile_messages
from .self_repo import SELF_DIRS, SELF_FILES
from .state import load_state, save_state
from .tools import active_tool_pack
from .utils import FengError, read_jsonish


SECRET_RE = re.compile(r"sk-[A-Za-z0-9_-]{16,}")


def _check_required_files(workspace: Path, problems: list[str]) -> None:
    for name in SELF_FILES:
        if not (workspace / name).exists():
            problems.append(f"missing self file: {name}")
    for name in SELF_DIRS:
        if not (workspace / name).exists():
            problems.append(f"missing self directory: {name}")


def _check_jsonish(workspace: Path, problems: list[str]) -> None:
    for name in ["feng.yaml", "hooks.yaml", "permissions.yaml", "interface.yaml", "config.schema.yaml"]:
        try:
            read_jsonish(workspace / name, {})
        except FengError as exc:
            problems.append(str(exc))


def _check_no_secrets(workspace: Path, problems: list[str]) -> None:
    for path in sorted(workspace.rglob("*")):
        rel = path.relative_to(workspace).as_posix()
        if not path.is_file():
            continue
        if rel.startswith(".git/"):
            continue
        if rel.startswith(".feng/cache/") or rel.startswith(".feng/runs/"):
            continue
        if path.stat().st_size > 512_000:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if SECRET_RE.search(text):
            problems.append(f"possible secret in {rel}")


def _check_no_special_runtime(workspace: Path, problems: list[str]) -> None:
    src = workspace / "src"
    if not src.exists():
        return
    product_name = "feng"
    forbidden = [
        f"if project == '{product_name}'",
        f'if project == "{product_name}"',
        "init" + "-self",
        product_name + "smith",
    ]
    for path in sorted(src.rglob("*.py")):
        text = path.read_text(encoding="utf-8", errors="ignore")
        for needle in forbidden:
            if needle in text:
                problems.append(f"special runtime marker in {path.relative_to(workspace).as_posix()}: {needle}")


def run_check(workspace: Path, update_validated: bool = True) -> dict[str, Any]:
    problems: list[str] = []
    state = load_state(workspace)
    state["mode"] = "checking"
    save_state(workspace, state)
    _check_required_files(workspace, problems)
    _check_jsonish(workspace, problems)
    _check_no_secrets(workspace, problems)
    _check_no_special_runtime(workspace, problems)
    try:
        load_provider_profile(workspace)
    except Exception as exc:
        problems.append(f"provider profile parse failed: {exc}")
    try:
        tools = active_tool_pack(workspace, "checking", "check")
        compile_messages(workspace, "check candidate self", tools)
    except Exception as exc:
        problems.append(f"message compiler failed: {type(exc).__name__}: {exc}")

    ok = not problems
    state = load_state(workspace)
    report = {
        "ok": ok,
        "problems": problems,
        "validated_commit": state.get("validated_commit", ""),
    }
    if ok and update_validated:
        state["validated_commit"] = checkpoint_commit(workspace, "feng: validated checkpoint")
        report["validated_commit"] = state["validated_commit"]
        append_event(workspace, "validated_commit_updated", {"commit": state["validated_commit"]})
    content = json.dumps(report, ensure_ascii=False, indent=2)
    artifact = write_artifact(
        workspace,
        "check-report",
        "feng-check",
        content,
        "check passed" if ok else "check failed",
        "check validates candidate self before hatch",
        extension="json",
    )
    state = load_state(workspace)
    state["last_artifacts"] = [artifact]
    if ok and update_validated:
        state["validated_commit"] = report["validated_commit"]
    state["mode"] = "ready" if ok else "blocked"
    state["candidate_status"] = "validated" if ok else "failed"
    save_state(workspace, state)
    append_event(workspace, "check_passed" if ok else "check_failed", report)
    return report

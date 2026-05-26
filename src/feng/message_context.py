from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .git_utils import current_head, diff_summary, status_short
from .self_repo import self_file_index
from .state import load_state, save_state
from .tools import Tool
from .utils import estimate_tokens, sha256_text, stable_json


KERNEL_CONTRACT = """You are feng, a minimal self-growing agent kernel.
Use tool calls when you need to inspect or change the workspace.
Do not claim a change is validated; validation is performed by feng check.
Keep large evidence in files/artifacts and reference paths instead of pasting full content.
"""


def skill_catalog(workspace: Path) -> list[dict[str, str]]:
    skills_dir = workspace / "skills"
    if not skills_dir.exists():
        return []
    items: list[dict[str, str]] = []
    for path in sorted(skills_dir.rglob("*.md")):
        if path.name.upper() == "README.MD":
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        first_line = next((line.strip("# ").strip() for line in text.splitlines() if line.strip()), path.stem)
        items.append({"path": path.relative_to(workspace).as_posix(), "description": first_line[:200]})
    return items


def world_index(workspace: Path) -> list[str]:
    world = workspace / "world"
    if not world.exists():
        return []
    return [path.relative_to(workspace).as_posix() for path in sorted(world.rglob("*")) if path.is_file()]


def compile_messages(
    workspace: Path,
    latest_event: str,
    tools: list[Tool],
    conversation: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    state = load_state(workspace)
    tool_schemas = [tool.schema_for_provider() for tool in tools]
    active_tool_pack_hash = sha256_text(stable_json(tool_schemas))
    self_contract = {
        "identity": (workspace / "identity.md").read_text(encoding="utf-8", errors="replace")[:2000]
        if (workspace / "identity.md").exists()
        else "",
        "goal": (workspace / "goal.md").read_text(encoding="utf-8", errors="replace")[:2000]
        if (workspace / "goal.md").exists()
        else "",
        "self_files": self_file_index(workspace)[:200],
        "skill_catalog": skill_catalog(workspace),
        "world_index": world_index(workspace),
        "permissions": "tool calls are checked by runtime permissions",
        "self_commit": current_head(workspace),
    }
    state_manifest = {
        "state": state,
        "git_status": status_short(workspace),
        "git_diff_summary": diff_summary(workspace),
    }
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": KERNEL_CONTRACT},
        {"role": "system", "content": "self contract:\n" + json.dumps(self_contract, ensure_ascii=False, indent=2)},
        {"role": "user", "content": "state manifest:\n" + json.dumps(state_manifest, ensure_ascii=False, indent=2)},
    ]
    if conversation:
        messages.extend(conversation[-8:])
    messages.append({"role": "user", "content": latest_event})
    stable_prefix = stable_json(messages[:2])
    dynamic_suffix = stable_json(messages[2:])
    metrics = {
        "active_tool_pack_hash": active_tool_pack_hash,
        "stable_prefix_hash": sha256_text(stable_prefix),
        "context_pack_hash": sha256_text(stable_json(self_contract.get("skill_catalog", []))),
        "estimated_input_tokens": estimate_tokens(stable_prefix + dynamic_suffix + stable_json(tool_schemas)),
        "dynamic_suffix_tokens": estimate_tokens(dynamic_suffix),
        "tool_schema_tokens": estimate_tokens(stable_json(tool_schemas)),
        "selected_tools": [tool.name for tool in tools],
    }
    state["active_tool_pack_hash"] = metrics["active_tool_pack_hash"]
    state["stable_prefix_hash"] = metrics["stable_prefix_hash"]
    state["context_budget"]["estimated_input_tokens"] = metrics["estimated_input_tokens"]
    state["context_budget"]["dynamic_suffix_tokens"] = metrics["dynamic_suffix_tokens"]
    save_state(workspace, state)
    return messages, metrics

from __future__ import annotations

from pathlib import Path
from typing import Any

from .utils import read_jsonish, write_jsonish


STATE_VERSION = 1


def default_state(goal: str = "") -> dict[str, Any]:
    return {
        "version": STATE_VERSION,
        "mode": "ready",
        "current_goal": goal,
        "validated_commit": "",
        "candidate_status": "none",
        "active_tool_pack_hash": "",
        "stable_prefix_hash": "",
        "context_budget": {
            "max_input_tokens": 0,
            "estimated_input_tokens": 0,
            "dynamic_suffix_tokens": 0,
        },
        "last_recovery": {"type": "", "artifact": ""},
        "recovery_count": 0,
        "last_event_id": "",
        "last_artifacts": [],
        "lock": {"owner": "", "heartbeat": ""},
    }


def state_path(workspace: Path) -> Path:
    return workspace / ".feng" / "state.yaml"


def load_state(workspace: Path) -> dict[str, Any]:
    state = read_jsonish(state_path(workspace), default_state())
    merged = default_state()
    merged.update(state or {})
    merged["context_budget"] = {**default_state()["context_budget"], **merged.get("context_budget", {})}
    merged["last_recovery"] = {**default_state()["last_recovery"], **merged.get("last_recovery", {})}
    merged["lock"] = {**default_state()["lock"], **merged.get("lock", {})}
    return merged


def save_state(workspace: Path, state: dict[str, Any]) -> None:
    write_jsonish(state_path(workspace), state)


def update_state(workspace: Path, **changes: Any) -> dict[str, Any]:
    state = load_state(workspace)
    state.update(changes)
    save_state(workspace, state)
    return state

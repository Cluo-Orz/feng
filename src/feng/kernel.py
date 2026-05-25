from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from .artifacts import write_artifact
from .events import append_event
from .llm import LLMError, call_llm, extract_assistant_message, normalize_tool_calls
from .message_context import compile_messages
from .self_repo import bootstrap
from .state import load_state, save_state
from .tools import active_tool_pack, execute_tool


def _tool_result_message(call_id: str, result: dict[str, Any]) -> dict[str, Any]:
    return {
        "role": "tool",
        "tool_call_id": call_id,
        "content": result.get("content", ""),
    }


def _handle_llm_error(workspace: Path, exc: LLMError) -> dict[str, Any]:
    state = load_state(workspace)
    if exc.kind == "missing_config":
        state["mode"] = "missing_config"
    else:
        state["mode"] = "blocked"
    state["last_recovery"] = {"type": exc.kind, "artifact": ""}
    state["recovery_count"] = int(state.get("recovery_count", 0)) + 1
    artifact = write_artifact(
        workspace,
        "provider-error",
        "llm",
        str(exc),
        f"LLM error: {exc.kind}",
        "provider error stopped or delayed the grow loop",
        extension="txt",
    )
    state["last_recovery"]["artifact"] = artifact["path"]
    state["last_artifacts"] = [artifact]
    save_state(workspace, state)
    append_event(workspace, "blocked", {"reason": exc.kind, "message": str(exc)})
    return {"ok": False, "reason": exc.kind, "message": str(exc)}


def grow(workspace: Path, goal: str, max_turns: int = 12) -> dict[str, Any]:
    seed_raw = os.environ.get("FENG_SEED_SELF", "")
    seed_self = Path(seed_raw).resolve() if seed_raw else None
    bootstrap(workspace, goal, seed_self=seed_self if seed_self and seed_self.exists() else None)
    state = load_state(workspace)
    state["mode"] = "growing"
    state["current_goal"] = goal
    state["candidate_status"] = "dirty"
    save_state(workspace, state)
    append_event(workspace, "run_started", {"mode": "grow", "goal": goal})
    conversation: list[dict[str, Any]] = []
    latest_event = f"Grow this feng workspace toward the goal:\n{goal}\nUse tools to inspect and modify files. Stop when this turn has made coherent progress."
    for turn in range(max_turns):
        tools = active_tool_pack(workspace, "grow", latest_event)
        messages, metrics = compile_messages(workspace, latest_event, tools, conversation)
        append_event(workspace, "message_compiled", {"turn": turn, **metrics})
        try:
            response = call_llm(workspace, messages, [tool.schema_for_provider() for tool in tools])
        except LLMError as exc:
            return _handle_llm_error(workspace, exc)
        assistant = extract_assistant_message(response)
        conversation.append(assistant)
        calls = normalize_tool_calls(assistant)
        if not calls:
            state = load_state(workspace)
            state["mode"] = "ready"
            save_state(workspace, state)
            append_event(workspace, "run_stopped", {"turn": turn, "reason": "assistant_done"})
            return {"ok": True, "turns": turn + 1, "message": assistant.get("content", "")}
        for call in calls:
            result = execute_tool(workspace, tools, call["name"], call["arguments"])
            conversation.append(_tool_result_message(call["id"], result))
            latest_event = f"Tool {call['name']} returned. Continue if more work is needed."
    state = load_state(workspace)
    state["mode"] = "blocked"
    save_state(workspace, state)
    append_event(workspace, "blocked", {"reason": "budget_reached", "max_turns": max_turns})
    return {"ok": False, "reason": "budget_reached", "max_turns": max_turns}

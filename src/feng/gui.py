from __future__ import annotations

import html
import json
from pathlib import Path
from typing import Any

from .artifacts import list_artifacts
from .events import append_event, tail_events
from .llm import provider_status
from .state import load_state
from .utils import redact_secret_value, rel_path, write_text


def write_gui(workspace: Path, out_path: Path | None = None) -> Path:
    path = out_path or workspace / ".feng" / "gui.html"
    if not path.is_absolute():
        path = workspace / path
    payload = {
        "state": redact_secret_value(load_state(workspace)),
        "provider": redact_secret_value(provider_status(workspace)),
        "events": redact_secret_value(tail_events(workspace, 80)),
        "artifacts": redact_secret_value(list_artifacts(workspace)),
    }
    write_text(path, _render_dashboard(payload))
    append_event(workspace, "gui_written", {"path": rel_path(workspace, path)})
    return path


def _render_dashboard(payload: dict[str, Any]) -> str:
    state = payload["state"]
    provider = payload["provider"]
    events = payload["events"]
    artifacts = payload["artifacts"]
    return (
        "<!doctype html><meta charset=\"utf-8\"><title>feng</title>"
        "<style>"
        "body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#1f2937;background:#f8fafc}"
        "section{margin:0 0 20px 0;padding:16px;border:1px solid #d1d5db;background:#fff}"
        "h1,h2{margin:0 0 12px 0}pre{white-space:pre-wrap;word-break:break-word}"
        "</style>"
        "<h1>feng</h1>"
        "<section><h2>Running</h2><pre>"
        + _json({"mode": state.get("mode"), "candidate_status": state.get("candidate_status"), "provider": provider})
        + "</pre></section>"
        "<section><h2>Progress</h2><pre>"
        + _json({"current_goal": state.get("current_goal"), "validated_commit": state.get("validated_commit"), "events": events})
        + "</pre></section>"
        "<section><h2>Artifacts</h2><pre>"
        + _json(artifacts)
        + "</pre></section>"
    )


def _json(value: Any) -> str:
    return html.escape(json.dumps(value, ensure_ascii=False, indent=2))

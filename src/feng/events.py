from __future__ import annotations

import itertools
import json
from pathlib import Path
from typing import Any

from .utils import ensure_dir, redact_secret_value, utc_ms

_EVENT_SEQUENCE = itertools.count(1)


def events_path(workspace: Path) -> Path:
    return workspace / ".feng" / "events.jsonl"


def append_event(workspace: Path, event_type: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
    ts = utc_ms()
    event = {
        "id": f"evt_{ts}_{next(_EVENT_SEQUENCE):06d}",
        "ts": ts,
        "type": event_type,
        "data": redact_secret_value(data or {}),
    }
    path = events_path(workspace)
    ensure_dir(path.parent)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")
    return event


def tail_events(workspace: Path, limit: int = 20) -> list[dict[str, Any]]:
    path = events_path(workspace)
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()[-limit:]
    items: list[dict[str, Any]] = []
    for line in lines:
        try:
            items.append(json.loads(line))
        except json.JSONDecodeError:
            items.append({"type": "invalid_event", "raw": line})
    return items

from __future__ import annotations

import json
import os
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from .state import load_state, save_state
from .utils import ensure_dir


class WorkspaceLocked(RuntimeError):
    pass


def _lock_path(workspace: Path) -> Path:
    return workspace / ".feng" / "lock"


def _rfc3339(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _stale_after_seconds() -> int:
    raw = os.environ.get("FENG_LOCK_STALE_SECONDS", "").strip()
    if raw:
        try:
            parsed = int(raw)
            if parsed > 0:
                return parsed
        except ValueError:
            pass
    return 86400


def _remove_stale_lock(path: Path) -> bool:
    try:
        age = time.time() - path.stat().st_mtime
    except OSError:
        return False
    if age < _stale_after_seconds():
        return False
    try:
        path.unlink()
        return True
    except OSError:
        return False


def _describe_lock(path: Path) -> str:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        owner = data.get("owner", "")
        pid = data.get("pid", "")
        started = data.get("started_at", "")
        if owner and pid and started:
            return f"workspace is locked by {owner} pid={pid} since={_rfc3339(int(started))}"
    except Exception:
        pass
    return "workspace is locked"


def _mark_state_locked(workspace: Path, record: dict[str, object]) -> None:
    try:
        state = load_state(workspace)
        state["lock"] = {
            "owner": str(record["owner"]),
            "pid": str(record["pid"]),
            "heartbeat": _rfc3339(int(record["heartbeat"])),
            "started_at": _rfc3339(int(record["started_at"])),
        }
        save_state(workspace, state)
    except Exception:
        pass


def _clear_state_lock(workspace: Path) -> None:
    try:
        state = load_state(workspace)
        state["lock"] = {"owner": "", "heartbeat": ""}
        save_state(workspace, state)
    except Exception:
        pass


@contextmanager
def acquire_workspace_lock(workspace: Path, owner: str) -> Iterator[None]:
    path = _lock_path(workspace)
    ensure_dir(path.parent)
    now = int(time.time())
    pid = os.getpid()
    record: dict[str, object] = {"owner": owner, "pid": pid, "started_at": now, "heartbeat": now}
    for _ in range(2):
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            if _remove_stale_lock(path):
                continue
            raise WorkspaceLocked(_describe_lock(path))
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
        _mark_state_locked(workspace, record)
        try:
            yield
        finally:
            _release_workspace_lock(workspace, owner, pid)
        return
    raise WorkspaceLocked(_describe_lock(path))


def _release_workspace_lock(workspace: Path, owner: str, pid: int) -> None:
    path = _lock_path(workspace)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("owner") == owner and int(data.get("pid", -1)) == pid:
            path.unlink()
    except Exception:
        pass
    _clear_state_lock(workspace)

from __future__ import annotations

import fnmatch
import hashlib
import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any


ROOT_MARKER = ".feng"
SECRET_PATTERN = re.compile(r"sk-[A-Za-z0-9_-]{16,}")


class FengError(RuntimeError):
    pass


def utc_ms() -> int:
    return int(time.time() * 1000)


def slugify(value: str, default: str = "item") -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip("-._")
    return value[:80] or default


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def redact_secret_text(value: str) -> str:
    return SECRET_PATTERN.sub("[redacted-secret]", value)


def redact_secret_value(value: Any) -> Any:
    if isinstance(value, str):
        return redact_secret_text(value)
    if isinstance(value, list):
        return [redact_secret_value(item) for item in value]
    if isinstance(value, dict):
        return {key: redact_secret_value(item) for key, item in value.items()}
    return value


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, content: str) -> None:
    ensure_dir(path.parent)
    path.write_text(content, encoding="utf-8")


def read_jsonish(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    text = read_text(path).strip()
    if not text:
        return default
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise FengError(f"{path} is not valid JSON-compatible YAML: {exc}") from exc


def write_jsonish(path: Path, value: Any) -> None:
    write_text(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def find_workspace(start: Path | None = None) -> Path | None:
    cur = (start or Path.cwd()).resolve()
    for candidate in [cur, *cur.parents]:
        if (candidate / ROOT_MARKER).exists():
            return candidate
    return None


def workspace_or_cwd(start: Path | None = None) -> Path:
    return find_workspace(start) or (start or Path.cwd()).resolve()


def safe_join(root: Path, raw_path: str) -> Path:
    if not raw_path:
        raise FengError("path is required")
    path = Path(raw_path)
    if path.is_absolute():
        target = path.resolve()
    else:
        target = (root / path).resolve()
    root_resolved = root.resolve()
    if target != root_resolved and root_resolved not in target.parents:
        raise FengError(f"path escapes workspace: {raw_path}")
    return target


def rel_path(root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return str(path)


def matches_any(path: str, patterns: list[str]) -> bool:
    normalized = path.replace("\\", "/")
    return any(fnmatch.fnmatch(normalized, pattern) for pattern in patterns)


def run_process(
    args: list[str],
    cwd: Path,
    timeout: int = 60,
    shell: bool = False,
    env: dict[str, str] | None = None,
) -> tuple[int, str]:
    try:
        proc = subprocess.run(
            args if not shell else " ".join(args),
            cwd=str(cwd),
            env={**os.environ, **env} if env else None,
            capture_output=True,
            text=True,
            timeout=timeout,
            shell=shell,
            encoding="utf-8",
            errors="replace",
        )
        output = (proc.stdout or "") + (proc.stderr or "")
        return proc.returncode, output
    except subprocess.TimeoutExpired as exc:
        output = ((exc.stdout or "") + (exc.stderr or ""))
        return 124, f"command timed out after {timeout}s\n{output}"


def copytree_filtered(src: Path, dst: Path, exclude: set[str]) -> None:
    def ignore(_directory: str, names: list[str]) -> set[str]:
        return {name for name in names if name in exclude}

    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst, ignore=ignore)


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)

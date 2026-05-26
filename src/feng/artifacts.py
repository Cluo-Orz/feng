from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .events import append_event
from .utils import ensure_dir, redact_secret_text, sha256_text, slugify, utc_ms, write_text


def artifacts_dir(workspace: Path) -> Path:
    return workspace / ".feng" / "artifacts"


def write_artifact(
    workspace: Path,
    artifact_type: str,
    source: str,
    content: str,
    summary: str,
    why_relevant: str = "",
    extension: str = "txt",
    snippets: list[str] | None = None,
) -> dict[str, Any]:
    content = redact_secret_text(content)
    source = redact_secret_text(source)
    summary = redact_secret_text(summary)
    why_relevant = redact_secret_text(why_relevant)
    snippets = [redact_secret_text(item) for item in snippets or []]
    digest = sha256_text(content)
    name = f"{utc_ms()}-{slugify(artifact_type)}-{digest[:10]}.{extension}"
    path = artifacts_dir(workspace) / name
    write_text(path, content)
    meta = {
        "type": artifact_type,
        "source": source,
        "path": f".feng/artifacts/{name}",
        "hash": digest,
        "summary": summary,
        "why_relevant": why_relevant,
        "snippets": snippets,
    }
    meta_path = path.with_suffix(path.suffix + ".json")
    write_text(meta_path, json.dumps(meta, ensure_ascii=False, indent=2) + "\n")
    append_event(workspace, "artifact_written", meta)
    return meta


def list_artifacts(workspace: Path) -> list[dict[str, Any]]:
    directory = artifacts_dir(workspace)
    ensure_dir(directory)
    items: list[dict[str, Any]] = []
    for meta_path in sorted(directory.glob("*.json")):
        try:
            items.append(json.loads(meta_path.read_text(encoding="utf-8")))
        except json.JSONDecodeError:
            items.append({"type": "invalid_artifact", "path": str(meta_path)})
    return items

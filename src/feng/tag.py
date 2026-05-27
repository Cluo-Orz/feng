from __future__ import annotations

import re
from pathlib import Path

from .events import append_event
from .git_utils import current_head, git, self_status_short
from .state import load_state


TAG_RE = re.compile(r"[A-Za-z0-9._-]+")


def create_validated_tag(workspace: Path, name: str) -> str:
    name = name.strip()
    if not TAG_RE.fullmatch(name):
        raise RuntimeError("tag name must contain only letters, numbers, dot, dash, or underscore")
    state = load_state(workspace)
    validated_commit = state.get("validated_commit", "")
    if state.get("candidate_status") != "validated" or not validated_commit:
        raise RuntimeError("tag requires candidate_status=validated; run feng check first")
    if current_head(workspace) != validated_commit:
        raise RuntimeError("tag requires HEAD to match the validated commit; run feng check first")
    if self_status_short(workspace):
        raise RuntimeError("tag requires clean feng self roots")
    code, _ = git(workspace, "rev-parse", "--verify", f"refs/tags/{name}", timeout=10)
    if code == 0:
        raise RuntimeError(f"tag already exists: {name}")
    code, output = git(workspace, "tag", name, validated_commit, timeout=30)
    if code != 0:
        raise RuntimeError(output.strip() or "git tag failed")
    append_event(workspace, "tag_created", {"tag": name, "commit": validated_commit})
    return name

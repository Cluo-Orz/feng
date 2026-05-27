from __future__ import annotations

import shutil
from pathlib import Path

from .events import append_event
from .git_utils import SELF_GIT_ROOTS, current_head, ensure_git
from .state import default_state, save_state
from .utils import ensure_dir, read_jsonish, write_jsonish, write_text


DEFAULT_INTERFACE = {
    "commands": ["grow", "check", "hatch", "status", "watch", "artifacts", "gui", "tag"],
}

SELF_FILES = {
    "identity.md": "This is a feng self.\n\nIt starts without project-specific skills. Stable capabilities must grow through candidate files and pass check before becoming validated self.\n",
    "goal.md": "",
    "feng.yaml": {
        "version": 1,
        "name": "feng-workspace",
        "llm": {"provider": "deepseek", "model": "deepseek-chat"},
    },
    "hooks.yaml": {"on_grow": [], "on_check_failed": []},
    "permissions.yaml": {
        "files": {
            "read": ["**"],
            "write": [
                ".gitignore",
                "identity.md",
                "goal.md",
                "feng.yaml",
                "hooks.yaml",
                "permissions.yaml",
                "interface.yaml",
                "config.schema.yaml",
                "skills/**",
                "tools/**",
                "world/**",
                "evals/**",
                "docs/**",
                "src/**",
                "tests/**",
                "cmd/**",
                "internal/**",
                "pkg/**",
                "scripts/**",
                "go.mod",
                "go.sum",
                "go.work",
                "go.work.sum",
            ],
        },
        "commands": {
            "allow": [
                "git status",
                "git diff",
                "git log",
                "rg",
                "python -m",
                "python",
                "pytest",
                "go test",
                "go vet",
                "go build",
            ],
            "deny": [
                "git reset --hard",
                "git push",
                "rm -rf",
                "Remove-Item -Recurse",
                "del /s",
            ],
        },
    },
    "interface.yaml": DEFAULT_INTERFACE,
    "config.schema.yaml": {
        "provider_profiles": ["deepseek"],
        "env": ["DEEPSEEK_API_KEY"],
    },
}


SELF_DIRS = {
    "skills": "Skills grow from candidate files. This directory may be empty.\n",
    "tools": "Tool declarations grow here. MVP supports JSON-compatible *.tool.yaml command wrappers.\n",
    "world": "Stable world descriptions live here. Runtime logs do not.\n",
    "evals": "Candidate and baseline evals live here.\n",
}

RUNTIME_GITIGNORE_LINES = [
    ".feng/lock",
    ".feng/provider.yaml",
    ".feng/provider.json",
    ".feng/gui.html",
    ".feng/state.yaml",
    ".feng/events.jsonl",
    ".feng/artifacts/",
    ".feng/cache/",
    ".feng/runs/",
    "dist/",
]


def is_workspace(path: Path) -> bool:
    return (path / ".feng").exists() and (path / "feng.yaml").exists()


def _ensure_gitignore(workspace: Path) -> bool:
    path = workspace / ".gitignore"
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    lines = set(existing.splitlines())
    missing = [line for line in RUNTIME_GITIGNORE_LINES if line not in lines]
    if not missing:
        return False
    prefix = "" if not existing or existing.endswith("\n") else "\n"
    block = "# feng runtime\n" + "\n".join(missing) + "\n"
    write_text(path, existing + prefix + block)
    return True


def _seed_file(seed_self: Path | None, name: str) -> Path | None:
    if not seed_self:
        return None
    candidate = seed_self / name
    return candidate if candidate.is_file() else None


def _seed_dir(seed_self: Path | None, name: str) -> Path | None:
    if not seed_self:
        return None
    candidate = seed_self / name
    return candidate if candidate.is_dir() else None


def bootstrap(workspace: Path, goal: str = "", seed_self: Path | None = None) -> bool:
    created = False
    ensure_git(workspace)
    if _ensure_gitignore(workspace):
        created = True
    ensure_dir(workspace / ".feng")
    for name in ["artifacts", "cache", "runs"]:
        ensure_dir(workspace / ".feng" / name)
    for name, content in SELF_FILES.items():
        path = workspace / name
        if not path.exists():
            seed = _seed_file(seed_self, name)
            if seed:
                shutil.copy2(seed, path)
            elif isinstance(content, dict):
                write_jsonish(path, content)
            else:
                write_text(path, goal + "\n" if name == "goal.md" and goal else content)
            created = True
    for name, readme in SELF_DIRS.items():
        directory = workspace / name
        seed = _seed_dir(seed_self, name)
        if not directory.exists() and seed:
            shutil.copytree(seed, directory)
            created = True
            continue
        ensure_dir(directory)
        readme_path = directory / "README.md"
        if not readme_path.exists():
            write_text(readme_path, readme)
            created = True
    for name in _seed_optional_names():
        path = workspace / name
        seed = seed_self / name if seed_self else None
        if path.exists() or not seed or not seed.exists():
            continue
        if seed.is_dir():
            shutil.copytree(seed, path)
        else:
            ensure_dir(path.parent)
            shutil.copy2(seed, path)
        created = True
    state_file = workspace / ".feng" / "state.yaml"
    if not state_file.exists():
        state = default_state(goal)
        state["validated_commit"] = current_head(workspace)
        save_state(workspace, state)
        created = True
    if created:
        append_event(workspace, "bootstrap", {"goal": goal})
    return created


def _seed_optional_names() -> list[str]:
    return [name for name in SELF_GIT_ROOTS if name not in SELF_FILES and name not in SELF_DIRS]


def load_self_config(workspace: Path) -> dict:
    return read_jsonish(workspace / "feng.yaml", {})


def self_file_index(workspace: Path) -> list[str]:
    names = [
        "identity.md",
        "goal.md",
        "feng.yaml",
        "hooks.yaml",
        "permissions.yaml",
        "interface.yaml",
        "config.schema.yaml",
    ]
    for directory in SELF_DIRS:
        base = workspace / directory
        if base.exists():
            for path in sorted(base.rglob("*")):
                if path.is_file():
                    names.append(path.relative_to(workspace).as_posix())
    return names

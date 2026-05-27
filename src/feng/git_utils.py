from __future__ import annotations

from pathlib import Path

from .utils import run_process

SELF_GIT_ROOTS = [
    "identity.md",
    "goal.md",
    "feng.yaml",
    "hooks.yaml",
    "permissions.yaml",
    "interface.yaml",
    "config.schema.yaml",
    "skills",
    "tools",
    "world",
    "evals",
    ".gitignore",
    "docs",
    "src",
    "tests",
    "cmd",
    "internal",
    "pkg",
    "scripts",
    "go.mod",
    "go.sum",
    "go.work",
    "go.work.sum",
]


def is_git_repo(workspace: Path) -> bool:
    return (workspace / ".git").exists()


def git(workspace: Path, *args: str, timeout: int = 60) -> tuple[int, str]:
    return run_process(["git", *args], cwd=workspace, timeout=timeout)


def ensure_git(workspace: Path) -> None:
    if not is_git_repo(workspace):
        git(workspace, "init")


def current_head(workspace: Path) -> str:
    code, output = git(workspace, "rev-parse", "--verify", "HEAD", timeout=10)
    return output.strip() if code == 0 else ""


def status_short(workspace: Path) -> str:
    code, output = git(workspace, "status", "--short", timeout=10)
    return output.strip() if code == 0 else ""


def self_git_roots(workspace: Path) -> list[str]:
    roots: list[str] = []
    seen: set[str] = set()
    for rel in SELF_GIT_ROOTS:
        rel = rel.strip().replace("\\", "/").strip("/")
        if not rel or rel == "." or rel.startswith("../") or "/../" in rel or rel in seen:
            continue
        if (workspace / rel).exists() or _tracked_under(workspace, rel):
            seen.add(rel)
            roots.append(rel)
    return sorted(roots)


def _tracked_under(workspace: Path, rel: str) -> bool:
    code, output = git(workspace, "ls-files", "--", rel, timeout=10)
    return code == 0 and bool(output.strip())


def self_status_short(workspace: Path) -> str:
    roots = self_git_roots(workspace)
    if not roots:
        return ""
    code, output = git(workspace, "status", "--short", "--", *roots, timeout=10)
    return output.strip() if code == 0 else ""


def self_diff_summary(workspace: Path) -> str:
    roots = self_git_roots(workspace)
    if not roots:
        return ""
    code, output = git(workspace, "diff", "--stat", "--", *roots, timeout=15)
    return output.strip() if code == 0 else ""


def checkpoint_commit(workspace: Path, message: str) -> str:
    roots = self_git_roots(workspace)
    if not roots:
        return current_head(workspace)
    git(workspace, "add", "-A", "--", *roots, timeout=60)
    _ensure_no_staged_outside_self_roots(workspace, roots)
    if not self_status_short(workspace):
        return current_head(workspace)
    code, output = git(
        workspace,
        "-c",
        "user.name=feng",
        "-c",
        "user.email=feng@example.invalid",
        "commit",
        "-m",
        message,
        timeout=60,
    )
    if code != 0:
        raise RuntimeError(output.strip() or "git checkpoint commit failed")
    return current_head(workspace)


def _ensure_no_staged_outside_self_roots(workspace: Path, roots: list[str]) -> None:
    code, output = git(workspace, "diff", "--cached", "--name-only", timeout=15)
    if code != 0:
        raise RuntimeError(output.strip() or "git staged file check failed")
    outside = [
        line.strip().replace("\\", "/")
        for line in output.splitlines()
        if line.strip() and not _path_under_roots(line.strip(), roots)
    ]
    if outside:
        raise RuntimeError("checkpoint refuses to commit staged files outside feng self roots: " + ", ".join(outside))


def _path_under_roots(path: str, roots: list[str]) -> bool:
    normalized = path.replace("\\", "/").strip("/")
    for root in roots:
        root = root.replace("\\", "/").strip("/")
        if normalized == root or normalized.startswith(root + "/"):
            return True
    return False


def diff_summary(workspace: Path) -> str:
    code, output = git(workspace, "diff", "--stat", timeout=15)
    return output.strip() if code == 0 else ""

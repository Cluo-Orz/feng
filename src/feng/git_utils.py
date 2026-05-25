from __future__ import annotations

from pathlib import Path

from .utils import run_process


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


def checkpoint_commit(workspace: Path, message: str) -> str:
    git(workspace, "add", "-A", timeout=60)
    if not status_short(workspace):
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


def diff_summary(workspace: Path) -> str:
    code, output = git(workspace, "diff", "--stat", timeout=15)
    return output.strip() if code == 0 else ""

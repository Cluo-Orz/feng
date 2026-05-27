from __future__ import annotations

import json
import shutil
from pathlib import Path

from .artifacts import write_artifact
from .events import append_event
from .git_utils import current_head, status_short
from .state import load_state
from .utils import ensure_dir, sha256_text, slugify, write_text


SELF_NAMES = [
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
]


def _copy_self(workspace: Path, dst: Path) -> None:
    ensure_dir(dst)
    for name in SELF_NAMES:
        src = workspace / name
        target = dst / name
        if not src.exists():
            continue
        if src.is_dir():
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(src, target)
        else:
            ensure_dir(target.parent)
            shutil.copy2(src, target)


def _copy_runner(_workspace: Path, dst: Path) -> None:
    src_pkg = Path(__file__).resolve().parent
    target_pkg = dst / "feng"
    if target_pkg.exists():
        shutil.rmtree(target_pkg)
    shutil.copytree(src_pkg, target_pkg, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    write_text(
        dst / "feng_cli.py",
        "from feng.cli import main\n\nif __name__ == '__main__':\n    raise SystemExit(main())\n",
    )


def _write_provider_examples(output: Path) -> None:
    examples = output / "provider-examples"
    ensure_dir(examples)
    write_text(
        examples / "deepseek.yaml",
        json.dumps(
            {
                "id": "deepseek",
                "protocol": "openai_chat",
                "base_url": "https://api.deepseek.com",
                "api_key_env": "DEEPSEEK_API_KEY",
                "default_model": "deepseek-chat",
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
    )
    write_text(
        examples / "deepseek-anthropic.yaml",
        json.dumps(
            {
                "id": "deepseek-anthropic",
                "protocol": "anthropic_messages",
                "base_url": "https://api.deepseek.com/anthropic",
                "api_key_env": "DEEPSEEK_API_KEY",
                "default_model": "deepseek-chat",
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
    )


def _resolve_hatch_output(workspace: Path, clean_name: str, out_dir: Path | None) -> Path:
    workspace = workspace.resolve()
    output_root = out_dir or workspace / "dist"
    if not output_root.is_absolute():
        output_root = workspace / output_root
    output = (output_root / clean_name).resolve()
    try:
        rel = output.relative_to(workspace)
    except ValueError:
        return output
    if rel.parts and rel.parts[0] == "dist":
        return output
    rel_text = rel.as_posix() if rel.parts else "<workspace>"
    raise RuntimeError(f"hatch output inside workspace must be under dist/: {rel_text}")


def hatch(workspace: Path, name: str, out_dir: Path | None = None, portable: bool = True) -> Path:
    clean_name = slugify(name)
    state = load_state(workspace)
    if state.get("candidate_status") != "validated":
        raise RuntimeError("hatch requires candidate_status=validated; run feng check first")
    validated_commit = state.get("validated_commit", "")
    if not validated_commit:
        raise RuntimeError("hatch requires a validated commit; run feng check first")
    if current_head(workspace) != validated_commit:
        raise RuntimeError("hatch requires HEAD to match the validated commit; run feng check first")
    dirty = status_short(workspace)
    if dirty:
        raise RuntimeError("hatch requires a clean working tree so the package maps to a validated commit")
    output = _resolve_hatch_output(workspace, clean_name, out_dir)
    if output.exists():
        shutil.rmtree(output)
    ensure_dir(output)
    _copy_self(workspace, output / "self")
    _copy_runner(workspace, output / "runner")
    entry_py = output / f"{clean_name}.py"
    write_text(
        entry_py,
        "import os\n"
        "import sys\n"
        "from pathlib import Path\n"
        "root = Path(__file__).parent\n"
        "os.environ.setdefault('FENG_SEED_SELF', str(root / 'self'))\n"
        "sys.path.insert(0, str(root / 'runner'))\n"
        "from feng.cli import main\n"
        "raise SystemExit(main())\n",
    )
    write_text(
        output / f"{clean_name}.ps1",
        f"$root = Split-Path -Parent $MyInvocation.MyCommand.Path\npython \"$root\\{clean_name}.py\" @args\n",
    )
    write_text(
        output / f"{clean_name}.cmd",
        f"@echo off\r\npython \"%~dp0{clean_name}.py\" %*\r\n",
    )
    _write_provider_examples(output)
    manifest = {
        "name": clean_name,
        "portable": portable,
        "self_commit": validated_commit,
        "runner_version": "0.1.0",
        "entrypoints": [f"{clean_name}.py", f"{clean_name}.ps1", f"{clean_name}.cmd"],
        "excludes": ["API keys", ".feng/cache", ".feng/runs", "unvalidated candidate"],
    }
    write_text(output / "feng-release.yaml", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    checksums = {}
    for path in sorted(output.rglob("*")):
        if path.is_file():
            checksums[path.relative_to(output).as_posix()] = sha256_text(path.read_text(encoding="utf-8", errors="ignore"))
    write_text(output / "checksums.json", json.dumps(checksums, indent=2, sort_keys=True) + "\n")
    artifact = write_artifact(
        workspace,
        "hatch-preview",
        "feng-hatch",
        json.dumps(manifest, ensure_ascii=False, indent=2),
        f"hatch package created: {output}",
        "hatch packages a validated self into a named command",
        extension="json",
    )
    append_event(workspace, "hatch_created", {"path": str(output), "artifact": artifact})
    return output

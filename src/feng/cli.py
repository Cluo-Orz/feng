from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .artifacts import list_artifacts
from .checks import run_check
from .events import tail_events
from .hatch import hatch
from .kernel import grow as run_grow
from .self_repo import is_workspace
from .state import load_state
from .utils import workspace_or_cwd


def cmd_grow(args: argparse.Namespace) -> int:
    workspace = workspace_or_cwd()
    result = run_grow(workspace, args.goal, max_turns=args.max_turns)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 2


def cmd_check(_args: argparse.Namespace) -> int:
    workspace = workspace_or_cwd()
    if not is_workspace(workspace):
        print("not a feng workspace; run feng grow first", file=sys.stderr)
        return 1
    report = run_check(workspace)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report.get("ok") else 1


def cmd_hatch(args: argparse.Namespace) -> int:
    workspace = workspace_or_cwd()
    out = Path(args.out) if args.out else None
    try:
        path = hatch(workspace, args.name, out_dir=out, portable=args.portable)
    except Exception as exc:
        print(f"hatch failed: {exc}", file=sys.stderr)
        return 1
    print(path)
    return 0


def cmd_status(_args: argparse.Namespace) -> int:
    workspace = workspace_or_cwd()
    if not (workspace / ".feng").exists():
        print("not a feng workspace")
        return 1
    print(json.dumps(load_state(workspace), ensure_ascii=False, indent=2))
    return 0


def cmd_watch(args: argparse.Namespace) -> int:
    workspace = workspace_or_cwd()
    for event in tail_events(workspace, args.limit):
        print(json.dumps(event, ensure_ascii=False))
    return 0


def cmd_artifacts(_args: argparse.Namespace) -> int:
    workspace = workspace_or_cwd()
    for artifact in list_artifacts(workspace):
        print(json.dumps(artifact, ensure_ascii=False))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="feng")
    sub = parser.add_subparsers(dest="command", required=True)

    grow = sub.add_parser("grow", help="grow the current feng workspace")
    grow.add_argument("goal")
    grow.add_argument("--max-turns", type=int, default=12)
    grow.set_defaults(func=cmd_grow)

    check = sub.add_parser("check", help="validate the current candidate")
    check.set_defaults(func=cmd_check)

    hatch_cmd = sub.add_parser("hatch", help="package a validated self")
    hatch_cmd.add_argument("--name", required=True)
    hatch_cmd.add_argument("--out")
    hatch_cmd.add_argument("--portable", action="store_true")
    hatch_cmd.set_defaults(func=cmd_hatch)

    status = sub.add_parser("status", help="show .feng state")
    status.set_defaults(func=cmd_status)

    watch = sub.add_parser("watch", help="show recent events")
    watch.add_argument("--limit", type=int, default=20)
    watch.set_defaults(func=cmd_watch)

    artifacts = sub.add_parser("artifacts", help="list artifacts")
    artifacts.set_defaults(func=cmd_artifacts)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)

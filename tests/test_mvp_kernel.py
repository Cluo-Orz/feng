from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
ENV = {**os.environ, "PYTHONPATH": str(ROOT / "src")}

from feng.permissions import check_command, check_file_write
from feng.tools import active_tool_pack


def env_without_llm_key() -> dict[str, str]:
    return {k: v for k, v in ENV.items() if k != "DEEPSEEK_API_KEY"}


def run_feng(cwd: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "feng", *args],
        cwd=str(cwd),
        env=ENV,
        text=True,
        capture_output=True,
        timeout=30,
    )


class MvpKernelTest(unittest.TestCase):
    def test_bootstrap_and_check(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            result = subprocess.run(
                [sys.executable, "-m", "feng", "grow", "make a tiny agent", "--max-turns", "1"],
                cwd=str(work),
                env=env_without_llm_key(),
                text=True,
                capture_output=True,
                timeout=30,
            )
            self.assertEqual(result.returncode, 2)
            self.assertTrue((work / ".feng" / "state.yaml").exists())
            self.assertTrue((work / "skills" / "README.md").exists())
            self.assertTrue((work / ".gitignore").exists())
            (work / "tools" / "hello.tool.yaml").write_text(
                json.dumps(
                    {
                        "type": "command",
                        "name": "hello_tool",
                        "description": "Say hello through a self repo command tool.",
                        "command": "python -c \"print('hello')\"",
                    }
                ),
                encoding="utf-8",
            )
            (work / "evals" / "smoke.eval.yaml").write_text(
                json.dumps({"type": "command", "command": "python -c \"print('eval ok')\""}),
                encoding="utf-8",
            )
            self.assertIn("hello_tool", [tool.name for tool in active_tool_pack(work, "check", "")])

            check = run_feng(work, "check")
            self.assertEqual(check.returncode, 0, check.stderr + check.stdout)
            self.assertIn('"ok": true', check.stdout)
            self.assertRegex(check.stdout, r'"validated_commit": "[0-9a-f]{40}"')

            status = run_feng(work, "status")
            self.assertEqual(status.returncode, 0, status.stderr)
            self.assertIn('"candidate_status": "validated"', status.stdout)

            artifacts = run_feng(work, "artifacts")
            self.assertEqual(artifacts.returncode, 0, artifacts.stderr)
            self.assertIn("check-report", artifacts.stdout)

    def test_default_permissions_allow_self_runtime_growth(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            result = subprocess.run(
                [sys.executable, "-m", "feng", "grow", "make self editable", "--max-turns", "1"],
                cwd=str(work),
                env=env_without_llm_key(),
                text=True,
                capture_output=True,
                timeout=30,
            )
            self.assertEqual(result.returncode, 2)
            for rel in ["internal/runtime/next.go", "cmd/feng/next.go", "go.mod", "scripts/check.ps1"]:
                path = check_file_write(work, rel)
                self.assertTrue(str(path).endswith(rel.replace("/", os.sep)))
            for command in ["go test ./...", "go vet ./...", "go build ./cmd/feng"]:
                check_command(work, command)

    def test_active_tool_pack_selects_relevant_self_tools(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            result = subprocess.run(
                [sys.executable, "-m", "feng", "grow", "seed tool selection", "--max-turns", "1"],
                cwd=str(work),
                env=env_without_llm_key(),
                text=True,
                capture_output=True,
                timeout=30,
            )
            self.assertEqual(result.returncode, 2)
            (work / "tools" / "api.tool.yaml").write_text(
                json.dumps(
                    {
                        "type": "command",
                        "name": "api_contract_check",
                        "description": "Run API contract checks.",
                        "keywords": ["api", "contract", "http"],
                        "command": "git status --short",
                    }
                ),
                encoding="utf-8",
            )
            (work / "tools" / "news.tool.yaml").write_text(
                json.dumps(
                    {
                        "type": "command",
                        "name": "news_fetch",
                        "description": "Fetch RSS news sources.",
                        "keywords": ["news", "rss"],
                        "command": "git status --short",
                    }
                ),
                encoding="utf-8",
            )
            selected = [tool.name for tool in active_tool_pack(work, "grow", "improve api contract checks")]
            self.assertIn("read_file", selected)
            self.assertIn("run_command", selected)
            self.assertIn("api_contract_check", selected)
            self.assertNotIn("news_fetch", selected)
            check_tools = [tool.name for tool in active_tool_pack(work, "check", "")]
            self.assertIn("api_contract_check", check_tools)
            self.assertIn("news_fetch", check_tools)

    def test_grow_missing_config_keeps_state_observable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            result = subprocess.run(
                [sys.executable, "-m", "feng", "grow", "do one step", "--max-turns", "1"],
                cwd=str(work),
                env=env_without_llm_key(),
                text=True,
                capture_output=True,
                timeout=30,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("missing_config", result.stdout)
            status = run_feng(work, "status")
            self.assertIn('"mode": "missing_config"', status.stdout)
            self.assertIn('"provider"', status.stdout)
            self.assertIn('"api_key_env": "DEEPSEEK_API_KEY"', status.stdout)
            self.assertIn('"missing_config": true', status.stdout)

    def test_bootstrap_is_not_a_public_command(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = run_feng(Path(tmp), "bootstrap", "make a tiny agent")
            self.assertEqual(result.returncode, 2)

    def test_hatch_package_seeds_new_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp) / "maker"
            work.mkdir()
            grow = subprocess.run(
                [sys.executable, "-m", "feng", "grow", "make a portable agent", "--max-turns", "1"],
                cwd=str(work),
                env=env_without_llm_key(),
                text=True,
                capture_output=True,
                timeout=30,
            )
            self.assertEqual(grow.returncode, 2)
            check = run_feng(work, "check")
            self.assertEqual(check.returncode, 0, check.stderr + check.stdout)
            hatch = run_feng(work, "hatch", "--name", "sample", "--portable")
            self.assertEqual(hatch.returncode, 0, hatch.stderr + hatch.stdout)
            package = Path(hatch.stdout.strip())
            self.assertTrue((package / "sample.py").exists())
            self.assertTrue((package / "self" / "identity.md").exists())

            user_work = Path(tmp) / "user"
            user_work.mkdir()
            run = subprocess.run(
                [sys.executable, str(package / "sample.py"), "grow", "continue elsewhere", "--max-turns", "1"],
                cwd=str(user_work),
                env=env_without_llm_key(),
                text=True,
                capture_output=True,
                timeout=30,
            )
            self.assertEqual(run.returncode, 2)
            self.assertTrue((user_work / ".feng" / "state.yaml").exists())
            self.assertTrue((user_work / "identity.md").exists())


if __name__ == "__main__":
    unittest.main()

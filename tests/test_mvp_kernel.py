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
from feng.llm import _anthropic_messages, _normalize_http_error, _openai_like_from_anthropic
from feng.tools import BOOTSTRAP_TOOLS, active_tool_pack, execute_tool


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

    def test_permission_denial_artifacts_are_redacted(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            result = subprocess.run(
                [sys.executable, "-m", "feng", "grow", "seed permission state", "--max-turns", "1"],
                cwd=str(work),
                env=env_without_llm_key(),
                text=True,
                capture_output=True,
                timeout=30,
            )
            self.assertEqual(result.returncode, 2)
            secret_like = "sk-" + "permissionsecret1234567890"
            denied = execute_tool(
                work,
                BOOTSTRAP_TOOLS,
                "write_file",
                {"path": f"private-{secret_like}.txt", "content": "nope"},
            )
            self.assertTrue(denied["is_error"])
            self.assertNotIn(secret_like, denied["content"])
            self.assertTrue(any((work / ".feng" / "artifacts").glob("*permission-denied*.txt")))
            for path in (work / ".feng").rglob("*"):
                if path.is_file():
                    self.assertNotIn(secret_like, path.read_text(encoding="utf-8", errors="replace"))

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

    def test_anthropic_message_mapping(self) -> None:
        system, messages = _anthropic_messages(
            [
                {"role": "system", "content": "kernel"},
                {"role": "user", "content": "hello"},
                {
                    "role": "assistant",
                    "tool_calls": [
                        {
                            "id": "toolu_1",
                            "function": {"name": "read_file", "arguments": '{"path":"docs/a.md"}'},
                        }
                    ],
                },
                {"role": "tool", "tool_call_id": "toolu_1", "content": '{"content":"ok","is_error":false}'},
            ]
        )
        self.assertEqual(system, "kernel")
        self.assertEqual(messages[0]["role"], "user")
        self.assertEqual(messages[1]["content"][0]["type"], "tool_use")
        self.assertEqual(messages[2]["content"][0]["type"], "tool_result")

        openai_like = _openai_like_from_anthropic(
            {
                "content": [{"type": "tool_use", "id": "toolu_2", "name": "write_file", "input": {"path": "docs/b.md"}}],
                "usage": {"input_tokens": 10, "output_tokens": 3, "cache_read_input_tokens": 7},
            }
        )
        message = openai_like["choices"][0]["message"]
        self.assertEqual(message["tool_calls"][0]["function"]["name"], "write_file")
        self.assertEqual(openai_like["usage"]["prompt_cache_hit_tokens"], 7)

    def test_provider_error_status_mapping(self) -> None:
        class FakeHTTPError(Exception):
            code = 529

            def read(self) -> bytes:
                return b"overloaded"

        self.assertEqual(_normalize_http_error(FakeHTTPError()).kind, "transient")

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
            self.assertIn("anthropic_messages", (package / "provider-examples" / "deepseek-anthropic.yaml").read_text(encoding="utf-8"))

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

    def test_check_rejects_broken_go_source(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            grow = subprocess.run(
                [sys.executable, "-m", "feng", "grow", "reject broken go source", "--max-turns", "1"],
                cwd=str(work),
                env=env_without_llm_key(),
                text=True,
                capture_output=True,
                timeout=30,
            )
            self.assertEqual(grow.returncode, 2)
            (work / "go.mod").write_text("module brokenpy\n\ngo 1.26\n", encoding="utf-8")
            broken = work / "internal" / "runtime" / "broken.go"
            broken.parent.mkdir(parents=True, exist_ok=True)
            broken.write_text("package runtime\n\nfunc broken(\n", encoding="utf-8")
            check = run_feng(work, "check")
            self.assertEqual(check.returncode, 1)
            self.assertIn("source health failed", check.stdout)
            artifacts = run_feng(work, "artifacts")
            self.assertIn("source-health", artifacts.stdout)


if __name__ == "__main__":
    unittest.main()

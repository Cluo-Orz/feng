from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
TEST_FENG_HOME = Path(tempfile.mkdtemp(prefix="feng-test-home-"))
ENV = {**os.environ, "PYTHONPATH": str(ROOT / "src"), "FENG_HOME": str(TEST_FENG_HOME)}

from feng.permissions import check_command, check_file_write
from feng.llm import LLMError, _anthropic_messages, _normalize_http_error, _openai_like_from_anthropic, _raise_if_openai_output_truncated, load_provider_profile
from feng.lock import acquire_workspace_lock
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


def git_stdout(cwd: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        env=ENV,
        text=True,
        capture_output=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise AssertionError(result.stderr + result.stdout)
    return result.stdout


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
            interface = json.loads((work / "interface.yaml").read_text(encoding="utf-8"))
            self.assertIn("grow", interface["commands"])
            self.assertIn("hatch", interface["commands"])
            self.assertIn("gui", interface["commands"])
            self.assertIn("tag", interface["commands"])
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
            status_json = json.loads(status.stdout)
            self.assertEqual(status_json["last_recovery"], {"type": "", "artifact": ""})

            tag = run_feng(work, "tag", "sample-v1")
            self.assertEqual(tag.returncode, 0, tag.stderr + tag.stdout)
            self.assertIn('"tag": "sample-v1"', tag.stdout)

            gui = run_feng(work, "gui")
            self.assertEqual(gui.returncode, 0, gui.stderr + gui.stdout)
            dashboard = Path(gui.stdout.strip())
            self.assertTrue(dashboard.exists())
            html = dashboard.read_text(encoding="utf-8")
            self.assertIn("Running", html)
            self.assertIn("Progress", html)
            self.assertIn("Artifacts", html)

            artifacts = run_feng(work, "artifacts")
            self.assertEqual(artifacts.returncode, 0, artifacts.stderr)
            self.assertIn("check-report", artifacts.stdout)

    def test_check_does_not_commit_unrelated_untracked_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            result = subprocess.run(
                [sys.executable, "-m", "feng", "grow", "make a scoped checkpoint", "--max-turns", "1"],
                cwd=str(work),
                env=env_without_llm_key(),
                text=True,
                capture_output=True,
                timeout=30,
            )
            self.assertEqual(result.returncode, 2)
            outside = work / "outside-world"
            outside.mkdir()
            (outside / "keep.txt").write_text("not feng self\n", encoding="utf-8")
            check = run_feng(work, "check")
            self.assertEqual(check.returncode, 0, check.stderr + check.stdout)
            self.assertEqual(git_stdout(work, "ls-files", "--", "outside-world/keep.txt").strip(), "")
            self.assertIn("outside-world/", git_stdout(work, "status", "--short"))

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
            (work / "tools" / "secret.tool.yaml").write_text(
                json.dumps(
                    {
                        "type": "command",
                        "name": "secret_tool",
                        "command": f"curl https://example.invalid/{secret_like}",
                    }
                ),
                encoding="utf-8",
            )
            denied_tool = execute_tool(work, active_tool_pack(work, "check", ""), "secret_tool", {})
            self.assertTrue(denied_tool["is_error"])
            self.assertNotIn(secret_like, denied_tool["content"])
            check = run_feng(work, "check")
            self.assertEqual(check.returncode, 1)
            self.assertNotIn(secret_like, check.stdout + check.stderr)
            self.assertTrue(any((work / ".feng" / "artifacts").glob("*permission-denied*.txt")))
            for path in (work / ".feng").rglob("*"):
                if path.is_file():
                    self.assertNotIn(secret_like, path.read_text(encoding="utf-8", errors="replace"))

    def test_check_rejects_invalid_interface(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            result = subprocess.run(
                [sys.executable, "-m", "feng", "grow", "seed invalid interface", "--max-turns", "1"],
                cwd=str(work),
                env=env_without_llm_key(),
                text=True,
                capture_output=True,
                timeout=30,
            )
            self.assertEqual(result.returncode, 2)
            (work / "interface.yaml").write_text(json.dumps({"commands": [""]}), encoding="utf-8")
            check = run_feng(work, "check")
            self.assertEqual(check.returncode, 1)
            self.assertIn("interface.yaml command 0 is empty", check.stdout)
            artifacts = run_feng(work, "artifacts")
            self.assertEqual(artifacts.returncode, 0, artifacts.stderr)
            self.assertIn('"type": "diff"', artifacts.stdout)

    def test_check_ignores_generated_secret_like_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            result = subprocess.run(
                [sys.executable, "-m", "feng", "grow", "seed generated secret scan", "--max-turns", "1"],
                cwd=str(work),
                env=env_without_llm_key(),
                text=True,
                capture_output=True,
                timeout=30,
            )
            self.assertEqual(result.returncode, 2)
            generated = work / "tests" / "__pycache__" / "test.cpython-314.pyc"
            generated.parent.mkdir(parents=True, exist_ok=True)
            generated.write_text("sk-" + "generatedcache1234567890", encoding="utf-8")
            check = run_feng(work, "check")
            self.assertEqual(check.returncode, 0, check.stderr + check.stdout)

    def test_check_rejects_special_runtime_markers_outside_src(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            result = subprocess.run(
                [sys.executable, "-m", "feng", "grow", "seed special runtime check", "--max-turns", "1"],
                cwd=str(work),
                env=env_without_llm_key(),
                text=True,
                capture_output=True,
                timeout=30,
            )
            self.assertEqual(result.returncode, 2)
            marker = work / "internal" / "runtime" / "bad.py"
            marker.parent.mkdir(parents=True, exist_ok=True)
            marker.write_text("feng" + "smith\n", encoding="utf-8")
            check = run_feng(work, "check")
            self.assertEqual(check.returncode, 1)
            self.assertIn("special runtime marker in internal/runtime/bad.py", check.stdout)

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

    def test_list_files_skips_generated_noise_unless_explicit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            result = subprocess.run(
                [sys.executable, "-m", "feng", "grow", "seed list files", "--max-turns", "1"],
                cwd=str(work),
                env=env_without_llm_key(),
                text=True,
                capture_output=True,
                timeout=30,
            )
            self.assertEqual(result.returncode, 2)
            for rel in [
                "docs/important.md",
                "node_modules/pkg/index.js",
                ".feng/cache/noise.txt",
                "build/generated.txt",
            ]:
                path = work / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(rel + "\n", encoding="utf-8")
            root_list = execute_tool(work, BOOTSTRAP_TOOLS, "list_files", {"path": ".", "max_files": 200})
            self.assertFalse(root_list["is_error"], root_list["content"])
            self.assertIn("docs/important.md", root_list["content"])
            self.assertNotIn("node_modules/pkg/index.js", root_list["content"])
            self.assertNotIn(".feng/cache/noise.txt", root_list["content"])
            self.assertNotIn("build/generated.txt", root_list["content"])
            explicit = execute_tool(work, BOOTSTRAP_TOOLS, "list_files", {"path": "node_modules", "max_files": 20})
            self.assertFalse(explicit["is_error"], explicit["content"])
            self.assertIn("node_modules/pkg/index.js", explicit["content"])

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

    def test_openai_output_truncation_is_recoverable_error(self) -> None:
        with self.assertRaises(LLMError) as raised:
            _raise_if_openai_output_truncated({"choices": [{"finish_reason": "length"}]})
        self.assertEqual(raised.exception.kind, "output_truncated")

    def test_provider_profile_can_load_from_feng_home(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as home:
            work = Path(tmp)
            home_path = Path(home)
            (home_path / "provider.yaml").write_text(
                json.dumps(
                    {
                        "id": "home",
                        "protocol": "openai_chat",
                        "base_url": "http://127.0.0.1:7777",
                        "api_key_env": "HOME_LLM_KEY",
                        "default_model": "home-model",
                    }
                ),
                encoding="utf-8",
            )
            old_home = os.environ.get("FENG_HOME")
            old_model = os.environ.get("FENG_LLM_MODEL")
            old_base = os.environ.get("FENG_LLM_BASE_URL")
            try:
                os.environ["FENG_HOME"] = str(home_path)
                os.environ.pop("FENG_LLM_MODEL", None)
                os.environ.pop("FENG_LLM_BASE_URL", None)
                profile = load_provider_profile(work)
            finally:
                if old_home is None:
                    os.environ.pop("FENG_HOME", None)
                else:
                    os.environ["FENG_HOME"] = old_home
                if old_model is None:
                    os.environ.pop("FENG_LLM_MODEL", None)
                else:
                    os.environ["FENG_LLM_MODEL"] = old_model
                if old_base is None:
                    os.environ.pop("FENG_LLM_BASE_URL", None)
                else:
                    os.environ["FENG_LLM_BASE_URL"] = old_base

            self.assertEqual(profile.id, "home")
            self.assertEqual(profile.api_key_env, "HOME_LLM_KEY")
            self.assertEqual(profile.default_model, "home-model")

    def test_provider_profile_can_load_from_default_user_home(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as home:
            work = Path(tmp)
            user_home = Path(home)
            provider_dir = user_home / ".feng"
            provider_dir.mkdir()
            (provider_dir / "provider.yaml").write_text(
                json.dumps(
                    {
                        "id": "default-home",
                        "protocol": "openai_chat",
                        "base_url": "http://127.0.0.1:6666",
                        "api_key_env": "DEFAULT_HOME_LLM_KEY",
                        "default_model": "default-home-model",
                    }
                ),
                encoding="utf-8",
            )
            old_home = os.environ.get("FENG_HOME")
            old_model = os.environ.get("FENG_LLM_MODEL")
            old_base = os.environ.get("FENG_LLM_BASE_URL")
            try:
                os.environ.pop("FENG_HOME", None)
                os.environ.pop("FENG_LLM_MODEL", None)
                os.environ.pop("FENG_LLM_BASE_URL", None)
                with patch("pathlib.Path.home", return_value=user_home):
                    profile = load_provider_profile(work)
            finally:
                if old_home is None:
                    os.environ.pop("FENG_HOME", None)
                else:
                    os.environ["FENG_HOME"] = old_home
                if old_model is None:
                    os.environ.pop("FENG_LLM_MODEL", None)
                else:
                    os.environ["FENG_LLM_MODEL"] = old_model
                if old_base is None:
                    os.environ.pop("FENG_LLM_BASE_URL", None)
                else:
                    os.environ["FENG_LLM_BASE_URL"] = old_base

            self.assertEqual(profile.id, "default-home")
            self.assertEqual(profile.api_key_env, "DEFAULT_HOME_LLM_KEY")
            self.assertEqual(profile.default_model, "default-home-model")

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
            self.assertIn('"provider_config_paths"', result.stdout)
            self.assertIn('"provider_examples"', result.stdout)
            self.assertIn('"required_env"', result.stdout)
            status = run_feng(work, "status")
            self.assertIn('"mode": "missing_config"', status.stdout)
            self.assertIn('"provider"', status.stdout)
            self.assertIn('"api_key_env": "DEEPSEEK_API_KEY"', status.stdout)
            self.assertIn('"missing_config": true', status.stdout)
            self.assertIn('"provider_config_paths"', status.stdout)
            self.assertIn('"provider_examples"', status.stdout)
            self.assertIn('"suggested_provider_profile"', status.stdout)

    def test_bootstrap_is_not_a_public_command(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = run_feng(Path(tmp), "bootstrap", "make a tiny agent")
            self.assertEqual(result.returncode, 2)

    def test_mutating_commands_respect_workspace_lock(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            grow = subprocess.run(
                [sys.executable, "-m", "feng", "grow", "seed lock test", "--max-turns", "1"],
                cwd=str(work),
                env=env_without_llm_key(),
                text=True,
                capture_output=True,
                timeout=30,
            )
            self.assertEqual(grow.returncode, 2)
            with acquire_workspace_lock(work, "test"):
                check = run_feng(work, "check")
                self.assertEqual(check.returncode, 2)
                self.assertIn("workspace_locked", check.stdout)
                blocked_grow = run_feng(work, "grow", "continue", "--max-turns", "1")
                self.assertEqual(blocked_grow.returncode, 2)
                self.assertIn("workspace_locked", blocked_grow.stdout)
                hatch = run_feng(work, "hatch", "--name", "locked", "--portable")
                self.assertEqual(hatch.returncode, 2)
                self.assertIn("workspace_locked", hatch.stdout)
                tag = run_feng(work, "tag", "locked-v1")
                self.assertEqual(tag.returncode, 2)
                self.assertIn("workspace_locked", tag.stdout)
            self.assertFalse((work / ".feng" / "lock").exists())

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
            docs = work / "docs"
            docs.mkdir(exist_ok=True)
            (docs / "design.md").write_text("portable design notes\n", encoding="utf-8")
            (docs / "blob.bin").write_bytes(b"\x00feng-package-bytes\xff\n")
            source = work / "src" / "feng" / "cli.py"
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text("print('seed source')\n", encoding="utf-8")
            runtime_source = work / "internal" / "runtime" / "runtime.go"
            runtime_source.parent.mkdir(parents=True, exist_ok=True)
            runtime_source.write_text("package runtime\n", encoding="utf-8")
            check = run_feng(work, "check")
            self.assertEqual(check.returncode, 0, check.stderr + check.stdout)
            outside = work / "outside-world"
            outside.mkdir()
            (outside / "keep.txt").write_text("not packaged\n", encoding="utf-8")
            hatch = run_feng(work, "hatch", "--name", "sample", "--portable")
            self.assertEqual(hatch.returncode, 0, hatch.stderr + hatch.stdout)
            package = Path(hatch.stdout.strip())
            self.assertTrue((package / "sample.py").exists())
            self.assertTrue((package / "self" / "identity.md").exists())
            self.assertEqual((package / "self" / "docs" / "design.md").read_text(encoding="utf-8"), "portable design notes\n")
            checksums = json.loads((package / "checksums.json").read_text(encoding="utf-8"))
            self.assertEqual(
                checksums["self/docs/blob.bin"],
                hashlib.sha256((package / "self" / "docs" / "blob.bin").read_bytes()).hexdigest(),
            )
            self.assertNotIn("checksums.json", checksums)
            self.assertFalse((package / "self" / "outside-world" / "keep.txt").exists())
            self.assertEqual(git_stdout(work, "ls-files", "--", "outside-world/keep.txt").strip(), "")
            manifest = json.loads((package / "feng-release.yaml").read_text(encoding="utf-8"))
            self.assertIn("grow", manifest["interface"]["commands"])
            self.assertIn("gui", manifest["interface"]["commands"])
            self.assertIn("tag", manifest["interface"]["commands"])
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
            self.assertTrue((user_work / "docs" / "design.md").exists())
            self.assertTrue((user_work / "src" / "feng" / "cli.py").exists())
            self.assertTrue((user_work / "internal" / "runtime" / "runtime.go").exists())

    def test_hatch_rejects_existing_non_package_output(self) -> None:
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
            output = work / "dist" / "sample"
            output.mkdir(parents=True)
            keep = output / "keep.txt"
            keep.write_text("user content\n", encoding="utf-8")
            hatch = run_feng(work, "hatch", "--name", "sample", "--portable")
            self.assertEqual(hatch.returncode, 1)
            self.assertIn("hatch refuses to overwrite existing non-package output", hatch.stderr)
            self.assertEqual(keep.read_text(encoding="utf-8"), "user content\n")

    def test_hatch_rejects_workspace_output_outside_dist(self) -> None:
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
            docs = work / "docs"
            docs.mkdir()
            keep = docs / "keep.md"
            keep.write_text("keep\n", encoding="utf-8")
            check = run_feng(work, "check")
            self.assertEqual(check.returncode, 0, check.stderr + check.stdout)
            hatch = run_feng(work, "hatch", "--name", "docs", "--out", ".", "--portable")
            self.assertEqual(hatch.returncode, 1)
            self.assertIn("hatch output inside workspace must be under dist/", hatch.stderr)
            self.assertEqual(keep.read_text(encoding="utf-8"), "keep\n")

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

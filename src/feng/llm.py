from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .utils import read_jsonish


class LLMError(RuntimeError):
    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind


@dataclass
class ProviderProfile:
    id: str
    protocol: str
    base_url: str
    api_key_env: str
    default_model: str


def default_deepseek_profile() -> ProviderProfile:
    return ProviderProfile(
        id="deepseek",
        protocol="openai_chat",
        base_url="https://api.deepseek.com",
        api_key_env="DEEPSEEK_API_KEY",
        default_model=os.environ.get("FENG_LLM_MODEL", "deepseek-v4-pro"),
    )


def load_provider_profile(workspace: Path) -> ProviderProfile:
    explicit = os.environ.get("FENG_PROVIDER_CONFIG")
    candidates = []
    if explicit:
        candidates.append(Path(explicit))
    candidates.append(workspace / ".feng" / "provider.yaml")
    for path in candidates:
        if path.exists():
            data = read_jsonish(path, {})
            return ProviderProfile(
                id=data.get("id", "provider"),
                protocol=data.get("protocol", "openai_chat"),
                base_url=data.get("base_url", ""),
                api_key_env=data.get("api_key_env", ""),
                default_model=data.get("default_model", data.get("model", "")),
            )
    return default_deepseek_profile()


def _normalize_http_error(exc: urllib.error.HTTPError) -> LLMError:
    body = exc.read().decode("utf-8", errors="replace")
    if exc.code in (401, 402):
        return LLMError("config_error", body or str(exc))
    if exc.code in (429, 500, 503):
        return LLMError("transient", body or str(exc))
    if exc.code in (400, 413, 422):
        if "token" in body.lower() or exc.code == 413:
            return LLMError("prompt_too_long", body or str(exc))
        return LLMError("request_error", body or str(exc))
    return LLMError("provider_error", body or str(exc))


def call_openai_chat(
    profile: ProviderProfile,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    max_output_tokens: int = 4096,
) -> dict[str, Any]:
    api_key = os.environ.get(profile.api_key_env, "")
    if not api_key:
        raise LLMError("missing_config", f"missing env {profile.api_key_env}")
    url = profile.base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": profile.default_model,
        "messages": messages,
        "tools": tools,
        "tool_choice": "auto",
        "max_tokens": max_output_tokens,
        "stream": False,
        "temperature": 0.2,
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise _normalize_http_error(exc) from exc
    except urllib.error.URLError as exc:
        raise LLMError("transient", str(exc)) from exc


def call_llm(
    workspace: Path,
    messages: list[dict[str, Any]],
    tool_schemas: list[dict[str, Any]],
    retries: int = 3,
) -> dict[str, Any]:
    profile = load_provider_profile(workspace)
    if profile.protocol != "openai_chat":
        raise LLMError("request_error", f"unsupported protocol in MVP: {profile.protocol}")
    last: LLMError | None = None
    for attempt in range(retries):
        try:
            return call_openai_chat(profile, messages, tool_schemas)
        except LLMError as exc:
            last = exc
            if exc.kind != "transient":
                raise
            time.sleep(min(2**attempt, 8))
    assert last is not None
    raise last


def extract_assistant_message(response: dict[str, Any]) -> dict[str, Any]:
    choices = response.get("choices") or []
    if not choices:
        return {"role": "assistant", "content": ""}
    return choices[0].get("message", {"role": "assistant", "content": ""})


def normalize_tool_calls(message: dict[str, Any]) -> list[dict[str, Any]]:
    calls = []
    for call in message.get("tool_calls") or []:
        function = call.get("function", {})
        raw_args = function.get("arguments") or "{}"
        try:
            args = json.loads(raw_args)
        except json.JSONDecodeError:
            args = {"_raw": raw_args}
        calls.append({"id": call.get("id", ""), "name": function.get("name", ""), "arguments": args})
    return calls

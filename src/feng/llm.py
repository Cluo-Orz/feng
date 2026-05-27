from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .events import append_event
from .utils import read_jsonish


class LLMError(RuntimeError):
    def __init__(self, kind: str, message: str, partial: dict[str, Any] | None = None):
        super().__init__(message)
        self.kind = kind
        self.partial = partial


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
        default_model=os.environ.get("FENG_LLM_MODEL", "deepseek-chat"),
    )


def load_provider_profile(workspace: Path) -> ProviderProfile:
    for path in provider_config_paths(workspace):
        if path.exists():
            data = read_jsonish(path, {})
            return _apply_provider_env_overrides(ProviderProfile(
                id=data.get("id", "provider"),
                protocol=data.get("protocol", "openai_chat"),
                base_url=data.get("base_url", ""),
                api_key_env=data.get("api_key_env", ""),
                default_model=data.get("default_model", data.get("model", "")),
            ))
    return _apply_provider_env_overrides(default_deepseek_profile())


def provider_home_dir() -> Path | None:
    raw = os.environ.get("FENG_HOME", "").strip()
    if raw:
        return Path(raw)
    try:
        return Path.home() / ".feng"
    except RuntimeError:
        return None


def _apply_provider_env_overrides(profile: ProviderProfile) -> ProviderProfile:
    if os.environ.get("FENG_LLM_MODEL", "").strip():
        profile.default_model = os.environ["FENG_LLM_MODEL"].strip()
    if os.environ.get("FENG_LLM_BASE_URL", "").strip():
        profile.base_url = os.environ["FENG_LLM_BASE_URL"].strip()
    return profile


def provider_status(workspace: Path) -> dict[str, Any]:
    paths = [path.as_posix() for path in provider_config_paths(workspace)]
    examples = [path.as_posix() for path in provider_example_paths()]
    try:
        profile = load_provider_profile(workspace)
    except Exception as exc:
        return {"ok": False, "error": str(exc), "provider_config_paths": paths, "provider_examples": examples}
    missing = not os.environ.get(profile.api_key_env, "")
    return {
        "ok": not missing,
        "id": profile.id,
        "protocol": profile.protocol,
        "base_url": profile.base_url,
        "api_key_env": profile.api_key_env,
        "model": profile.default_model,
        "missing_config": missing,
        "required_env": [profile.api_key_env],
        "provider_config_paths": paths,
        "provider_examples": examples,
        "suggested_provider_profile": {
            "id": profile.id,
            "protocol": profile.protocol,
            "base_url": profile.base_url,
            "api_key_env": profile.api_key_env,
            "default_model": profile.default_model,
        },
    }


def provider_config_paths(workspace: Path) -> list[Path]:
    paths: list[Path] = []
    explicit = os.environ.get("FENG_PROVIDER_CONFIG", "").strip()
    if explicit:
        paths.append(Path(explicit))
    paths.extend([workspace / ".feng" / "provider.yaml", workspace / ".feng" / "provider.json"])
    home = provider_home_dir()
    if home is not None:
        paths.extend([home / "provider.yaml", home / "provider.json"])
    return paths


def provider_example_paths() -> list[Path]:
    base = Path(__file__).resolve().parents[2]
    packaged = base / "provider-examples"
    names = [Path("provider-examples") / "deepseek.yaml", Path("provider-examples") / "deepseek-anthropic.yaml"]
    if packaged.exists():
        return [packaged / "deepseek.yaml", packaged / "deepseek-anthropic.yaml"]
    return names


def _normalize_http_error(exc: urllib.error.HTTPError) -> LLMError:
    body = exc.read().decode("utf-8", errors="replace")
    if exc.code in (401, 402, 403):
        return LLMError("config_error", body or str(exc))
    if exc.code in (429, 500, 503, 529):
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
            raw = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise _normalize_http_error(exc) from exc
    except urllib.error.URLError as exc:
        raise LLMError("transient", str(exc)) from exc
    reason = _openai_output_truncation_reason(raw)
    if reason:
        raise LLMError("output_truncated", f"provider stopped because finish_reason={reason}", partial=raw)
    return raw


def _anthropic_tools(tool_schemas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    tools: list[dict[str, Any]] = []
    for item in tool_schemas:
        function = item.get("function") or {}
        if not function:
            continue
        tools.append(
            {
                "name": function.get("name"),
                "description": function.get("description", ""),
                "input_schema": function.get("parameters") or {"type": "object", "properties": {}},
            }
        )
    return tools


def _anthropic_messages(messages: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    system_parts: list[str] = []
    converted: list[dict[str, Any]] = []

    def append_message(role: str, blocks: list[dict[str, Any]]) -> None:
        if not blocks:
            return
        if converted and converted[-1]["role"] == role:
            converted[-1]["content"].extend(blocks)
        else:
            converted.append({"role": role, "content": blocks})

    for message in messages:
        role = message.get("role", "user")
        content = str(message.get("content", ""))
        if role == "system":
            if content.strip():
                system_parts.append(content)
        elif role == "assistant":
            blocks: list[dict[str, Any]] = []
            if content.strip():
                blocks.append({"type": "text", "text": content})
            for call in message.get("tool_calls") or []:
                function = call.get("function", {})
                raw = function.get("arguments") or "{}"
                try:
                    parsed = json.loads(raw)
                except json.JSONDecodeError:
                    parsed = {"_raw": raw}
                blocks.append({"type": "tool_use", "id": call.get("id", ""), "name": function.get("name", ""), "input": parsed})
            append_message("assistant", blocks)
        elif role == "tool":
            append_message(
                "user",
                [{"type": "tool_result", "tool_use_id": message.get("tool_call_id", ""), "content": content}],
            )
        else:
            if content.strip():
                append_message("user", [{"type": "text", "text": content}])
    return "\n\n".join(system_parts), converted


def call_anthropic_messages(
    profile: ProviderProfile,
    messages: list[dict[str, Any]],
    tool_schemas: list[dict[str, Any]],
    max_output_tokens: int = 4096,
) -> dict[str, Any]:
    api_key = os.environ.get(profile.api_key_env, "")
    if not api_key:
        raise LLMError("missing_config", f"missing env {profile.api_key_env}")
    system, converted_messages = _anthropic_messages(messages)
    payload = {
        "model": profile.default_model,
        "system": system,
        "messages": converted_messages,
        "tools": _anthropic_tools(tool_schemas),
        "tool_choice": {"type": "auto"},
        "max_tokens": max_output_tokens,
        "stream": False,
    }
    req = urllib.request.Request(
        profile.base_url.rstrip("/") + "/v1/messages",
        data=json.dumps(payload).encode("utf-8"),
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            raw = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise _normalize_http_error(exc) from exc
    except urllib.error.URLError as exc:
        raise LLMError("transient", str(exc)) from exc
    converted = _openai_like_from_anthropic(raw)
    if raw.get("stop_reason") == "max_tokens":
        raise LLMError("output_truncated", "provider stopped because stop_reason=max_tokens", partial=converted)
    return converted


def _raise_if_openai_output_truncated(response: dict[str, Any]) -> None:
    reason = _openai_output_truncation_reason(response)
    if reason:
        raise LLMError("output_truncated", f"provider stopped because finish_reason={reason}", partial=response)


def _openai_output_truncation_reason(response: dict[str, Any]) -> str:
    choices = response.get("choices") or []
    if not choices:
        return ""
    reason = str(choices[0].get("finish_reason") or "").strip().lower()
    if reason in {"length", "max_tokens"}:
        return reason
    return ""


def _openai_like_from_anthropic(response: dict[str, Any]) -> dict[str, Any]:
    text: list[str] = []
    tool_calls: list[dict[str, Any]] = []
    for block in response.get("content") or []:
        if block.get("type") == "text" and block.get("text"):
            text.append(block["text"])
        elif block.get("type") == "tool_use":
            tool_calls.append(
                {
                    "id": block.get("id", ""),
                    "type": "function",
                    "function": {
                        "name": block.get("name", ""),
                        "arguments": json.dumps(block.get("input") or {}, ensure_ascii=False),
                    },
                }
            )
    usage = response.get("usage") or {}
    normalized_usage: dict[str, Any] = {}
    input_tokens = int(usage.get("input_tokens") or 0)
    output_tokens = int(usage.get("output_tokens") or 0)
    if input_tokens:
        normalized_usage["prompt_tokens"] = input_tokens
    if output_tokens:
        normalized_usage["completion_tokens"] = output_tokens
    if input_tokens or output_tokens:
        normalized_usage["total_tokens"] = input_tokens + output_tokens
    cache_read = int(usage.get("cache_read_input_tokens") or 0)
    if cache_read:
        normalized_usage["cached_tokens"] = cache_read
        normalized_usage["prompt_cache_hit_tokens"] = cache_read
    cache_created = int(usage.get("cache_creation_input_tokens") or 0)
    if cache_created:
        normalized_usage["prompt_cache_miss_tokens"] = cache_created
    return {
        "choices": [{"message": {"role": "assistant", "content": "\n".join(text), "tool_calls": tool_calls}}],
        "usage": normalized_usage,
    }


def call_llm(
    workspace: Path,
    messages: list[dict[str, Any]],
    tool_schemas: list[dict[str, Any]],
    retries: int = 3,
) -> dict[str, Any]:
    profile = load_provider_profile(workspace)
    if profile.protocol not in {"openai_chat", "anthropic_messages"}:
        raise LLMError("request_error", f"unsupported protocol in MVP: {profile.protocol}")
    last: LLMError | None = None
    recovered_truncation = False
    for attempt in range(retries):
        try:
            if profile.protocol == "anthropic_messages":
                response = call_anthropic_messages(profile, messages, tool_schemas)
            else:
                response = call_openai_chat(profile, messages, tool_schemas)
            if recovered_truncation:
                append_event(workspace, "provider_recovered", {"reason": "output_truncated"})
            return response
        except LLMError as exc:
            last = exc
            if exc.kind == "output_truncated" and not recovered_truncation:
                before_tokens = _estimate_messages_tokens(messages)
                messages = _messages_with_output_continuation(messages, exc)
                append_event(
                    workspace,
                    "provider_recovery",
                    {
                        "reason": "output_truncated",
                        "before_tokens": before_tokens,
                        "after_tokens": _estimate_messages_tokens(messages),
                    },
                )
                recovered_truncation = True
                continue
            if exc.kind != "transient":
                raise
            time.sleep(min(2**attempt, 8))
    assert last is not None
    raise last


def _estimate_messages_tokens(messages: list[dict[str, Any]]) -> int:
    text = "".join(str(message.get("role", "")) + str(message.get("content", "")) for message in messages)
    return max(1, len(text) // 4)


def _messages_with_output_continuation(messages: list[dict[str, Any]], exc: LLMError) -> list[dict[str, Any]]:
    recovered = [dict(message) for message in messages]
    if exc.partial:
        assistant = extract_assistant_message(exc.partial)
        if str(assistant.get("content", "")).strip() and not assistant.get("tool_calls"):
            recovered.append(assistant)
    recovered.append(
        {
            "role": "user",
            "content": (
                "The provider truncated the previous assistant output. Continue from the last complete point. "
                "Be concise, prefer valid tool calls when action is needed, and do not repeat already completed text."
            ),
        }
    )
    return recovered


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

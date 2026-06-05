# LLM Provider 调研摘要

## 1. 结论

feng 的 LLM 层分三层：

```text
feng internal LLM layer
  Message / Tool / ToolCall / ToolResult / Usage / Error

provider protocol adapter
  openai_chat
  anthropic_messages

provider profile
  本机配置，引用 env，不保存密钥
```

DeepSeek 使用 OpenAI-compatible Chat Completions 协议：

```yaml
id: deepseek
protocol: openai_chat
base_url: https://api.deepseek.com
api_key_env: DEEPSEEK_API_KEY
model: deepseek-chat
```

## 2. OpenAI Chat

需要支持：

```text
messages
tools
tool_choice
tool_calls
tool role response
usage
finish_reason
```

feng 内部 message 编排不由 provider 决定。adapter 只负责把内部 message/tool schema 转成 OpenAI Chat 格式。

## 3. Anthropic Messages

需要支持：

```text
system
messages
tools
tool_use
tool_result
usage
stop_reason
```

Anthropic adapter 需要把内部 tool call / tool result 转为 content blocks。system messages 可以合并为 Anthropic `system` 字段；其余 message 保持 provider 要求的 user/assistant 顺序。

## 4. DeepSeek Profile

DeepSeek 不是 feng 的特殊 runtime 分支，只是一个 provider profile。

```text
protocol: openai_chat
base_url: https://api.deepseek.com
api_key_env: DEEPSEEK_API_KEY
model: deepseek-chat
```

profile 可以放在：

```text
.feng/provider.yaml
用户 home provider config
.产品名/config.yaml
```

真实 key 只能来自环境变量，不能写入：

```text
.feng/skills
.feng/tools
.feng/prompts
.feng/world
.feng/artifacts
.feng/history
package/self
release manifest
```

## 5. Message and Cache

provider adapter 必须尊重 message compiler 的 token efficiency 设计：

```text
stable prefix first
dynamic suffix later
large content as artifact refs
active tool pack only
usage metrics recorded
```

记录：

```text
prompt_tokens
completion_tokens
total_tokens
cached_tokens if exposed
cache_miss_tokens if inferable
```

写入：

```text
.feng/state.yaml
.feng/events.jsonl
.feng/messages/token-report.json
```

## 6. Error Mapping

```text
missing_config / 401 / 402
  不重试，提示 config/env。

429 / 500 / 503
  退避重试，失败后写 provider-error artifact。

max_tokens / output truncated
  continuation retry。

prompt_too_long
  compact 后重试；仍失败则 blocked。

400 / 422
  adapter/request 错误，写 artifact，下一轮 grow 可修复。
```

## 7. Security

```text
provider profile 只能保存 api_key_env。
禁止保存 api_key/token/authorization/x-api-key 字段。
错误、event、artifact、stdout/stderr 必须脱敏。
hatch package 只能包含 provider examples，不能包含真实 profile 或 key。
```

## 8. MVP 不做

```text
provider router
自动模型 benchmark
多 provider 自动降级
Responses API 混入核心层
厂商私有参数全量暴露给实例能力文件
```

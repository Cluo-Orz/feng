# MVP 模块：LLM Provider

## 职责

LLM 调用层把 feng 内部 request 转成具体厂商协议，并把响应归一化为内部 AssistantTurn。

## 三层

```text
feng LLM layer
  Message / Tool / ToolCall / ToolResult / Usage / Error。

provider protocol adapter
  openai_chat
  anthropic_messages

provider profile
  本机配置，引用 env，不保存密钥。
```

## Provider Profile

示例：

```yaml
id: deepseek
protocol: openai_chat
base_url: https://api.deepseek.com
api_key_env: DEEPSEEK_API_KEY
model: deepseek-chat
```

profile 可以放在：

```text
workspace/.feng/provider.yaml
user home provider config
产品命令的 .产品名/config.yaml
```

真实 API key 必须通过环境变量提供，不能写进 `.feng` 能力文件、artifacts、history 或 hatch package。

## Protocols

MVP 支持：

```text
openai_chat
anthropic_messages
```

DeepSeek 使用 `openai_chat` profile。

## Message Mapping

内部 message 顺序由 message compiler 决定。adapter 只负责协议转换，不改变上下文策略。

```text
system messages
user messages
assistant messages with tool_calls
tool results
```

Anthropic adapter 需要把 system 与 user/assistant/tool_result content block 做对应转换；OpenAI adapter 直接使用 chat messages/tools/tool_calls。

## Usage

provider 返回 usage 时写入：

```text
.feng/state.yaml context_budget
.feng/messages/token-report.json
.feng/events.jsonl message_compiled/llm_called
```

至少记录：

```text
prompt tokens
completion tokens
total tokens
cached tokens if provider exposes them
cache miss tokens if inferable
```

## Recovery

```text
missing_config / 401 / 402
  不重试，进入 missing_config 或 blocked。

429 / 500 / 503
  退避重试，失败后写 provider-error artifact。

max_tokens
  continuation retry。

prompt_too_long
  compact 后重试；仍失败则 blocked。

400 / 422
  视为 adapter/request 错误，写 artifact，下一轮 grow 可修复。
```

## 不变量

```text
provider profile 不是 agent 能力。
api_key_env 只能引用环境变量。
错误输出不能回显真实 key。
adapter 不能把动态内容塞进稳定前缀。
```

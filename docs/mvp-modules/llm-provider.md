# MVP 模块：LLM Provider

## 职责

LLM provider 模块提供 provider-neutral 调用层，并通过 adapter 转换到具体协议。

## 内部对象

```text
LLMRequest
LLMResponse
Message
Tool
ToolCall
ToolResult
Usage
Capability
ProviderProfile
```

## MVP Adapter

```text
openai_chat
  MVP 必须可用，用于 DeepSeek OpenAI-compatible 等 provider。

anthropic_messages
  保留接口，映射 top-level system、tool_use、tool_result。
```

## Provider Profile

provider profile 是本机配置，不是 self repo：

```yaml
id: deepseek
protocol: openai_chat
base_url: https://api.deepseek.com
api_key_env: DEEPSEEK_API_KEY
default_model: deepseek-v4-pro
```

## Recovery

```text
max_tokens
  返回 output_truncated，kernel 决定续写或提高预算。

prompt_too_long
  返回 prompt_too_long，kernel 触发 context recovery。

429 / 500 / 503
  transient，允许退避重试。

401 / 402 / missing_config
  config/account 错误，不重试。

400 / 422
  request_error，写 artifact 供 grow 修复。
```

## 不变量

```text
API key 不进入 self repo、Git、artifact、hatch package。
provider 特殊参数不泄漏进 Message。
usage/cache metrics 必须归一化并记录。
```

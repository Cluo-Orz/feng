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
  MVP 提供最小 adapter，映射 top-level system、tool_use、tool_result。
  这不是 provider router，只是第二种协议形态。
```

## Provider Profile

provider profile 是本机配置，不是 self repo：

```yaml
id: deepseek
protocol: openai_chat
base_url: https://api.deepseek.com
api_key_env: DEEPSEEK_API_KEY
default_model: deepseek-chat
```

查找顺序保持简单：

```text
FENG_PROVIDER_CONFIG
workspace/.feng/provider.yaml|json
FENG_HOME/provider.yaml|json
~/.feng/provider.yaml|json
default deepseek profile
```

用户级配置目录用来让 hatch 出来的命名命令在任意 workspace 复用同一份本机 provider profile；`FENG_HOME` 可覆盖默认 `~/.feng`。

缺少 API key 或本机配置时，`grow/status` 必须输出：

```text
required_env
provider_config_paths
provider_examples
suggested_provider_profile
```

这些提示只包含 env 名、路径和无 key 示例，不包含真实 API key。

## Recovery

```text
max_tokens
  返回 output_truncated；MVP 不把半截输出当成功，先写 provider-error artifact 并进入 blocked，下一轮 grow 可根据 artifact 继续修复。

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
OpenAI-compatible 和 Anthropic Messages 都走同一个 ToolCall / ToolResult 内部结构。
```

# LLM Provider 调研第 4 轮报告

## 1. 本轮目标

最终自检：

```text
是否包含真实 API key
三层模型是否完整
OpenAI 协议层是否足够指导 adapter
Anthropic 协议层是否足够指导 adapter
DeepSeek provider 配置层是否清楚
是否把厂商细节污染到 feng 核心调用层
```

## 2. Secret 检查

检查结果：

```text
没有写入真实 sk- 开头 key。
只保留 DEEPSEEK_API_KEY 环境变量占位。
示例配置文件明确禁止写真实 key。
```

## 3. 三层模型检查

### 3.1 Feng LLM 调用层

已覆盖：

```text
LLMRequest / LLMResponse
Message / Tool / ToolCall / ToolResult
Usage / Cache metrics
Capability
Stream Event
Tool Choice
Structured Output
Token Counting
```

结论：足够指导 feng kernel 和 provider-neutral interface。

### 3.2 协议层

OpenAI-compatible 已覆盖：

```text
Chat Completions request
messages roles
tools / tool_calls / tool response
prompt caching
structured outputs
Responses API 边界
OpenAI-compatible 风险
```

Anthropic Messages 已覆盖：

```text
top-level system
messages content blocks
tool_use / tool_result
prompt caching
tool_choice
工具描述成本
协议风险
```

结论：足够指导两个 adapter。

### 3.3 DeepSeek 配置文件层

已覆盖：

```text
OpenAI-compatible profile
Anthropic-compatible profile
base_url
api_key_env
model aliases / deprecation
function calling
JSON output
thinking / reasoning
prompt cache
error handling
token usage mapping
本机 provider profile 位置
示例配置文件
```

结论：DeepSeek 不污染核心调用层，作为 provider profile 存在。

## 4. 剩余实现期问题

这些不应继续写进调研文档：

```text
具体 TypeScript/Rust/Python interface
provider profile parser
stream parser 代码
tokenizer 选型
adapter 单元测试 fixture
retry/backoff 实现
```

这些应进入实现规格或代码。

## 5. 最终结论

当前调研文档已经覆盖 feng 接入 LLM provider 的关键细节。

后续如果进入实现，建议顺序：

```text
1. 定义 provider-neutral types。
2. 实现 openai_chat adapter。
3. 实现 anthropic_messages adapter。
4. 加载 deepseek provider profile。
5. 编写 tool call / tool result fixture。
6. 编写 usage/cache/error normalization tests。
```

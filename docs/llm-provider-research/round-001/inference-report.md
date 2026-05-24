# LLM Provider 调研第 1 轮报告

## 1. 本轮目标

生成第一版 LLM provider 调研文档，要求覆盖三层：

```text
feng 的 LLM 调用层
OpenAI / Anthropic 协议层
DeepSeek 配置文件层
```

## 2. 已覆盖内容

第一版文档已覆盖：

```text
Feng 内部 LLMRequest / LLMResponse
Message / Tool / ToolCall / ToolResult
Usage / Cache metrics
Capability
OpenAI-compatible Chat Completions 映射
Anthropic Messages 映射
DeepSeek OpenAI-compatible 配置
DeepSeek Anthropic-compatible 配置
DeepSeek key 安全边界
DeepSeek function calling
DeepSeek JSON output
DeepSeek thinking / reasoning
DeepSeek prompt cache
DeepSeek error handling
```

## 3. 第一轮判断

第一版已经能解释：

```text
feng 为什么需要 provider-neutral LLM 调用层
为什么 OpenAI 和 Anthropic 是协议层，不是 self repo 概念
为什么 DeepSeek 应作为 provider profile
为什么 API key 不应进入 repo
```

## 4. 待检查点

下一轮需要检查是否遗漏：

```text
streaming event 归一化
tool_choice 差异
parallel tool call 差异
structured output / JSON mode 边界
token counting
rate limit / retry
model alias 和 deprecation
DeepSeek Anthropic compatibility 的不完整支持
Provider config 的最小字段
```

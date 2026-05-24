# LLM Provider 调研第 2 轮报告

## 1. 本轮目标

对第一版调研做自检，检查是否遗漏 feng 调用 LLM 时会直接用到的协议细节。

## 2. 发现的缺口

第一版缺少这些细节：

```text
streaming event 如何归一化
tool_choice 在 OpenAI / Anthropic / DeepSeek 中的差异
structured output / JSON mode 的降级边界
token counting 是预估还是 provider usage
DeepSeek cache usage 字段如何映射
OpenAI Responses API 和 Chat Completions 的边界
Anthropic 工具描述成本
```

## 3. 已补充到主文档

已补充：

```text
2.8 Stream Event
2.9 Tool Choice
2.10 Structured Output
2.11 Token Counting
3.7 OpenAI Structured Outputs
3.8 OpenAI Responses API
4.7 Anthropic Tool Choice
4.8 Anthropic 工具描述成本
5.11 DeepSeek Streaming
5.12 DeepSeek token usage 映射
```

## 4. 本轮结论

主文档已经从“能接入 provider”补强到“能指导 feng adapter 设计”。

下一轮需要检查：

```text
是否明确了 DeepSeek 配置文件应该放在哪里
是否明确了 workspace self repo 与本机 secret config 的边界
是否明确了 provider profile 的最小字段
是否需要增加示例配置文件
```

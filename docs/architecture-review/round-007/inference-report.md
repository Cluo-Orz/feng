# 第 7 轮推演报告

## 1. 输入变化

本轮新增要求：

```text
message list 和上下文工程只围绕 token efficiency 设计。
必须考虑主流 LLM 的 token 缓存策略。
大内容可以放到文件里，prompt 里只留文件地址。
动态内容不要强行放前面。
system、assistant、user、tool response 必须编排清楚。
```

参考的公开机制：

```text
OpenAI prompt caching
  对重复前缀更友好，缓存命中体现在 cached_tokens。
  设计含义：稳定内容应尽量形成相同前缀。
  https://platform.openai.com/docs/guides/prompt-caching

Anthropic prompt caching
  支持对 tools / system / messages 的前缀设置 cache breakpoint。
  设计含义：工具、系统约束、稳定上下文应在动态消息之前。
  https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
```

本轮不引入复杂 prompt DSL，只从顶层修正 message 编排逻辑。

## 2. 当前架构推演

第 6 轮后的架构已经有 message list：

```text
kernel
self
event
selected context
working state
history summary
output contract
```

这能说明“有哪些材料”，但不够 token efficient。

主要问题是：

```text
event 太靠前
  最新用户输入、tool result、hook 事件每轮都变。
  如果它们放在 selected context 之前，会破坏后续稳定内容的前缀缓存价值。

output contract 太靠后
  如果是稳定输出约束，应该进入稳定 kernel contract。
  如果是任务特定要求，才应该跟随 latest event。

tool result 没有大小规则
  长测试输出、网页正文、文件全文如果直接进入 tool message，会快速吃掉 context。

assistant role 没有边界
  如果把长推理过程长期保存在 assistant message，会降低 token efficiency。

tool schema 没有活跃集概念
  agent 自己造工具后，如果每轮暴露所有工具 schema，工具 tokens 会膨胀。
```

## 3. 更合理的编排

message list 应该按缓存友好顺序编排：

```text
provider tools
  当前 active tool pack。

system: kernel contract
  极小、稳定、跨轮不变。

system: self contract
  identity、goal、self commit、active skill/world/tool index。

optional cached context pack
  反复使用且稳定的 skill/world/example 片段。

user: state manifest
  文件路径、artifact 路径、hash、短摘要、必要片段。

conversation suffix
  最近 user / assistant / tool call / tool response。

user: latest event
  最新用户输入或 hook 事件。
```

这个结构的核心是：

```text
稳定内容前置
动态内容后置
大内容文件化
只把本轮必要工具暴露给模型
```

## 4. 文件引用策略

大内容默认不进入 prompt。

进入 prompt 的应该是：

```text
path
hash
line range 或 section
short summary
why relevant
```

需要全文时，agent 通过 read_file 读取。

这适用于：

```text
长 diff
测试输出
日志
网页正文
API schema
大文件
旧轮次报告
```

如果某个大内容会被多轮反复使用，才把它提升为 cached context pack。

## 5. Tool Response 策略

tool response 必须保持 provider 协议合法，但内容要受控：

```text
短结果
  直接放进 tool message。

长结果
  写入 .feng/artifacts/，tool message 只返回 path、hash、summary、关键片段。
```

这样既能让 assistant 知道工具结果，也不会让 tool output 污染后续上下文。

## 6. 结论

当前架构需要修改 message list 和 context engineering 的顶层描述。

修改不应变成复杂 prompt 系统，只需要把原则改成：

```text
token efficiency first
stable prefix first
dynamic suffix last
large content by reference
active tool pack only
```

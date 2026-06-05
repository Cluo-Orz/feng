# MVP 模块：Message and Context

## 职责

Message compiler 把 `.feng` 实例、workspace 状态、artifacts 和用户最新输入编译成 token-efficient messages。

## Message 顺序

```text
provider tools
system: kernel rules
system: instance summary
optional cached context pack
user: state manifest
conversation suffix
user: latest input/event
```

## 来源

```text
.feng/prompts
  稳定 prompt block 和编排规则。

.feng/skills
  能力 catalog 进入稳定 summary；skill body 只在相关时进入 context pack。

.feng/tools
  工具全集。message 中只暴露 active tool pack schema。

.feng/world
  稳定世界模型。只选相关 excerpt。

.feng/inbox
  raw intake 只作为最新输入或少量引用进入动态后缀；不能进入稳定前缀。

.feng/messages
  编译产物、hash、token 报告和压缩记录。

.feng/artifacts
  大内容引用。

workspace
  当前任务现场，按需索引和读取。
```

## Token Efficiency

规则：

```text
稳定内容靠前。
动态内容靠后。
大内容只放 artifact ref。
source/log/diff 不直接塞进 prompt。
skill/world body 只按相关性选择少量 excerpt。
raw intake 先摘要和引用，等待沉淀；不要把 inbox 全量塞进 prompt。
conversation suffix 只保留最近必要 tool turn。
```

相关性选择使用轻量多语言匹配，支持中文目标和中文 skill/tool/world 描述，不依赖外部分词器。

## `.feng/messages`

每轮写入：

```text
.feng/messages/latest.json
.feng/messages/latest.hash
.feng/messages/token-report.json
```

至少包含：

```text
stable_prefix_hash
active_tool_pack_hash
context_pack_hash
estimated_input_tokens
tool_schema_tokens
context_pack_tokens
provider usage
cache hit/miss if available
compaction events
```

## Context Pressure

处理顺序：

```text
1. 大 tool output 写 artifact。
2. conversation suffix 压缩。
3. 低相关 skill/world 出局。
4. state manifest 裁剪。
5. prompt_too_long reactive compact。
6. 仍失败则 blocked，并写 provider-error artifact。
```

## 不变量

```text
message list 是临时编译结果。
assistant message 不保存长期推理。
tool response 长结果必须 artifact 化。
稳定经验要沉淀回 .feng/skills/world/prompts，而不是长期留在 messages。
```

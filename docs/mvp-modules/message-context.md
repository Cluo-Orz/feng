# MVP 模块：Message and Context

## 职责

Message compiler 把 self repo、runtime state、Git 和 latest event 编译成 token-efficient messages。

## Message 顺序

```text
provider tools
system: kernel contract
system: self contract
optional cached context pack
user: state manifest
conversation suffix
user: latest event
```

## Skill/World 加载

```text
skill/world index
  进入稳定 self contract，可缓存。

source_self_commit
  如果当前 workspace 来自 hatch package，进入 self contract，用于让 agent 感知这一代 self 的来源版本。

workspace file index
  进入动态 state manifest。self roots 优先，普通 world 文件后置；node_modules、vendor、target、build/cache 等生成或依赖目录默认不进入 index。

skill/world body
  只在相关时进入 cached context pack 或动态后缀。

artifact refs
  大内容只放 type/source/path/hash/summary/why_relevant/snippets。
```

## Context Pressure

处理顺序：

```text
0. 如果 state/env 设置 max_input_tokens，调用 provider 前先压缩动态后缀。
1. 大 tool output 写 artifact。
2. 旧 tool result 占位。
3. 历史压缩成 summary。
4. 低相关 skill/world 出局。
5. prompt_too_long 时 reactive compact。
6. 仍失败则 blocked。
```

## Cache Key

```text
provider
model
mode
self commit/tag
stable_prefix_hash
active_tool_pack_hash
context_pack_hash
provider_capability_hash
```

## 不变量

```text
稳定前缀不放本轮动态错误、长日志、完整 diff。
assistant message 不保存长期推理过程。
tool response 短结果可进 message，长结果必须 artifact 化。
```

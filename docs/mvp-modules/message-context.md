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
  MVP 用本轮 goal/request 的关键词匹配 path、标题和正文，只取少量最相关文件的 excerpt；不把整个 skills/ 或 world/ 全量塞入 message。
  如果当前 hook 在 hooks.yaml 中选中了 skill，这些 skill body 优先进入 cached context pack。

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

运行时还要记录 `context_pack_hash` 和 `context_pack_tokens`，用于观察相关 skill/world body 是否进入本轮上下文，以及它们对 token 预算的影响。

## 不变量

```text
稳定前缀不放本轮动态错误、长日志、完整 diff。
skill/world index 可以稳定进入 self contract；body 只能按需进入 cached context pack。
assistant message 不保存长期推理过程。
tool response 短结果可进 message，长结果必须 artifact 化。
```

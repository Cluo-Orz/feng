# MVP 模块：Kernel and Loop

## 职责

Runtime Kernel 只负责一件事：

```text
把 workspace state 编译成 LLM 可行动的环境，并把行动结果写回文件和 Git 语义。
```

核心 loop：

```text
read state/files/git
-> select hook/skill
-> select active tool pack
-> compile messages
-> call LLM
-> execute tool calls through permission
-> write events/artifacts/state
-> repeat
```

每一 turn 都重新执行 `read state/files/git -> compile messages`。tool call 之后保留必要的 assistant/tool suffix，但下一次 LLM 调用必须重新读取 self repo、Git、artifact refs 和 workspace index。这样 agent 修改自己或生成 artifact 后，下一轮能立刻感知最新文件世界，而不是继续使用旧的 state manifest。

MVP 的 hook 只用于选择 skill body，不执行脚本。`on_grow`、`on_check_failed`、`on_execute` 可以从 `hooks.yaml` 引用 skill 名称或路径；命中的 skill body 进入 cached context pack。没有命中时走 seed loop 和关键词相关性选择。

## 输入

```text
self repo files
.feng/state.yaml
.feng/events.jsonl
.feng/artifacts/
Git status/diff/validated commit
latest event
provider profile
```

## 输出

```text
ToolResult
updated self repo candidate
events
artifacts
state snapshot
check result
hatch package
```

## 不变量

```text
只有一个 loop。
grow/check/execute 共享 kernel。
mode 只改变可写边界和 interface，不改变核心机制。
LLM 不能绕过 permission 直接推进 Git validated commit。
```

## 非目标

```text
不内置 feng 自举专用逻辑。
不内置固定项目 skill。
不实现多 agent 团队、cron、MCP 完整生态。
```

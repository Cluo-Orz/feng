# MVP 模块：Tools and Permissions

## 职责

Tools 模块统一暴露能力，Permissions 模块决定每次 tool call 是否可以执行。

## Tool Registry

```text
bootstrap tools
  read_file
  write_file
  list_files
  run_command

self repo tools
  grow 生成的领域工具声明和实现。
```

registry 是全集，active tool pack 是本轮暴露给 LLM 的子集。

self repo tool 可以带少量选择提示：

```text
when / keywords / tags
  帮助本轮 goal/latest event 选择工具。

always
  极少数工具可声明总是候选，但仍受 active pack 数量上限和 permission check 约束。
```

这些字段只影响是否把 tool schema 暴露给 LLM，不授予额外权限。

## Active Tool Pack

选择依据：

```text
mode
latest event
hook/skill
seed loop
permissions
provider capability
```

每轮记录：

```text
active_tool_pack_hash
tool_schema_tokens
selected_tools
selection_reason
```

## Permission Check

每次 tool call 必须经过：

```text
schema validation
permission rule
path/domain/command boundary
dangerous action deny/ask
artifact logging on deny
```

permission deny 必须生成 `permission-denied` artifact 和 `tool_denied` event；tool result、event、artifact 写入前先做 secret-like redaction，避免把 API key 变成恢复材料。

## 不变量

```text
LLM 不能通过 run_command 任意 git reset/push/delete。
Git validated commit/tag 由 kernel 在 check/hatch 后推进。
GUI 不提供 CLI 没有的工具能力。
工具长说明留在 tools/ 文件，active schema 保持短。
```

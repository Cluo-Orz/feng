# MVP 模块：Tools and Permissions

## 职责

Tools 提供行动能力，Permissions 决定每次 tool call 是否可执行。

## Tool Registry

```text
bootstrap tools
  read_file
  write_file
  list_files
  run_command

instance tools
  .feng/tools/*.tool.yaml

packaged tools
  package/self/tools/*.tool.yaml
```

registry 是全集，active tool pack 是本轮暴露给 LLM 的子集。

MVP 的四个 bootstrap tools 是常驻种子能力。领域工具由 grow 写入 `.feng/tools`，或由 hatch package 的 `self/tools` 提供。

工具是 raw world intake 变成可行动能力的桥。仅写入 `.feng/world` 的说明还不代表 feng 能感知或操作世界；需要相应 tool、permission 和 eval 才算稳定能力。

## Tool 类型

MVP 只支持：

```text
type: command
```

`type: mcp` 或其他类型必须被 check 拒绝。MCP 未来只能作为 adapter 接入内部 `Tool / ToolCall / ToolResult`。

## Active Tool Pack

选择依据：

```text
mode
latest input/event
hook-selected skill
tool name/description/when/keywords/tags
permissions
provider capability
```

选择必须支持中英文描述。未命中的领域工具不进入本轮 schema，避免工具增长后撑爆 prompt。

每轮记录：

```text
selected_tools
selection_reason
active_tool_pack_hash
tool_schema_tokens
```

## Command Tool

工具声明：

```yaml
type: command
name: go_test
description: Run Go tests.
command: go test ./...
input_schema:
  type: object
  properties: {}
  required: []
```

LLM 参数不拼接进 shell command。runtime 把参数写入环境变量：

```text
FENG_TOOL_ARGS
FENG_TOOL_NAME
FENG_TOOL_SOURCE
FENG_INSTANCE_DIR
FENG_WORKSPACE_DIR
```

## Permission Check

每次 tool call 必须经过：

```text
schema validation
path boundary
command boundary
permission allow/deny
dangerous action deny
artifact logging on deny
secret redaction
```

`.feng/permissions.yaml` 或 packaged `self/permissions.yaml` 可以扩展边界，但不能关闭 runtime 内建拒绝：

```text
直接写 .git
直接改 runtime-owned state
git reset --hard
git push
rm -rf / Remove-Item -Recurse / del /s
shell control operator 绕过
```

## Trust Gate

当实例状态是 untrusted 时，只允许：

```text
读取实例文件
读取 workspace 文件
运行 feng check 的只读验证
展示 status/artifacts/gui
```

以下行为必须被 deny，并写入 event/artifact：

```text
执行 .feng/tools 里的 command tool
写 workspace
hatch/package
扩大 permissions
```

用户明确确认后，runtime 才能把实例标记为 trusted。

## 文件边界

```text
.feng/skills/tools/prompts/world/evals
  agent 能力，可由 grow/check 控制修改。

.feng/state/events/runs/artifacts/history
  runtime 事实，普通 write_file 不直接改。

workspace files
  用户任务现场，按 permissions 修改。
```

## 不变量

```text
工具只是能力，不授予权限。
GUI 不提供 CLI 没有的工具能力。
工具长说明留在文件，message 中只放 active schema。
permission deny 必须写 artifact 和 event。
没有 eval 证明的领域工具不能进入 hatch 的稳定 self。
untrusted 实例不能执行可变更工具。
```

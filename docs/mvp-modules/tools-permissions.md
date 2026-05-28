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

`list_files` 默认跳过 `.git`、`.feng` 运行目录、依赖目录和构建/cache 目录，避免第一次感知就被噪声吃掉 token；如果明确把这些目录作为 `path` 传入，仍允许在权限范围内列出。

self repo tool 可以带少量选择提示：

```text
when / keywords / tags
  帮助本轮 goal/latest event 选择工具。

always
  极少数工具可声明总是候选，但仍受 active pack 数量上限和 permission check 约束。
```

这些字段只影响是否把 tool schema 暴露给 LLM，不授予额外权限。

hook 命中的 skill 也可以声明本轮需要的工具：

```text
tools:
  - validation_gate
```

这些工具会优先进入 active tool pack。`check` 必须验证 hook 引用的 skill 存在，且 skill 声明的工具名存在于 bootstrap tools 或 self repo tools 中。

self repo 的 command tool 可以声明 `input_schema`。LLM tool call 传入的参数不会拼接到 shell 命令里，而是以 JSON 形式写入环境变量 `FENG_TOOL_ARGS`，并附带 `FENG_TOOL_NAME`、`FENG_TOOL_SOURCE`。这样工具可以读取参数，同时避免 runtime 做字符串模板替换。

command tool 默认在使用者 workspace 中运行。若工具实现随 frozen self 一起打包，例如 `scripts/` 下的辅助程序，可以声明：

```yaml
workdir: self
```

此时命令从 packaged self 目录执行，但仍通过环境变量拿到使用者目录：

```text
FENG_SELF_DIR
FENG_WORKSPACE_DIR
```

这样 hatch 后的业务命令可以调用 frozen self 里的工具实现，同时把实际读写动作作用到用户当前目录。

MVP 的 schema validation 只做小闭环：检查 required 字段和常见 JSON 类型（string、integer、number、boolean、object、array）。校验失败时不执行工具命令，写入 `tool_argument_invalid` event，并把错误作为 tool result 返回给 LLM。

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

permission deny 必须生成 `permission-denied` artifact 和 `tool_denied` event；tool result、event、artifact、check report 和 stdout/stderr 写入前先做 secret-like redaction，避免把 API key 变成恢复材料。

`permissions.yaml` 可以收窄或扩展普通 allow/deny 规则，但不能关闭 runtime 的内建边界。`.git/` 和 `.feng/` 是 kernel-owned 路径，工具不能直接写入；`git reset --hard`、`git push`、`rm -rf`、`Remove-Item -Recurse`、`del /s` 这类破坏性命令也必须始终被拒绝。

## 不变量

```text
LLM 不能通过 write_file 直接改 .git/.feng，也不能通过 run_command 任意 git reset/push/delete。
Git validated commit/tag 由 kernel 在 check/hatch 后推进。
GUI 不提供 CLI 没有的工具能力。
工具长说明留在 tools/ 文件，active schema 保持短。
```

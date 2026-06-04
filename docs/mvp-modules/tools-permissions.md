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

MVP 的四个 bootstrap tools 是常驻种子能力。它们承担最小感知和行动，不做复杂选择；active tool pack 的选择主要约束 grow 后出现的 self repo tools，避免领域工具越来越多后每轮都把全部 schema 放进 prompt。

MVP 的工具不是 MCP 实现。feng 内部稳定协议是 `Tool / ToolCall / ToolResult`；bootstrap tools 和 self repo command tools 都会被归一化成这个内部协议。MCP 未来可以作为新的 tool adapter 接入 Tool Registry，但不能替代内部协议，也不能改变 loop、permission、artifact 和 active tool pack 语义。

MVP 支持的 self repo tool 类型只有：

```text
type: command
```

如果出现 `type: mcp` 或其他类型，`check` 必须拒绝。这样可以避免 validated self 声明了 runtime 还不会执行的工具。

self repo tool 名必须唯一，也不能和四个 bootstrap tool 重名。`check` 必须拒绝重复或 shadow bootstrap 的 tool 名，避免 registry 静默忽略某个工具，导致 self repo 里出现声明了但不可调用的能力。

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

如果 `workdir: self` 工具来自 hatch package，命令执行后必须重新校验 package integrity。工具可以通过 `FENG_WORKSPACE_DIR` 修改用户 workspace，但不能把 packaged `self/` 当作可写状态；一旦 package 被改动，tool result 必须标记为错误，让下一轮 LLM 立即感知问题。

MVP 的 schema validation 只做小闭环：检查 required 字段和常见 JSON 类型（string、integer、number、boolean、object、array）。校验失败时不执行工具命令，写入 `tool_argument_invalid` event，并把错误作为 tool result 返回给 LLM。

`check` 也必须验证 self repo tool 的 `input_schema` 本身：根必须是 object，`properties` 必须是 object，`required` 必须是字符串列表，属性类型只能使用 MVP 支持的常见 JSON 类型。坏 schema 不能进入 validated self。

## Active Tool Pack

选择依据：

```text
bootstrap primitives
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

permission deny 必须生成 `permission-denied` artifact 和 `tool_denied` event；`tool_denied` event 和返回给 LLM 的 `ToolResult` 都要带 artifact 引用。tool result、event、artifact、check report 和 stdout/stderr 写入前先做 secret-like redaction，避免把 API key 变成恢复材料。

`permissions.yaml` 可以收窄或扩展普通 allow/deny 规则，但不能关闭 runtime 的内建边界。`.git/` 和 `.feng/` 是 kernel-owned 路径，工具不能直接写入；`git reset --hard`、`git push`、`rm -rf`、`Remove-Item -Recurse`、`del /s` 这类破坏性命令也必须始终被拒绝。

内建危险命令拒绝不依赖用户写在 `permissions.yaml` 里的 deny 字符串，也不能只做连续字符串匹配。runtime 必须按命令和参数 token 识别这些危险动作，避免 `git -C . reset --hard`、`git.exe reset --hard`、`Remove-Item -LiteralPath x -Recurse`、`rmdir /s` 这类参数顺序、别名或可执行扩展名变化绕过内建边界。

`commands.allow` 缺失或为空时不能表示 allow-all。runtime 使用内置基础命令 allow list 作为默认边界，例如 `git status`、`git diff`、`git log`、`rg` 和基础 `go` 验证命令。需要扩展命令能力时，必须显式写入 allow list。

在 grow workspace 中，`files.write` 不能撤销 self 修复地板：identity、goal、hooks、permissions、skills、tools、world、evals、docs/source roots 和 Go module 文件仍可被 `write_file` 修复。这条修复地板只存在于本地 grow/check self 语义中；hatch 后的 execute mode 使用 frozen self 的 `permissions.yaml` 精确约束使用者 workspace，不继承 grow 的 self 修复写权限。

如果 candidate 把 `permissions.yaml` 删除或写到无法解析，runtime 使用内置 bootstrap 权限作为恢复地板：读 workspace、写 self roots、运行基础 git/go/rg 命令。这个 fallback 只用于让下一轮 grow 修复 self，不允许写 `.git/.feng`，也不能绕过内建危险命令拒绝。一个能解析的自定义 `permissions.yaml` 仍然按文件内容执行。

`check` 必须验证 `permissions.yaml` 的基本 schema：`files.read`、`files.write`、`commands.allow`、`commands.deny` 如果出现，必须是字符串列表。字段类型写错不能被 runtime 静默忽略，否则 agent 会误判自己的权限边界。

## 不变量

```text
LLM 不能通过 write_file 直接改 .git/.feng，也不能通过 run_command 任意 git reset/push/delete。
Git validated commit/tag 由 kernel 在 check/hatch 后推进。
GUI 不提供 CLI 没有的工具能力。
工具长说明留在 tools/ 文件，active schema 保持短。
```

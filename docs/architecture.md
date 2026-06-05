# feng 架构概念

## 1. 产品目标

feng 的目标不是生成一个项目模板，而是提供一个可以在任意目录运行的 agent runtime。

```text
feng binary
  稳定运行框架。

current directory
  用户当前要开发、分析、操作的 workspace。

current directory/.feng
  这个目录里的 agent 实例：能力、目标、工具、上下文工程、状态、历史和产物。
```

用户心智应该很简单：

```text
cd any-project
feng grow "我要完成什么"
```

如果当前目录还没有 `.feng/`，feng 自动创建。之后用户继续用 `feng grow "补充信息"` 喂目标、规则、事实和反馈；feng 负责把这些信息合并到当前实例里，并持续运行直到目标满足、需要配置、预算耗尽或 blocked。

## 2. 四个边界

### Runtime

`feng` 命令是稳定 runtime。它负责：

```text
loop
LLM provider adapter
message compiler
tool dispatcher
permissions
state/events/artifacts
check
hatch
```

runtime 不应该写死某个 agent 的能力，也不应该把 feng 自举做成特殊分支。

### Instance

`.feng/` 是当前目录里的 agent 实例。

```text
.feng/
  instance.yaml
  goal.md
  inbox/
  skills/
  tools/
  prompts/
  messages/
  world/
  evals/
  permissions.yaml
  config.schema.yaml
  state.yaml
  lock
  events.jsonl
  runs/
  artifacts/
  history/
```

`skills/tools/prompts/world/evals` 是可成长能力。`state/events/runs/artifacts/history` 是运行事实。两者都属于这个目录里的 agent 实例，而不是用户项目根目录的普通业务文件。

### Workspace

当前目录是任务现场。feng 可以按权限读取、修改、测试这里的文件，以完成用户目标。

```text
project/
  .feng/
  src/
  docs/
  tests/
  README.md
```

用户项目是否使用 Git、如何提交业务代码，是 workspace 自己的语义。feng 可以读取 Git 事实，也可以在权限允许时执行受控命令，但 runtime 不应默认把整个 workspace 当成自己的能力根。

### Packaged Product

hatch 后的产品命令读取安装包里的 frozen self，而不是把 self 展开到用户目录。

```text
dist/xiaopi/
  xiaopi
  xiaopi.cmd
  feng-runner
  self/
    identity.md
    skills/
    tools/
    prompts/
    world/
    evals/
    interface.yaml
    permissions.yaml
    config.schema.yaml
  provider-examples/
  xiaopi-release.yaml
  checksums.json
```

使用者运行产品时，当前目录只生成运行态：

```text
user-workspace/
  .xiaopi/
    state.yaml
    lock
    events.jsonl
    runs/
    artifacts/
    history/
    config.yaml
```

`self/` 在安装包里，`.xiaopi/` 在用户目录里。这样用户只和 `xiaopi` 交互，不需要理解 feng。

## 3. grow 的语义

`feng grow` 是向当前 `.feng` 实例输入目标或反馈，不是一次孤立问答。

```text
feng grow "做一个 API 测试助手"
feng grow "base url 是 https://example.test"
feng grow "报告要输出 markdown"
```

这些输入进入同一个实例：

```text
.feng/inbox/
.feng/goal.md
.feng/world/
.feng/tools/
.feng/skills/
.feng/evals/
```

feng 内部负责合并信息、更新目标、沉淀世界理解、生成工具和 eval，选择 skill/tool/prompt，并继续长程 loop。

## 4. 自运行 loop

feng 的核心 loop 仍然很小：

```text
read .feng + workspace
-> compile messages
-> llm
-> tool call
-> write .feng/workspace
-> validate
-> continue or stop
```

关键变化是：生命周期编排应该属于 feng runtime，而不是外部 agent。

```text
grow
-> check
-> if failed: read check artifact and grow repair
-> if passed: checkpoint instance
-> optional hatch/tag
```

外界可以补信息，但不应该由 Codex 或另一个 agent 手动驱动每一轮 check/hatch/repair。

`done` 不能由 LLM 口头声明。至少需要：

```text
目标已被当前 goal/run state 接收。
相关 raw intake 已被消化或明确搁置。
至少一个 eval/check 覆盖目标成功标准。
覆盖目标的 eval/check 通过。
要发布的 ability closure 完整且受 permission 约束。
```

## 5. Skills、Tools、Prompts、Messages

`.feng/skills` 是能力说明。

```text
when
goal
context
tools
output
checks
```

`.feng/tools` 是工具定义和工具说明。初始只有四个基础工具的声明和边界：

```text
read_file
write_file
list_files
run_command
```

后续长出来的工具也进入 `.feng/tools`，并经过 permission、schema、check。

`.feng/prompts` 保存可迭代的 prompt block 或编排规则。它不是让用户维护一大坨 prompt，而是让 feng 能观察和优化自己的 context engineering。

`.feng/messages` 保存每轮实际编译出来的 message list、hash、token 统计和压缩记录。message 是运行时产物，prompt/skill/world 是可成长材料。

## 6. World Intake、沉淀和验证

feng 不要求用户把世界描述成固定格式。世界信息可以是任意形式：

```text
自然语言描述
OpenAPI 文件
curl 示例
代码仓库
日志
网页
设备 SDK
传感器说明
桌面目录
数据库 schema
```

这些原始输入先进入 `.feng/inbox` 或 artifacts。feng 不能假设它们已经是稳定知识。

真正的成长过程是：

```text
raw intake
  用户给出的任意世界信息。

world notes
  feng 对世界的当前稳定理解，写入 .feng/world。

tools
  feng 为了感知或操作这个世界长出的工具，写入 .feng/tools。

evals
  feng 为了证明能力有效长出的检查，写入 .feng/evals。

skills
  feng 如何结合 world/tools/evals 完成目标，写入 .feng/skills。
```

所以核心不是固定的 world schema，而是元规则：

```text
能被工具感知。
能被权限约束。
能被 eval 验证。
能被 skill 复用。
```

只有满足这些条件的材料，才算从 raw intake 沉淀成稳定能力。

示例：

```text
用户说：电机控制方式是 xxx，传感器返回 yyy
-> .feng/world/car-control.md
-> .feng/tools/read-sensor.tool.yaml
-> .feng/tools/set-motor.tool.yaml
-> .feng/evals/avoid-obstacle.yaml
-> .feng/skills/drive-safely.md
```

```text
用户给 OpenAPI / curl 示例
-> .feng/world/api.md
-> .feng/tools/http-request.tool.yaml
-> .feng/evals/login-smoke.yaml
-> .feng/skills/api-testing.md
```

## 7. Config、Args、Artifacts

```text
config
  本机事实，例如 token env、设备地址、用户偏好。

args
  单次运行输入。

artifacts
  运行证据，例如日志、diff、测试报告、网页正文。
```

长内容默认文件化。message 中只放路径、hash、summary、why_relevant 和必要片段。

## 8. Checkpoint 和历史

`.feng/history` 是 agent 实例的成长历史。它至少记录：

```text
user inputs
message hashes
tool calls
check results
validated instance snapshots
artifacts
```

check 失败不强制回滚。失败报告进入 `.feng/artifacts`，下一轮 grow 读取它并修复。只有 check 通过，才把 `.feng` 中的能力变化推进为 validated instance。

如果当前 workspace 自己有 Git，feng 可以把 Git status/diff/log 作为世界事实使用。是否提交用户项目文件，应由权限、skill 和用户目标明确决定，不能和 `.feng` 实例 checkpoint 混为一谈。

用户后续输入可能推翻旧理解。新 intake 与 validated 能力冲突时，feng 必须记录 revision，标记受影响的 world/tool/skill/eval stale，并重跑相关 eval。eval 通过前，旧能力不能被静默替换成新 validated 能力。

`.feng` 里可以包含 command tools，因此外来 `.feng` 不能默认可信。从 clone、download 或 copy 得到的实例默认是 untrusted：可以 inspect 和只读 check，但不能执行 `.feng/tools`、不能写 workspace、不能 hatch，直到用户明确确认信任。

## 9. feng 自迭代

当 feng 迭代自己时，当前目录是 feng 源码仓库，`.feng/` 是负责迭代 feng 的 agent 实例。

```text
feng/
  .git/
  cmd/
  internal/
  docs/
  go.mod
  .feng/
    goal.md
    skills/iterate-feng.md
    tools/go-test.tool.yaml
    tools/hatch-feng.tool.yaml
    prompts/
    messages/
    world/runtime-boundary.md
    evals/
    state.yaml
    artifacts/
    history/
```

`cmd/ internal/ docs/` 是被修改对象；`.feng/` 是孵化器和成长记忆；`feng` binary 是执行这个孵化器的 runtime。

## 10. Hatch

`hatch` 把当前实例的 validated ability closure 打包成命名命令。

```text
feng hatch --name xiaopi --portable
```

产物包含：

```text
runner
frozen self
manifest
checksums
provider examples
launchers/install scripts
```

使用者得到的是 `xiaopi`，不是一个 feng workspace。

ability closure 是 skill 及其依赖的 tools/world/prompts/evals/permissions/config schema。hatch 不打包 inbox、messages、runs、artifacts、本地 history、provider profile、secret 或未通过 eval 的候选能力。

## 11. 非目标

MVP 不做：

```text
多 agent 团队
插件市场
复杂 hook 脚本系统
完整 MCP transport
provider router
复杂后台 daemon
自动管理用户项目 Git 历史
```

MCP 未来可以作为 tool adapter 接入内部 `Tool / ToolCall / ToolResult`，但不能替代 feng 的内部工具协议。

## 12. 一句话

```text
feng 是运行框架。
.feng 是当前目录里 agent 的身体、能力和记忆。
workspace 是 agent 工作的世界。
hatch 后的命名命令读取安装包 self，并在用户目录写自己的运行态。
```

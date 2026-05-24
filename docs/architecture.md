# feng 架构概念

## 1. 一句话

feng 的目标是把一个想法孵化成一个可以直接运行的命令。

```text
idea -> teach -> try -> release -> xiaogui
```

创造者使用 feng，使用者使用被 release 出来的命令。

```text
feng new xiaogui
feng teach "帮我整理下载目录"
feng try
feng release --name xiaogui --portable

xiaogui --input ./Downloads
```

## 2. 顶层模型

feng 只有两个核心部分：

```text
Runtime Kernel
  稳定小内核：loop、LLM adapter、工具调度、验证、版本、release、状态记录。

Self Repo
  agent 的自我：由文件组成，受 Git 管理，可以成长。
```

kernel 尽量稳定，self repo 才成长。agent 改坏 self repo 时，坏掉的是下一版候选 self，不是当前正在运行的 kernel。

一个 feng 目录就是一个 workspace：

```text
workspace = self repo + .feng runtime state + Git history
```

同一个 workspace 同一时间只允许一个 feng kernel 修改 self。

## 3. 两个界面

feng 要易用，必须把内部结构藏起来。

创造者界面：

```text
new      创建一个起始 self
teach    教它规则、示例、能力
try      试运行并验证
release 生成命名命令
```

使用者界面：

```text
xiaogui
xiaogui --help
xiaogui --input ./Downloads
```

`skills`、`evals`、`permissions`、Git 版本都是内部结构。创造者可以打开精修，但默认流程不要求先理解它们。

## 4. Self Repo

self repo 是少量约定文件，不是复杂工程。

```text
identity.md         agent 是谁，基础边界是什么
goal.md             当前成长目标
skills/             agent 学会的能力
hooks.yaml          哪些事件点启用哪些 skill
tools/              工具声明和实现
world/              对外部世界的描述
evals/              怎么判断 agent 有效
interface.yaml      release 后暴露哪些参数
permissions.yaml    需要哪些文件、命令、网络权限
config.schema.yaml  首次运行需要哪些配置
feng.yaml           self 元信息
```

运行产物不属于 self：

```text
.feng/state.yaml
.feng/lock
.feng/events.jsonl
.feng/artifacts/
.feng/runs/
.feng/cache/
```

运行产物可以被读取，但默认不提交。只有 agent 明确沉淀下来的经验，才写回 self repo。

### World

`world/` 是 agent 面对的外部环境说明书，不是运行日志，也不是长期记忆垃圾桶。

```text
world   = 外部环境有哪些对象、规则和稳定约束
tools   = 读取或改变外部世界的接口
skills  = 处理外部世界的能力
permissions = 允许接触外部世界的边界
artifacts = 运行过程中留下的证据
```

稳定环境事实进入 `world/`。运行过程进入 `.feng/artifacts/`。只有对未来执行有稳定价值的经验，才由 agent 明确沉淀回 self repo。

context assembly 只选择和当前事件相关的 world 片段，不把整个 world 塞进每轮 context。

## 5. Workspace State

feng 不使用用户可见的 session/resume 模型。运行状态属于 workspace，放在 `.feng/` 里。

```text
.feng/state.yaml
  当前状态快照。

.feng/lock
  单写锁和心跳，防止同目录多个 feng 同时修改 self。

.feng/events.jsonl
  append-only 事件流，用来观察 running 和 progress。

.feng/artifacts/
  本次运行产物，例如 diff、eval 结果、release 预览、失败报告。
```

`state.yaml` 只记录当前生命体征：

```yaml
status: running   # idle | running | waiting | repair | ready | failed
mode: teach       # teach | try | release | execute
phase: updating_skills
current_action: writing skills/file_organizer/SKILL.md
candidate: dirty
updated_at: 2026-05-24T10:30:00Z
```

中断后不需要 `resume`。下一次 `feng teach`、`feng try` 或 `feng status` 都先读取 self repo、Git 和 `.feng/state.yaml`，自然从当前 workspace 状态继续。

## 6. 可观测性

feng 的可观测性也只靠文件和简单命令。

```text
feng status
  读取 state.yaml、lock 和 Git 状态，告诉用户现在是否在运行、卡在哪里、candidate 是否可用。

feng watch
  读取 events.jsonl，展示运行时间线。

feng artifacts
  列出 artifacts/ 里的 diff、eval 结果、失败报告、release 预览。
```

事件流保持简单：

```json
{"type":"phase","message":"reading self repo"}
{"type":"tool_call","tool":"write_file","path":"skills/file_organizer/SKILL.md"}
{"type":"eval","name":"organize_pdf","status":"passed"}
{"type":"candidate","status":"validated"}
```

GUI 也只是这些文件的可视化：running、progress、artifact 三种视图。

## 7. Loop 和上下文

feng 只有一个基础 loop：

```text
read files
  -> assemble context
  -> llm
  -> hook
  -> call tool
  -> hook
  -> read files
```

这里的上下文组装不是让用户维护很多最终 prompt，而是 kernel 每轮从 self repo 和运行状态里取材料，组装成本轮 LLM messages。

核心关系：

```text
hook   = 什么时候介入
skill  = 用什么能力介入
tool   = 对外部世界做什么动作
message = 本轮临时组装出的 LLM 输入
```

例如：

```yaml
# hooks.yaml
before_tool:
  - command_safety

after_tool:
  - result_summarizer
```

当事件是 `before_tool` 且工具是 `run_command`，kernel 把 `command_safety`、当前命令、权限边界和任务状态组装成 messages，让 LLM 判断是否安全。

### Context Budget

context 控制必须是 kernel 的基础能力，而不是后期再补的记忆系统。

每轮上下文分成四层：

```text
core
  identity、当前目标、当前模式、当前事件。永远保留。

selected
  本轮相关的 skill、tool 说明、world 片段。按相关性选择。

working
  当前任务状态、最近工具结果、candidate diff、失败原因。

history
  较早事件、旧工具输出、长日志、历史对话。最先压缩或移出。
```

当 context 超长时，处理顺序固定：

```text
1. 大 artifact 不直接进 context，只放路径和摘要。
2. 历史事件合并成 summary。
3. 低相关 skill 不进入本轮 context。
4. world 只取和当前事件相关的片段。
5. 仍然超长时，停止并要求用户缩小任务或增加预算。
```

压缩结果也写回文件，而不是只留在内存里：

```text
.feng/artifacts/summaries/
.feng/state.yaml
```

原则是：

```text
原始证据进 artifacts。
短摘要进 context。
稳定经验才沉淀回 self repo。
```

这样 context 不会无限增长，也不会把运行日志误当成 self 的一部分。

## 8. Skill 是成长单位

feng 不以散乱 prompt 片段作为主要成长单位，而以 skill 作为主要成长单位。

```text
skills/
  command_safety/
    skill.yaml
    SKILL.md
    evals/
    scripts/
```

`skill.yaml` 描述什么时候生效，`SKILL.md` 描述能力内容。未来如果 hook 需要脚本，脚本也属于 skill，由 hook 事件触发。

所以不是 skill 替代 hook，而是：

```text
hook 调度 skill
skill 提供能力
kernel 组装上下文
```

### Tool Growth

初始四个工具是 bootstrap tools：

```text
read_file
write_file
list_files
run_command
```

领域工具属于 self repo。teach 可以新增或修改工具声明和实现，例如 HTTP 请求工具、传感器读取工具、桌面操作工具。

```text
tools/
  fetch_http/
    tool.yaml
    handler.*
  read_sensor/
    tool.yaml
    handler.*
```

try 必须验证领域工具：

```text
tool schema 能解析
handler 能加载
permissions.yaml 覆盖该工具需要的能力
至少一个相关 eval 能通过
```

release 只打包 validated tools。runner 在每次 tool call 前检查 permissions；没有权限就进入 waiting，要求用户确认或修改本地配置。

## 9. Teach、Try、Release

`teach` 是用户侧的成长入口。

```text
feng teach "pdf 放到 docs，图片放到 images"
feng teach --example ./before --expect ./after
```

teach 可能修改：

```text
skills/
hooks.yaml
evals/
interface.yaml
permissions.yaml
```

`teach` 可能是长任务，但它不是用户需要 resume 的 session。它只是推动当前 workspace 孵化到一个停靠点：

```text
candidate validated
需要用户补充信息
candidate 进入 repair
用户中断
```

停靠点都会写入 `.feng/state.yaml`、`.feng/events.jsonl` 和 `.feng/artifacts/`。

`try` 是验证入口，只回答三个问题：

```text
能不能启动
会不会按示例做事
还缺什么权限或配置
```

用户在 teach 里给出的示例，应该能沉淀成 `evals/`。这样 eval 不是额外负担，而是教学过程的一部分。

`evals/` 第一版只需要支持少量最小形态：

```text
example
  输入和期望输出。

fixture
  示例文件、目录、API spec、传感器帧等固定材料。

mock
  模拟 HTTP 响应、传感器输入或命令输出。

command
  运行一个受限命令并检查结果。
```

eval 产物写入 `.feng/artifacts/`，不会直接污染 self repo。

`release` 把 validated self 变成命名命令。

```text
release = validated self + runner + manifest + checksums
```

输出：

```text
dist/xiaogui/
  xiaogui
  xiaogui.ps1
  install
  install.ps1
  feng-runner
  self/
  feng-release.yaml
  checksums.json
```

使用者路径应该只有：

```text
./install
xiaogui
```

或者：

```text
./xiaogui
```

## 10. 长任务保证

feng 的长任务保证不是靠复杂工作流引擎，而是靠 workspace 可恢复。

```text
单写锁
  .feng/lock 保证同一 workspace 只有一个 kernel 在写。

状态快照
  .feng/state.yaml 表示当前运行状态。

事件日志
  .feng/events.jsonl 记录每一步重要动作。

成长现场
  Git working tree 保留 candidate 修改，不因为失败自动丢弃。

运行产物
  .feng/artifacts/ 保存 diff、eval、失败报告和 release 预览。
```

因此中断不是特殊流程。下次命令重新读取文件系统和 Git 状态，继续推动同一个 workspace。

## 11. 成长版本

Git 是 self repo 的成长介质，不只是回滚工具。

```text
validated commit = 可以启动的一版 self
working tree      = 正在孵化的 candidate self
tag               = 被命名和固定的一版 self
```

candidate 验证失败时，不自动丢弃。当前 agent 继续从上一版 validated commit 运行，同时修复 working tree 里的 candidate。

candidate 验证通过后，promote 成新的 validated commit。达到目标后，可以 tag 并 release。

## 12. 模板

模板只是起始 self repo，不是插件市场。

第一版只支持：

```text
builtin template  feng 自带模板
local template    本地 self repo
```

命令：

```text
feng templates
feng new xiaogui
feng new xiaogui --template file-agent
feng new xiaogui --template ./my-template
```

默认模板应该足够好，让 `feng new xiaogui` 不需要额外参数。

## 13. 权限和配置

安全和跨机器运行是传播的关键，但不需要复杂架构。

`permissions.yaml` 进入 release manifest，第一次运行时展示普通人能懂的摘要：

```text
xiaogui 会读取 Downloads。
xiaogui 会写入 Organized。
xiaogui 不会删除原文件。
xiaogui 需要 LLM API key。
```

permissions 不只是展示文本，也是 runner 的执行边界。每次 tool call 都必须经过 permission check。

```text
allowed
  执行 tool call。

missing_permission
  进入 waiting，要求用户确认或修改本地配置。

denied
  拒绝 tool call，并把原因写入 events 和 artifacts。
```

`config.schema.yaml` 驱动首次运行配置。密钥和机器路径不打进 release 包，第一次运行时引导用户配置，并保存到使用者本机。

参数分两层：

```text
agent args   xiaogui 的业务参数，由 interface.yaml 定义
kernel args  feng runner 保留参数，用 --feng-* 前缀
```

例如：

```text
xiaogui --input ./Downloads --mode clean
xiaogui --feng-debug
```

## 14. LLM 和缓存

OpenAI 和 Anthropic 只是 adapter 差异，不进入 self 核心概念。

kernel 内部统一：

```text
Message
Tool
ToolCall
```

缓存必须感知 self 版本：

```text
model
messages
tools
self commit/tag
mode: execute | grow
```

## 15. 易用性约束

为了保持架构简单，所有易用性问题只允许通过三类东西解决：

```text
更好的 CLI 入口
少量 self repo 约定文件
更清楚的 release manifest
```

不要为了模板、测试、权限、配置、分享分别做复杂系统。它们都回到同一个模型：

```text
template    = 起始 self repo
teach       = 修改 skill，并沉淀 eval
try         = validate + 少量 eval
permissions = release manifest 的信任边界
config      = 首次运行引导
release     = 命名可执行产物
```

## 16. MVP

第一版只做：

1. Runtime kernel。
2. 文件化 self repo。
3. `.feng/state.yaml`、`.feng/lock`、`.feng/events.jsonl`、`.feng/artifacts/`。
4. 一个基础 loop。
5. 四个 bootstrap tools：read_file、write_file、list_files、run_command。
6. 一个 LLM adapter，另一个保留接口。
7. Git 管理 candidate、validated commit、tag。
8. skill-first context assembly。
9. 简单 validate：load、schema、tool、eval。
10. builtin/local template。
11. CLI：new、teach、try、release、status、watch、artifacts。
12. named portable release。
13. 首次运行配置引导。
14. 权限摘要确认和 tool call permission check。
15. 只读观察型 GUI。

暂时不做多 agent、复杂插件市场、复杂长期记忆、复杂 hook 执行器。

## 17. 核心判断

feng 要爆火，不能让使用者理解 feng。

```text
创造者使用 feng。
使用者使用 xiaogui。
```

架构上保持小内核，产品上隐藏内部结构。所有关键能力落到 self repo 的文件约定里：skill 是成长单位，hook 是介入时机，eval 是成长标准，permissions 是信任边界，interface 是命令参数，release 是命名可执行产物。

这样 feng 才能把一个想法孵化成一个可以传播的命令。

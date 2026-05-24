# feng 架构概念

## 1. 产品目标

feng 的目标是把一个想法孵化成一个可以直接运行、可以传播的命令。

```text
idea -> grow -> check -> hatch -> named command
```

创造者使用 feng：

```text
mkdir xiaogui
cd xiaogui
feng grow "帮我整理下载目录"
feng check
feng hatch --name xiaogui --portable
```

使用者只使用孵化出来的命令：

```text
xiaogui --input ./Downloads
```

feng 是孵化器，`xiaogui` 是产品。

## 2. 顶层模型

feng 只有四个核心对象：

```text
Runtime Kernel
  稳定小内核，负责 loop、LLM adapter、工具调度、验证、版本、hatch/release package、状态记录。

Self Repo
  agent 的自我，由文件组成，受 Git 管理，可以成长。

.feng State
  当前 workspace 的运行状态、事件、产物和缓存。

Git
  self 的成长历史、candidate、validated commit 和 tag。
```

一个 feng 目录就是一个 workspace：

```text
workspace = self repo + .feng state + Git history
```

同一个 workspace 同一时间只允许一个 feng kernel 修改 self。

## 3. 两个界面

feng 要易用，必须隐藏内部结构。

创造者界面：

```text
grow     推动 self 成长；如果当前目录还不是 workspace，先创建最小 self
check    检查 candidate 是否可以成为下一版 self
hatch    把 validated self 破壳成命名命令
```

使用者界面：

```text
xiaogui
xiaogui --help
xiaogui --input ./Downloads
```

`skills`、`evals`、`permissions`、Git 版本、candidate、promote 都是内部结构。创造者可以打开精修，但默认流程不要求先理解它们。

这对应两个运行形态：

```text
grow mode
  在 feng workspace 内运行，目标是修改 self repo 并形成 validated commit。

execute mode
  运行 hatch 出来的命名命令，目标是按 interface.yaml 完成用户任务。默认不修改 packaged frozen self。
```

两种形态共享 Runtime Kernel、LLM adapter、tool dispatcher、permissions 和 message compiler；差异只在可写边界、interface 和 Git 语义。

## 4. Self Repo

self repo 是少量约定文件，不是复杂工程。

```text
identity.md         agent 是谁，基础边界是什么
goal.md             当前成长目标
skills/             agent 学会的能力；bootstrap 时可以为空
hooks.yaml          哪些事件点启用哪些 skill
tools/              工具声明和实现
world/              对外部世界的稳定描述
evals/              怎么判断 agent 有效
interface.yaml      hatch 后暴露哪些参数
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

运行产物可以被读取，但默认不提交。只有 agent 明确沉淀下来的稳定经验，才写回 self repo。

## 5. World、Config、Args

`world/` 是 agent 面对外部环境的说明书。

```text
world       可随 hatch package 传播的稳定环境模型
config      使用者本地事实，例如密钥、路径、设备地址、偏好
args        单次运行输入
permissions 允许接触外部世界的边界
artifacts   运行过程中留下的证据
```

示例：

```text
API schema -> world
API token -> config
--base-url -> args 或 config

传感器含义 -> world
设备地址和校准参数 -> config
--speed low -> args
```

context assembly 只选择和当前事件相关的 world 片段，不把整个 world 塞进每轮 context。

## 6. Workspace State 和可观测性

feng 不使用用户可见的 session/resume 模型。运行状态属于 workspace，放在 `.feng/` 里。

```text
.feng/state.yaml      当前状态快照
.feng/lock            单写锁和心跳
.feng/events.jsonl    append-only 事件流
.feng/artifacts/      diff、eval 结果、失败报告、hatch 预览
```

中断后不需要 `resume`。下一次 `feng grow`、`feng check` 或 `feng status` 都先读取 self repo、Git 和 `.feng/state.yaml`，自然从当前 workspace 状态继续。

可观测性也只靠文件和简单命令：

```text
feng status     看当前状态和是否卡住
feng watch      看 events 时间线
feng artifacts  看产物、diff、eval、失败报告
```

GUI 只是这些文件的可视化：running、progress、artifact 三种视图。

## 7. Loop 和上下文工程

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

核心关系：

```text
hook    什么时候介入
skill   用什么能力介入
tool    对外部世界做什么动作
message 本轮临时组装出的 LLM 输入
```

feng 不以散乱 prompt 片段作为主要成长单位，而以 skill 作为主要成长单位。

```text
hook 调度 skill
skill 提供能力
kernel 组装上下文
```

skill 的最小结构是能力契约，不是插件系统：

```text
when        适用事件或触发条件
goal        这个能力要完成什么
context     需要哪些 world、artifact 或文件引用
tools       允许暴露哪些 tool schema
output      期望输出形态
checks      哪些 eval 或规则能验证它
```

hook 可以在未来支持脚本，但脚本仍然必须作为 tool 受 permissions 和 check 管理。

bootstrap self 不需要预置任何领域 skill。若当前 hook 没有匹配 skill，kernel 进入通用 seed loop：只用 kernel contract、latest event、self index、目录索引、初始工具和 artifact refs 让 LLM 生成第一批 candidate self 文件。这条 fallback 对所有 workspace 相同，不是某个项目的特殊逻辑。

上下文工程只有一个优先级：token efficiency。

每轮上下文先分成稳定前缀和动态后缀：

```text
cache prefix
  kernel contract、active tool schema、self summary、稳定 skill/world index。

hot suffix
  最新用户输入、hook 事件、最近 tool result、candidate 状态、失败原因。

artifact refs
  大文件、长日志、长 diff、网页正文、测试输出，只放类型、来源、路径、hash、摘要、为什么相关、必要片段。

summary
  历史对话和旧事件压缩后的短摘要。
```

超长时，原始证据进入 artifacts，prompt 只保留路径、hash、摘要和必要片段。稳定经验才沉淀回 self repo。

### Message List

kernel 最终发送给 LLM 的是稳定顺序的 message list。message list 是运行时产物，不是用户维护的 prompt 文件。

message list 的设计目标不是“把信息放全”，而是：

```text
缓存前缀稳定
动态内容靠后
大内容文件化
工具结果可追溯但不刷屏
```

每轮按这个顺序组装：

```text
provider tools
  当前 active tool pack 的 schema。初始工具可用，但不要求每轮全部暴露；领域工具由当前 hook/skill 或 seed loop 选择。工具多时只暴露本轮需要的工具组，工具说明全文留在 tools/ 文件中。

system: kernel contract
  极小、稳定的运行规则，例如当前模式、工具调用协议、权限边界、稳定输出约束。

system: self contract
  identity、goal、self commit、active skill/world/tool index、权限摘要。

optional cached context pack
  反复使用、足够稳定、值得缓存的 skill/world/example 片段。

user: state manifest
  当前任务状态、文件路径、artifact 的类型、来源、路径、hash、短摘要、为什么相关、必要片段。

conversation suffix
  最近 user / assistant / tool call / tool response，保持 provider 协议顺序。

user: latest event
  最新用户输入、hook 事件或需要 LLM 处理的 tool result 摘要。
```

稳定输出约束放在 kernel contract；任务特定输出要求放在 latest event，避免每轮改写稳定前缀。

assistant message 只用于稳定 few-shot 示例，或最近必要行动历史，尤其是 tool call 配对。它不长期保存推理过程。

tool response 短结果可以直接进入 tool message；长结果写入 `.feng/artifacts/`，tool message 只返回类型、来源、路径、hash、摘要、为什么相关和关键片段。

每个 message 都应带来源、层级、优先级、预算和 hash，方便缓存、压缩、追踪来源、统计 token 花费和跨 OpenAI / Anthropic adapter 转换。

## 8. Grow、Check、Tool Growth

`grow` 是用户侧的第一个语义入口。它可能是长任务，但不是用户需要 resume 的 session。

如果当前目录还不是 feng workspace，`grow` 先执行通用 bootstrap：

```text
创建最小 self repo
创建 .feng/
建立 Git 成长语义
写入初始 state
```

bootstrap 只补齐缺失的 feng 自我文件和运行状态，不覆盖用户已有文件。已有源码、文档、配置和目录结构会先被当作 world 或可感知目标，而不是被复制成另一个项目。

然后再进入成长 loop。这个 bootstrap 是 `grow` 的前置阶段，不是单独的产品命令。

grow 可能修改：

```text
skills/
hooks.yaml
tools/
evals/
interface.yaml
permissions.yaml
world/
```

初始四个工具是 bootstrap tools：

```text
read_file
write_file
list_files
run_command
```

领域工具属于 self repo。grow 可以新增或修改工具声明和实现，例如 HTTP 请求工具、传感器读取工具、桌面操作工具。

工具变多后，不代表每轮全部暴露给 LLM。每轮只暴露当前 hook/skill 或 seed loop 需要的工具 schema；工具文档和长说明仍留在 `tools/` 文件里，必要时再读取。

`check` 是验证入口，只回答三个问题：

```text
能不能启动
会不会按示例做事
还缺什么权限或配置
```

check 至少验证：

```text
self 能加载
schema 能解析
tool 能加载并受权限约束
baseline eval 能通过
candidate 声明的项目 eval 能通过
```

baseline eval 验证 self 健康、schema、permissions、provider/config、secret 边界。项目 eval 可以是示例、fixture、mock 或受限命令，由 grow 生成并沉淀。eval 产物写入 `.feng/artifacts/`，不会直接污染 self repo。

## 9. 成长版本

Git 是 self repo 的成长介质，不只是回滚工具。

```text
validated commit = 可以启动的一版 self
working tree      = 正在孵化的 candidate self
tag               = 被命名和固定的一版 self
```

candidate 验证失败时，不自动丢弃。当前 agent 继续从上一版 validated commit 运行，同时修复 working tree 里的 candidate。失败报告、diff 和验证结果写入 `.feng/artifacts/`，下一轮通过 artifact refs 进入上下文。

candidate 验证通过后，promote 成新的 validated commit。达到目标后，可以 tag 并 hatch。

agent 感知 Git 的方式是文件和工具：kernel 把 status、diff、check report、validated commit 写入 state/artifacts；agent 也可以在 permissions 允许范围内通过 `run_command` 调用安全 git 命令。强制回滚不是默认策略，默认策略是用上一版 validated self 启动，再继续修复 candidate。

## 10. Hatch / Release

`hatch` 把 validated self 变成命名命令。release 是 hatch 产出的技术包。

```text
hatch output = frozen self + runner + manifest + checksums
```

release package 至少包含：

```text
命名入口：xiaogui / xiaogui.ps1
runner
self/
manifest
checksums
install 脚本
```

manifest 说明：

```text
name、version/tag、self commit、runner version、target platform
required tools、required permissions、config schema、interface、checksums
```

使用者机器上的密钥、路径、设备地址、API endpoint 不应该被打进 release self。第一次运行时由 `config.schema.yaml` 引导配置，保存到使用者本机。

permissions 不只是展示文本，也是 runner 的执行边界。每次 tool call 都必须经过 permission check。

## 11. 模板

模板只是起始 self 形状，不是插件市场，也不是隐藏 runtime。

第一版只支持：

```text
builtin template
local template
```

命令：

```text
feng templates
feng grow "帮我整理下载目录"
feng grow --template file-agent "帮我整理下载目录"
feng grow --template ./my-template "帮我整理下载目录"
```

默认模板应该足够好，让第一次 `feng grow "..."` 不需要额外参数。这里的“足够好”指结构完整，而不是预置能力。

默认模板不预置领域 skill。local template 可以带少量 skills、tools、evals 和 world 示例，但它们是创造者显式选择的起点，仍然只是 self repo 文件，必须经过正常 check 才能成为 validated self。

## 12. LLM 和缓存

OpenAI 和 Anthropic 只是 adapter 差异，不进入 self 核心概念。

kernel 内部统一：

```text
Message
Tool
ToolCall
```

缓存策略遵循一个原则：

```text
稳定前缀尽量不变，动态后缀尽量短。
```

缓存 key 必须感知：

```text
model
stable prefix hash
active tool pack hash
self commit/tag
context pack hash
mode: execute | grow
```

运行时至少记录：

```text
prompt tokens
cached tokens
tool schema tokens
artifact-ref tokens
dynamic suffix tokens
```

这些指标写入 `.feng/events.jsonl` 或 `.feng/artifacts/`，用于观察 token efficiency。

## 13. 易用性约束

为了保持架构简单，所有易用性问题只允许通过三类东西解决：

```text
更好的 CLI 入口
少量 self repo 约定文件
更清楚的 release manifest
```

不要为了模板、测试、权限、配置、分享分别做复杂系统。

## 14. 自举验证

`feng hatch --name feng --portable` 是架构的自举验证 case。

它的目标不是创造另一个 agent，而是让当前 feng workspace 用同一套机制孵化下一版 feng 自己。被 hatch 出来的命令仍然叫 `feng`，面对的 world 是 feng 自己的仓库、核心诉求、架构文档、评审轮次、源码、测试和 Git 历史。

自举不应该拥有特殊 runtime。它仍然通过：

```text
self repo
.feng state
Git
skills
tools
evals
permissions
```

来审查、修改、验证和提交 feng 自己。

如果自举需要特殊通道，说明 feng 的通用架构还不够自洽。

## 15. MVP

第一版只做：

1. Runtime kernel。
2. 文件化 self repo。
3. `.feng/state.yaml`、`.feng/lock`、`.feng/events.jsonl`、`.feng/artifacts/`。
4. 一个基础 loop。
5. 四个 bootstrap tools。
6. 一个 LLM adapter，另一个保留接口。
7. Git 管理 candidate、validated commit、tag。
8. skill-ready context assembly：有 skill 时按 skill 选择上下文；没有 skill 时走通用 seed loop。
9. 简单 validate：load、schema、tool、eval。
10. builtin/local template。
11. CLI：grow、check、hatch、status、watch、artifacts。
12. named portable release。
13. 首次运行配置引导。
14. 权限摘要确认和 tool call permission check。
15. 只读观察型 GUI。

暂时不做多 agent、复杂插件市场、复杂长期记忆、复杂 hook 执行器。

## 16. 核心判断

feng 要爆火，不能让使用者理解 feng。

```text
创造者使用 feng。
使用者使用 xiaogui。
```

架构上保持小内核，产品上隐藏内部结构。所有关键能力落到 self repo 的文件约定里：skill 是成长单位，hook 是介入时机，eval 是成长标准，permissions 是信任边界，interface 是命令参数，hatch 是命名可执行产物。

这样 feng 才能把一个想法孵化成一个可以传播的命令。

# feng 核心诉求

## 1. 产品本质

feng 不是一个普通 agent 框架，也不是一个预置能力很强的助手。

feng 的核心诉求是：

```text
把一个想法孵化成一个可以直接运行、可以传播的命令。
```

创造者使用 feng。主路径应该只暴露一个开始动作：

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

作为面向创造者的主路径，符合 feng 的语言应该围绕成长和孵化：

```text
grow   推动 self 成长，吸收规则、示例、反馈
check  检查 candidate 是否可以成为下一版 self
hatch  把 validated self 破壳成命名命令
```

`grow` 是第一个语义命令。如果当前目录还不是 feng workspace，`grow` 先用默认模板创建最小 self repo、`.feng/` 和 Git 成长语义，然后进入成长 loop。不要把“创建蛋”和“初始化 self”拆成两个用户必须理解的命令。

## 2. 白板式起点

feng 安装后不应该是一个已经长满能力的 agent。

它应该更像一个空白胚胎：

```text
用户给目标
用户给工具
用户给世界感知方式
feng 开始孵化
```

agent 的能力不是一次性写死的，而是在 workspace 里逐步长出来。

## 3. 文件即自我

feng 的 self 必须落在文件系统中，而不是藏在 runtime 代码里。

self repo 表达：

```text
它是谁
它会什么
它面对什么世界
它有哪些工具
它在哪些 hook 点启用哪些能力
它如何被验证
它如何被 hatch 成命令
```

agent 必须能通过初始工具读取、理解、修改这些文件。

## 4. Workspace 是生命体

一个 feng 目录就是一个正在孵化的 workspace。

```text
workspace = self repo + .feng runtime state + Git history
```

同一个 workspace 同一时间只允许一个 feng kernel 修改 self。

不要把 feng 设计成传统的“启动 session、resume session”的 agent。中断后，下次命令应该自然读取当前 workspace 状态继续。

## 5. Git 是成长介质

Git 不是单纯的回滚工具。

Git 在 feng 中表示 self 的代际成长：

```text
validated commit = 可以启动的一版 self
working tree      = 正在孵化的 candidate self
tag               = 被命名、固定、可 hatch 的 self
```

candidate 失败时不自动丢弃。失败现场是成长材料，agent 应该能查看 diff、失败报告和验证结果，继续修复 candidate。

Git 由 kernel 维护为成长账本，并通过 `.feng/state.yaml`、artifact、diff、check report 和受权限约束的 git 命令让 agent 感知。修复 candidate 的默认方式是继续编辑 working tree，而不是强制回滚。

## 6. Grow 是成长入口

`grow` 是产品层最重要的命令。

它不是一次普通问答，而是推动当前 workspace 孵化的一次长任务。用户给 feng 输入目标、规则、示例和反馈，让 self repo 发生稳定成长。

但对用户来说，不应该暴露复杂长任务概念：

```text
用户给它规则
用户给它示例
feng 修改 skills / evals / interface / permissions
feng 试运行
feng 留下状态和产物
```

用户不需要理解 session，也不需要手动 resume。

## 7. Skill 是主要成长单位

feng 不应该让用户维护大量散乱 prompt block。

更合理的 context engineering 是：

```text
hook   = 什么时候介入
skill  = 用什么能力介入
tool   = 对外部世界做什么动作
message = 每轮临时组装出的 LLM 输入
```

agent 的成长主要体现为：

```text
新增 skill
修改 skill
组合 skill
验证 skill
把 skill 组成的 self hatch 成命名命令
```

hook 仍然存在，但 hook 是事件点，不是能力本身。

## 8. World 是世界说明书

`world/` 不是运行日志，也不是长期记忆垃圾桶。

它的定位是：

```text
agent 对外部环境的可读说明书。
```

它描述：

```text
外部世界有哪些对象
这些对象如何被感知
这些对象如何被影响
有哪些稳定约束
有哪些术语和结构
```

稳定环境知识进入 `world/`。运行过程进入 `.feng/runs/` 和 `.feng/artifacts/`。稳定经验需要被明确沉淀后，才写回 self repo。

## 9. Context 必须 token efficient

feng 是长任务系统，context 不能无限增长，也不能每轮把大量内容重新塞给 LLM。

context 控制必须是 kernel 基础能力，核心目标只有一个：

```text
token efficiency
```

这意味着：

```text
稳定内容尽量形成可缓存前缀
动态内容尽量放在后缀
大内容默认放文件，只在 prompt 里放类型、来源、路径、hash、短摘要和为什么相关
非必要不把文件全文、长日志、完整 diff、完整 tool output 放进 messages
```

每轮上下文分层：

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

超长时：

```text
大内容先落 artifact
prompt 留类型、来源、路径、hash、摘要、为什么相关
历史合并成 summary
低相关 skill 不进入本轮
world 只取相关片段
仍然超长就停下来请求缩小任务或增加预算
```

原则是：

```text
原始证据进 artifacts
短摘要进 context
稳定经验才进 self repo
稳定前缀不要被每轮动态内容污染
```

## 10. 可观测性必须文件化

feng 的运行状态、进度、产物都必须可观察。

但不要做复杂工作流系统。

用文件表达：

```text
.feng/state.yaml      当前状态快照
.feng/lock            单写锁和心跳
.feng/events.jsonl    append-only 事件流
.feng/artifacts/      diff、eval、失败报告、hatch 预览
```

对应命令：

```text
feng status
feng watch
feng artifacts
```

GUI 只是这些文件的可视化。

## 11. 使用者不应该理解 feng

要想易用和传播，使用者不能被要求理解：

```text
self repo
Git
candidate
promote
skill
hook
eval
permissions.yaml
```

使用者只应该看到一个正常命令：

```text
xiaogui
xiaogui --help
xiaogui --input ./Downloads
```

内部结构属于创造者和 feng，不属于最终使用者。

## 12. Hatch 是命名命令

hatch 的目标不是导出一个给开发者看的包，而是生成一个普通用户可以运行的命令。release package 是 hatch 产生的技术产物。

```text
hatch = validated self + runner + manifest + checksums
```

输出应该类似：

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

使用者路径应该尽量短：

```text
./install
xiaogui
```

或者：

```text
./xiaogui
```

## 13. 易用性不能靠堆系统

feng 的架构必须简单。

模板、测试、权限、配置、分享都不能各自膨胀成复杂系统。它们应该统一回到少量文件约定：

```text
template     = 最小 self 形状，不是隐藏能力包
grow         = 修改 skill，并沉淀 eval
check        = validate + 少量 eval
permissions = release manifest 的信任边界
config       = 首次运行引导
hatch        = 命名可执行产物
```

架构保持：

```text
Runtime Kernel + Self Repo + .feng State + Git
```

## 14. 最终判断

feng 的核心不是“让 agent 做一次任务”，而是：

```text
让创造者把一个目标教成一个可以传播的命令。
```

它应该像一个蛋：

```text
安装时是白板
workspace 是身体
self repo 是自我
Git 是成长历史
.feng 是生命体征
grow 是成长动作
hatch 是破壳成品
```

这就是 feng 的产品核心。

## 15. LLM Message List 必须围绕缓存编排

feng 不能只说“组装上下文”，还需要定义每轮 LLM message list 的稳定编排方式。

message list 应该是 kernel 根据 self repo 和运行状态临时生成的结果，不是用户长期维护的一堆 prompt 文件。

编排原则是：

```text
能缓存的放前面
每轮变化的放后面
大内容不进 message，先变成文件引用
assistant / tool response 只保留协议必须和决策必须的短历史
```

逻辑顺序是：

```text
provider tools
  当前 active tool pack 的 schema。工具多时只暴露本轮需要的工具组，不把所有工具都塞进去。

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

assistant message 只能承担两类用途：

```text
稳定 few-shot 示例
最近必要行动历史，尤其是 tool call 配对
```

它不应该用来长期保存推理过程。

tool response 的规则是：

```text
短结果可以直接进 tool message
长结果写入 artifact，tool message 只返回类型、来源、路径、hash、摘要、为什么相关、关键片段
```

这些层按稳定顺序进入 messages，并带有来源、优先级、预算和 hash。这样才能同时满足：

```text
可缓存
可压缩
可追踪来源
可跨 OpenAI / Anthropic adapter 转换
可观测 token 花费和缓存命中
```

## 16. Feng 自举是关键 case

feng 必须能用同一套机制孵化下一版 feng 自己。

这不是创造一个新的命令或新的 agent，而是让当前 feng workspace 可以走完同样的路径：

```text
feng grow "让 feng 更好地校准自己的架构、代码和验证方式"
feng check
feng hatch --name feng --portable
```

这个 case 很重要，因为它会反过来检验 feng 的原始诉求：

```text
文件即自我
Git 是成长介质
workspace 是生命体
长任务可观测
不过拟合
架构能被自己推演和修正
```

被 hatch 出来的命令仍然叫 `feng`。它面对的 world 是 feng 自己的仓库、文档、测试和 Git 历史。

如果 feng 自举需要特殊待遇，说明 feng 的通用架构还不够自洽。

## 17. 原始诉求验收面

后续架构推演不能只看关键路径，必须按这些面检查是否满足原始诉求：

```text
R01 LLM 对接
  kernel 能通过 adapter 调用 LLM，不把 OpenAI / Anthropic 差异泄漏到 self repo。

R02 Function Call
  LLM 能通过统一 Tool / ToolCall 协议调用工具，tool response 能进入下一轮。

R03 自造工具
  grow 能修改 tools/，新增领域工具声明和实现，并通过 check 验证。

R04 Token Efficiency
  message list 围绕缓存命中设计：稳定前缀、动态后缀、大内容文件化、active tool pack。

R05 协议兼容
  同一套内部 Message / Tool / ToolCall 可以编译到 OpenAI 和 Anthropic 协议。

R06 Message 编排
  system、user、assistant、tool response 的角色边界清楚，不靠散乱 prompt block。

R07 Prompt / Skill 模块化
  成长单位是 skill，hook 只是介入时机，message 是运行时编译结果。

R08 GUI 和 CLI
  CLI 是主路径，GUI 只读展示 status、progress、artifact。

R09 初始工具
  bootstrap tools 只有 read_file、write_file、list_files、run_command。

R10 白板孵化
  feng 安装后是空白起点，用户给目标、工具和 world 后开始成长。

R11 文件即自我
  self repo 用文件表达 identity、goal、skills、hooks、tools、world、evals、interface、permissions。

R12 Git 成长
  Git 表达 candidate、validated commit、tag，不把失败 candidate 直接吞掉。

R13 Reload / Repair
  candidate 失败后从 validated commit 启动，保留失败现场，让 agent 修复；无法修复才由用户决定是否丢弃。

R14 World
  world/ 是外部环境说明书，不是日志和长期记忆垃圾桶。

R15 长任务
  grow 是长任务，但用户不需要理解 session/resume；workspace state 负责延续。

R16 可观测性
  running、progress、artifact 都能通过 .feng 文件和简单命令观察。

R17 打包传播
  hatch 输出命名命令，使用者运行 xiaogui，而不是理解 feng。

R18 配置和权限
  本机密钥、路径、设备地址进入 config；permissions 是 tool call 边界。

R19 自举
  feng 能用同一套机制 hatch 下一版 feng 自己，不引入特殊 runtime。

R20 简单和不过拟合
  所有设计回到 Runtime Kernel + Self Repo + .feng State + Git，不为单个 case 增加专用系统。
```

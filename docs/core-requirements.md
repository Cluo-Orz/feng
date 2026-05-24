# feng 核心诉求

## 1. 产品本质

feng 不是一个普通 agent 框架，也不是一个预置能力很强的助手。

feng 的核心诉求是：

```text
把一个想法孵化成一个可以直接运行、可以传播的命令。
```

创造者使用 feng。这里的命令名称不是最终定稿，但产品语义应该接近：

```text
feng new xiaogui
feng grow "帮我整理下载目录"
feng check
feng hatch --name xiaogui --portable
```

使用者只使用孵化出来的命令：

```text
xiaogui --input ./Downloads
```

feng 是孵化器，`xiaogui` 是产品。

`teach / try / release` 可以作为内部语义或兼容别名，但作为面向创造者的主路径，它们略显机械。更符合 feng 的语言应该围绕成长和孵化：

```text
grow   推动 self 成长，吸收规则、示例、反馈
check  检查 candidate 是否可以成为下一版 self
hatch  把 validated self 破壳成命名命令
```

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

## 6. Grow 是成长入口

`grow` 是产品层最重要的命令。

它不是一次普通问答，而是推动当前 workspace 孵化的一次长任务。早期文档里用 `teach` 描述这个动作，本质上指的是同一件事：用户给 feng 输入规则、示例、反馈，让 self repo 发生稳定成长。

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

## 9. Context 必须可控

feng 是长任务系统，context 不能无限增长。

context 控制必须是 kernel 基础能力。

每轮上下文分层：

```text
core      identity、目标、模式、当前事件
selected  相关 skill、tool、world 片段
working   当前任务状态、最近工具结果、candidate diff、失败原因
history   旧事件、长日志、历史对话
```

超长时：

```text
artifact 留路径和摘要
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
template     = 起始 self repo
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

## 15. LLM Message List 必须有设计

feng 不能只说“组装上下文”，还需要定义每轮 LLM message list 的稳定编排方式。

message list 应该是 kernel 根据 self repo 和运行状态临时生成的结果，不是用户长期维护的一堆 prompt 文件。

每轮 message list 至少有这些层：

```text
kernel
  极小的运行规则，例如当前模式、工具调用协议、输出约束。

self
  identity、goal、当前 boot self、candidate 状态。

event
  本轮用户输入、hook 事件或 tool 结果。

selected context
  相关 skills、tools、world 片段、permissions 摘要。

working state
  当前任务状态、最近结果、失败原因、必要的 summary。

history summary
  旧事件压缩后的摘要，只在需要时进入。
```

这些层按稳定顺序进入 messages，并带有来源、优先级和预算。这样才能同时满足：

```text
可缓存
可压缩
可追踪来源
可跨 OpenAI / Anthropic adapter 转换
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

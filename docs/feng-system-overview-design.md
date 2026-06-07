# feng 系统概要设计

本文是基于产品概念、agent 调研笔记、agent 设计学习总结和 5 轮设计前草稿形成的系统概要设计。它不定义具体目录结构、文件 schema、CLI 完整命令、provider adapter、MCP adapter 或 GUI。它只定义 feng 的核心对象、系统闭环、关键子系统职责和必须保持稳定的边界。

## 设计目标

feng 是一个 file-native 的智能行为成长系统。

它要解决的问题不是“生成一个 agent 模板”，而是让一个模糊的智能行为在真实材料、目标世界接口、运行证据、反馈回流和版本边界中逐步成型，并在成熟后 hatch 成可复制能力包。

系统设计必须满足几个核心约束：

```text
feng 没有用户需要理解的 session 概念。
一个 grow 单元就是一个连续成长空间。
下一轮 LLM loop 使用的 message list 必须是文件化产物。
grow 的对象不是固定 LLM loop，而是目标行为、运行契约、感知方式、动作边界、观测和反馈路由。
hatch 产物不一定是 LLM agent，但必须带运行契约和验证证据。
反馈上报只能成为候选，不能无脑向上游吸收。
默认反馈路由 skill 是通用能力，但基础协议稳定，场景策略可 grow。
```

补充约束：feng 至少需要两个不同层次的 kernel。Grow Kernel 服务 feng 自身的长程 grow、验证和 hatch；Agent Runtime Kernel 只在 hatch 产物需要 LLM agent 形态时作为运行底座。两者共享 message list 编译、上下文分层、trace、skill 和反馈原则，但不能混成一个“通用 agent 模板”。

## 核心对象

### Grow 单元

Grow 单元是 feng 的中心对象。它不是聊天会话，而是一个智能行为的成长边界。

一个 grow 单元在概要上包含：

```text
目标：用户想塑造的智能行为。
材料：文档、代码、样例、规则、日志、世界说明、反馈。
目标世界接口：它从哪里接收状态，向哪里输出行为。
运行契约：输入、输出、动作边界、失败处理、调试方式。
候选能力：当前正在尝试的行为实现或策略。
证据：工具结果、运行记录、验证报告、失败原因、反馈归因。
编译输入：下一轮 message list 和其来源说明。
hatch readiness：是否足够稳定，可以提取为能力包。
反馈队列：来自本地运行、hatch 产物或下游项目的反馈候选。
```

Grow 单元内部可以有轮次、事件、上下文版本、候选版本和运行片段，但这些是文件化成长状态，不是用户要管理的 session。

### 事实层

事实层保存完整成长依据。它是真相来源，而不是模型直接看到的全部内容。

事实层包括：

```text
用户输入和关键澄清。
目标和假设。
材料引用和摘要。
目标世界接口说明。
工具调用和运行结果。
候选能力及其变更记录。
验证证据和失败记录。
反馈单元和归因记录。
版本、来源和审计信息。
```

事实层可以被压缩、归档、索引或脱敏，但关键成长状态不能只存在于进程内存、数据库缓存或模型上下文中。

### 编译层

编译层负责从事实层生成当前轮模型可见表示。

它的核心产物是下一轮 message list。message list 应该能解释：

```text
本轮模型要解决什么。
使用了哪些目标、材料、反馈和证据。
哪些 skill、工具和世界接口当前可见。
哪些内容被压缩、排除或等待更多证据。
本轮有哪些安全和动作边界。
```

message list 是编译结果，不是真相本身。它必须可定位、可复查、可回放，但不能替代事实层。

### 执行层

执行层负责运行一次 grow attempt。

一次 attempt 可能包括：

```text
调用 LLM。
调用工具。
生成或修改候选能力。
运行候选能力。
执行测试或模拟。
收集调试信息。
处理错误恢复。
写入结果、证据和退出原因。
```

执行层不能把成功或失败只打印到终端。关键结果必须回写为文件化证据。

### Hatch 能力包

Hatch 能力包是从 grow 单元中提取出来的稳定交付物。

它可以是命令、服务、脚本模块、游戏组件、行为树、状态机、LLM loop、创作工作流或混合运行单元。形态由目标世界决定。

它必须包含：

```text
运行入口。
输入契约。
输出或事件契约。
依赖和资源。
权限和动作边界。
可观察日志。
调试模式。
反馈路由。
验证报告。
版本和来源。
```

它不应该包含未采纳候选、失败草稿、本机密钥、原始长聊天、无关材料、临时上下文或不可解释缓存。

### 反馈单元

反馈单元是运行问题进入 grow 的最小候选单位。

它至少表达：

```text
来源。
版本。
运行场景。
观察到的问题。
证据。
初步归因。
建议流向。
隐私边界。
```

反馈单元默认只是候选。它可以被本地吸收、上游提议、拒绝、忽略、等待更多证据或请求人工确认。

## 主闭环

feng 的主闭环是：

```text
1. 创作者提出智能行为目标。
2. feng 创建或继续一个 grow 单元。
3. 事实层接收目标、材料、反馈和运行结果。
4. 编译层生成下一轮 message list。
5. 执行层运行一次 grow attempt。
6. 候选能力被生成、修改、运行或验证。
7. 证据进入事实层。
8. readiness 判断是否继续 grow 或进入 hatch。
9. hatch 提取稳定能力包。
10. 能力包运行并产生反馈单元。
11. 反馈路由判断本地吸收、上游提议、忽略或待确认。
12. 被采纳的反馈进入下一轮 grow。
```

这个闭环可以内部复杂，但产品第一心智必须简单：用户提出一个智能行为，持续给材料和反馈，直到 feng 说“成了”。

## 关键子系统

### Long-running Grow Kernel

Long-running Grow Kernel 是 feng 自身能承担长程任务的基础。它不是把对话历史无限延长，而是让 grow 单元具备可恢复、可审计、可阻塞、可验证的成长状态。

它至少负责：

```text
维护目标契约和 DoD。
维护 grow 议程和当前阶段。
接收用户输入、材料、后台结果和 hatch 调试上报。
对输入和反馈做准入判断。
为每次 grow attempt 生成文件化 message list。
记录 attempt 的输入、动作、结果、证据和退出原因。
在缺材料、缺权限、连续失败或验证不足时进入等待或阻塞。
在证据满足时推动 ready_to_hatch。
```

长程任务的关键不是“永远继续”，而是每次被唤醒时都能从文件化事实恢复判断。进程崩溃、模型失败、工具中断或上下文压缩，都不应该让 feng 失去当前 grow 到底为什么继续、下一步要解决什么、哪些反馈已经被采纳。

### Prompt / Context Kernel

Prompt / Context Kernel 负责把 grow 单元的文件化事实编译成模型当前可见表示。它是 Message Compiler 的原则层。

它应保持几个边界：

```text
文件事实层是真相来源，message list 是当前轮投影。
system prompt 由真实 grow 状态分节组装，而不是靠关键词临时拼接。
大材料、长日志和工具结果应以摘要、引用或 artifact handle 进入活跃上下文。
反馈默认是候选，只有被采纳后才进入下一轮关键上下文。
skill 和 memory 应按需载入，载入原因、来源和版本要可追踪。
压缩只能改变活跃表示，不能改写完整事实。
```

下一轮 LLM loop 使用的 message list 必须是一等产物。它要能说明本轮看到了什么、没看到什么、为什么、用了哪些工具和 skill、当前动作边界是什么。

### Agent Runtime Kernel

Hatch 产物不一定是 LLM agent，但当它是 agent 时，必须有合格的 Agent Runtime Kernel。这个 kernel 是 hatch 产物运行时的质量底线，不是 feng 的产品定位。

它至少包括：

```text
目标世界输入接收。
运行时 message list 编译。
LLM 调用。
输出或 tool/action 请求解析。
动作合法性检查。
外部动作执行或结果输出。
trace、debug 和错误记录。
反馈候选生成和上报。
版本锁定、升级和回滚边界。
```

Agent Runtime Kernel 的 prompt 不能直接复用 Grow Kernel 的 prompt。它应该围绕目标世界行动来组织：当前观察、允许动作、禁止动作、目标约束、短期上下文、长期记忆、工具面、输出格式、调试要求和停止条件。

这能保证 boss agent、小说 agent、小车 agent 按各自目标世界运行，而不是都变成对话机器人。

### Runtime Contract

Runtime Contract 是所有 hatch 产物都必须遵守的边界。即使 hatch 结果不是 LLM agent，也必须声明它如何被调用、如何输出、如何失败、如何观察、如何调试和如何反馈。

Hatch Builder 应该让产物声明运行内核类型：

```text
standard-agent-kernel：使用 feng 默认 LLM agent runtime。
custom-agent-kernel：使用 grow 出来的定制 LLM loop。
non-llm-runtime：不使用 LLM loop，但遵守运行契约。
hybrid-runtime：LLM、规则、状态机、行为树或脚本混合。
```

kernel 选择本身应该是 grow 的结果，而不是用户从模板市场提前选择。这样 feng 仍然是智能行为成长系统，而不是 agent creator。

### Message Compiler

Message Compiler 是 feng 的核心子系统之一。它把 grow 单元的事实层编译成下一轮模型输入。

它不只是 prompt 模板。它需要考虑：

```text
目标和当前阶段。
最新材料和已采纳事实。
未解决问题。
验证失败和反馈归因。
可见 skill。
可见工具和目标世界接口。
权限和动作边界。
上下文预算。
压缩和排除依据。
```

每次编译都应该产出可检查文件，包括 message list 本身和来源说明。

### Grow Runtime

Grow Runtime 负责执行 grow attempt。它的职责是让模型和工具在受控环境中行动，并把结果写回事实层。

它包括：

```text
LLM 调用。
工具分发。
权限检查。
错误恢复。
候选生成或修改。
候选运行。
验证执行。
证据收集。
退出原因记录。
```

Grow Runtime 应该保持核心 loop 简洁。工具、skill、MCP、后台任务、cron、worktree、多 agent 都是可选 harness 能力，不应该改变 feng 的产品心智。

### Evidence 与 Readiness

Readiness 不能依赖模型自信。它必须基于可观察证据。

证据可以包括：

```text
验证结果。
测试或模拟结果。
运行日志。
目标世界反馈。
人工确认。
失败项关闭记录。
能力包契约检查。
反馈路由检查。
```

Readiness 的输出不是“绝对正确”，而是“在当前目标和边界下足够 hatch”。未满足 readiness 时，系统应该继续 grow、列出缺口或请求最少关键输入。

### Hatch Builder

Hatch Builder 从 grow 单元中提取稳定能力包。

它负责：

```text
选择被采纳的候选能力。
排除成长噪声和本地秘密。
生成运行契约。
打包资源和依赖说明。
附带验证报告。
附带调试和反馈路由能力。
声明版本和来源。
```

Hatch Builder 不应该把 grow 目录原样复制成产物。grow 目录是成长事实库，hatch 包是可运行交付物。

### Feedback Router

Feedback Router 负责把运行反馈变成候选，并决定候选流向。

它的基础协议应该稳定：

```text
来源。
版本。
证据。
归因。
隐私边界。
建议流向。
处理状态。
```

它的场景策略可以 grow。小说 agent、boss agent、小车 agent 需要不同信号和归因逻辑。

Feedback Router 是多层闭环的基础。feng -> xiaoshuo -> libai 这样的链路中，下游反馈不能直接污染上游。它只能提出候选，上游是否吸收必须经过本层判断、证据和验证。

### Skill System

Skill 是可复用能力单元，不是万能插件市场。

feng 默认应带一些基础 skill：

```text
目标澄清。
材料整理。
message list 编译辅助。
反馈路由。
验证设计。
hatch contract 检查。
安全/隐私检查。
```

默认反馈路由 skill 是重点。它应该默认存在，但允许在 grow 中演进。基础协议稳定，场景策略可变。任何 skill 的变更都应该有来源、版本、证据和回滚边界。

### Target World Adapter

目标世界适配层负责把“智能行为”接入具体运行世界。

它不要求所有目标都变成同一种 agent。它只要求每个目标世界能表达：

```text
输入状态。
输出动作或事件。
可访问材料。
可调用能力。
调试信息。
验证方式。
失败处理。
反馈入口。
```

游戏 boss、小说写作、音乐生成、小车控制的 adapter 可以完全不同。feng 的核心是让这些 adapter 参与 grow/hatch，而不是把它们压成统一对话接口。

## 多层自我演进

feng 可以自我演进，但不能把“自我演进”理解成无限放权。

更可信的模式是递归 dogfooding：

```text
feng grow 自己。
feng hatch 出新的默认能力或新版本 feng。
feng 在 xiaoshuo 项目中 grow 小说 agent。
xiaoshuo hatch 出 libai 写作 agent。
libai 在真实小说项目中运行并上报反馈。
xiaoshuo 吸收写作能力问题。
feng 只吸收系统性 grow/hatch/feedback/skill 问题。
```

每一层都必须有反馈归因和采纳边界。上报不等于吸收，候选不等于合并，grow 不等于发布。

### 小说场景目录角色

以 `feng -> xiaoshuo -> libai-chongshengle` 为例，多层闭环中的目录应按生命周期分工，而不是按同一种 agent 项目模板复制。

```text
F:\code\feng
  上游系统成长层。
  保存 feng 自身 grow 事实、默认 skill、kernel、hatch contract、系统性反馈候选和版本证据。
  只吸收 grow/hatch/feedback/kernel 等系统性问题。

F:\code\xiaoshuo
  领域 agent 成长层。
  保存小说 agent 的目标世界契约、材料、候选能力、验证、hatch 包和来自作品项目的领域反馈候选。
  吸收小说创作能力问题，不吸收某一本小说的全部作品事实。

F:\code\libai-chongshengle
  具体作品运行层。
  保存作品世界观、人物、提纲、章节、作者反馈、xiaoshuo 运行 trace 和作品级反馈候选。
  默认不把原始作品内容上报到 feng。
```

这个结构的目的不是提前规定目录 schema，而是规定数据归属和反馈流向。作品事实、领域 agent 能力、系统性成长机制必须分层，否则多层循环会退化成“所有下游数据都污染上游”。

### 小说场景数据流

终态数据流应分为向下游交付能力和向上游提交反馈候选：

```text
feng -> xiaoshuo
  Grow Kernel、Message Compiler 原则、默认 feedback router skill、Agent Runtime Kernel、hatch contract。

xiaoshuo -> libai-chongshengle
  小说 agent runtime、写作/修订 workflow、作品项目接入契约、上下文策略、debug/feedback 能力。

libai-chongshengle -> xiaoshuo
  章节失败、设定冲突、风格偏差、作者反馈、上下文遗漏证据、运行 trace 摘要。

xiaoshuo -> feng
  默认 runtime、message list 编译、feedback router、hatch、长程 grow 等系统性问题。
```

上游吸收必须基于归因。比如“某章不好看”通常是作品层或小说 agent 层问题；“trace 没有记录 message list”才是 feng 系统层问题；“反馈路由把作品原文无确认上报”是默认 feedback skill 或安全边界问题。

## 安全边界

feng 的安全边界必须诚实。

必须稳定声明：

```text
工作区文件读写边界。
命令执行边界。
网络和外部服务授权。
设备或游戏世界动作权限。
密钥和私有配置排除。
调试上报隐私边界。
hatch 包发布排除规则。
自动更新确认和回滚边界。
```

hook、prompt、skill、插件和 MCP 本身不是强安全边界。高风险动作需要真实权限控制、隔离、确认、日志和可撤销策略。

## 第一阶段建议切面

第一阶段不应该试图支持所有目标世界。

更合理的证明切面是：

```text
选择一个反馈丰富、失败成本低、容易文件化的创作类场景。
用 feng grow 出一个小说 agent 或类似创作 agent。
hatch 后让它在具体项目中运行。
开启调试模式，产生反馈单元。
验证本地吸收和上游提议边界。
用这个过程改进默认反馈路由 skill 和 hatch contract 检查。
```

小说场景适合验证：长期材料、风格一致性、章节结构、反馈归因、版本变化、hatch 包和多层回流。游戏 boss 场景很重要，但更依赖模拟器、运行接口、实时性和可复现验证，适合作为后续更强证明。

## 非目标

本概要设计不定义：

```text
具体目录结构。
具体文件 schema。
完整 CLI 子命令。
具体 provider adapter。
具体 MCP adapter。
具体 eval runner。
插件市场。
GUI。
多 agent 编排产品。
企业管理后台。
通用 agent creator 模板市场。
```

这些内容可以在后续详细设计中讨论，但不能反过来决定 feng 的产品本质。

## 开放问题

```text
第一阶段的 grow 单元最小文件集合是什么？
message list 编译结果如何让用户理解，而不暴露过多内部噪声？
readiness 的最小证据门槛应该如何按目标世界变化？
hatch 能力包第一阶段选择命令、脚本模块还是服务？
默认反馈路由 skill 的基础协议最小字段是什么？
哪些反馈必须人工确认后才能上游提议？
自动更新在开发期和发布期应如何区分？
feng 自我演进时，哪些能力允许自动候选，哪些必须人工 review？
```

这些问题不阻止进入实现设计，但必须在后续详细设计中继续保持可审计、可回滚和不被外部项目牵着走。

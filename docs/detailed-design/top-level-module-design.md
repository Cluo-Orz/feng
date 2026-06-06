# feng 顶层模块设计

本文是 feng 详细设计阶段的顶层模块设计。它位于系统概要设计和各模块 SDD spec 之间，作用类似 C4 架构中的 C2：描述 TypeScript 项目中主要模块、模块间依赖、核心数据流和产品维度的详细设计边界。

本文不定义最终目录 schema、具体文件格式、完整 CLI、provider adapter、MCP adapter 或 eval runner。它定义的是后续模块 spec 必须遵守的模块边界。

## 设计结论

feng 的 TypeScript 项目应围绕一个 file-native grow/hatch 闭环拆分模块，而不是围绕“agent 框架功能全集”拆分模块。

顶层模块集合如下：

```text
Foundation
  1. Domain Model & Contracts
  2. File-Native Store
  3. Event Ledger & Projection
  4. Artifact Registry
  5. Policy & Capability Boundary
  6. Skill Registry

Grow Kernel
  7. Grow Unit Manager
  8. Admission & Feedback Inbox
  9. Agenda & DoD Manager
  10. Context & Message Compiler
  11. Grow Attempt Runner
  12. Evidence & Readiness

Execution Capability
  13. LLM Gateway
  14. Tool Runtime

Hatch & Runtime
  15. Hatch Builder
  16. Runtime Contract Registry
  17. Agent Runtime Kernel
  18. Target World Adapter
  19. Debug & Feedback Bridge

Interface
  20. CLI
```

这 20 个模块不是平级功能列表。它们形成明确依赖方向：

```text
Interface
  -> Grow Kernel / Hatch & Runtime
  -> Foundation

Hatch & Runtime
  -> Foundation
  -> Runtime Contract Registry
  -> Policy & Capability Boundary
  -> Artifact Registry / Event Ledger

Grow Kernel
  -> Foundation
  -> Execution Capability
  -> Skill Registry

Execution Capability
  -> Foundation
  -> Policy & Capability Boundary

Foundation
  -> no feng module dependency, except internal utility dependencies
```

禁止反向依赖：

```text
Foundation 不能依赖 Grow Kernel。
Context & Message Compiler 不能调用 LLM。
LLM Gateway 不能知道 grow readiness。
Tool Runtime 不能直接写 grow state。
Agent Runtime Kernel 不能绕过 Feedback Inbox 改写 grow。
CLI 不能直接改写 file-native 事实文件。
```

## TypeScript 实现原则

feng 使用 TypeScript 编写。顶层设计要求所有模块通过 typed ports 交互，而不是共享可变对象或直接读写彼此文件。

基本原则：

```text
跨模块输入输出使用 Domain Model & Contracts 中定义的类型。
外部输入必须在边界模块解析、归一化、标记来源。
持久化写入必须经过 File-Native Store、Event Ledger 或 Artifact Registry。
模型可见 message list 只能由 Context & Message Compiler 生成。
模块不依赖当前进程内存保存关键事实。
所有关键动作都产生可文件化证据或事件。
```

模块可以在实现中拆成多个 TypeScript package 或目录，但后续 spec 先定义逻辑模块事实，不提前规定 monorepo package 名称。

## 模块说明

### 1. Domain Model & Contracts

该模块定义 feng 全系统共享的 TypeScript 领域类型、枚举、标识符、状态机状态和跨模块 DTO。

它拥有：

```text
GrowUnitId、AttemptId、ArtifactRef、EventId、FeedbackUnitId、HatchPackageId 等标识。
Grow lifecycle、feedback status、readiness verdict、runtime kernel type 等状态枚举。
MessageListRef、RuntimeContractRef、SkillRef、PolicyDecision 等跨模块契约类型。
错误结果、解析结果、审计来源和版本字段的通用表达。
```

它不拥有：

```text
文件读写。
事件追加。
LLM 调用。
工具执行。
具体 schema 持久化格式。
业务流程编排。
```

所有模块依赖它。它不依赖其他 feng 模块。

### 2. File-Native Store

该模块提供受控文件读写、原子写入、路径解析、工作区边界、文件版本和基础索引能力。

它拥有：

```text
工作区定位。
grow 单元文件空间的安全路径解析。
原子写入和读后校验。
文本/二进制文件读写。
文件存在性、更新时间、内容摘要。
发布排除和隐私排除所需的基础文件能力。
```

它不理解 grow readiness、feedback routing 或 LLM message 语义。

### 3. Event Ledger & Projection

该模块保存可重放的事件事实，并从事件生成当前状态投影。

它拥有：

```text
append-only 事件追加。
事件顺序、来源、时间和 schema/version 标记。
grow state projection。
attempt timeline projection。
feedback status projection。
hatch package lifecycle projection。
```

它不直接执行业务决策。业务模块提交事件，Ledger 保证事件可追踪、可重放、可拒绝不兼容版本。

### 4. Artifact Registry

该模块管理大材料、工具结果、message list、候选产物、验证报告、trace、hatch 包资源等 artifact 的引用和生命周期。

它拥有：

```text
ArtifactRef。
artifact 内容摘要、类型、来源、隐私级别和生命周期。
大输出的摘要、预览和 handle。
message list artifact。
tool result artifact。
runtime trace artifact。
hatch package artifact。
```

它解决 file-native 与上下文污染之间的矛盾：文件里可以有完整事实，模型只看到当前轮需要的引用、摘要或片段。

### 5. Policy & Capability Boundary

该模块负责动作边界和权限决策。它不是强安全沙箱本身，但它必须诚实表达当前实现能限制什么、不能限制什么。

它拥有：

```text
文件读写边界判断。
命令执行、网络访问、外部服务、目标世界动作的 policy decision。
隐私和上报边界。
hatch 发布排除规则。
高风险动作确认策略。
policy decision 事件和审计证据。
```

Tool Runtime、File-Native Store、Feedback Inbox、Hatch Builder、Agent Runtime Kernel 都必须通过它做边界判断。

### 6. Skill Registry

该模块管理 skill 的发现、版本、来源、启用状态、作用域和按需加载。

它拥有：

```text
skill catalog。
skill metadata。
skill body 按需加载。
默认 feedback router skill。
skill 版本、来源、禁用、回滚和适用范围。
```

它不把 skill 自动塞进 prompt。Context & Message Compiler 决定本轮哪些 skill 可见，并写入 message list 来源说明。

### 7. Grow Unit Manager

该模块是 grow 单元的业务中心。它管理一个智能行为的连续成长空间，但不暴露用户需要理解的 session 概念。

它拥有：

```text
grow 单元创建、打开、冻结、归档。
grow lifecycle 状态。
当前目标、目标世界概述、当前阶段。
与 Agenda、Admission、Readiness、Hatch 的业务协调。
```

它不直接调用 LLM、执行工具或编译 message list。它通过其他模块完成这些动作，并把结果写回事件和 artifact。

### 8. Admission & Feedback Inbox

该模块处理用户输入、材料、调试上报、反馈单元和外部事件的准入。

它拥有：

```text
durable inbox。
输入来源、版本、隐私边界和初步类型。
反馈候选状态。
采纳、拒绝、等待更多证据、上游提议、本地吸收等状态转换。
```

它的核心规则是：进入目录或收到上报不等于进入下一轮模型上下文。任何输入都要先成为可追踪候选。

### 9. Agenda & DoD Manager

该模块维护 grow 的议程、缺口、Definition of Done 和当前验证目标。

它拥有：

```text
当前 grow 目标拆解。
待解决缺口。
阻塞项。
DoD 条目。
DoD 与证据的关联。
下一轮 attempt 的意图建议。
```

它不判断最终 readiness。Evidence & Readiness 负责基于证据给出 verdict。

### 10. Context & Message Compiler

该模块从文件化事实编译模型当前可见输入。

它拥有：

```text
system prompt section assembly。
message list 编译。
来源说明。
上下文预算。
artifact 摘要、引用和排除。
可见 skill 和可见 tool 的选择说明。
压缩边界和活跃表示。
```

它不调用 LLM，不执行工具，不修改 grow state。它的核心产物是 message list artifact。

### 11. Grow Attempt Runner

该模块执行一次 grow attempt。它编排 Context Compiler、LLM Gateway、Tool Runtime、Evidence、Event Ledger，但不拥有它们的业务规则。

它拥有：

```text
attempt lifecycle。
attempt 输入快照。
LLM turn 循环编排。
tool call settlement 等待。
失败、重试、取消、中断和退出原因记录。
attempt trace。
```

它不能私自决定 hatch readiness，也不能绕过 Context Compiler 手写模型输入。

### 12. Evidence & Readiness

该模块根据证据、DoD、验证结果和目标世界反馈判断是否继续 grow、阻塞、请求输入或 ready_to_hatch。

它拥有：

```text
证据归档和证据索引。
DoD 满足状态。
验证报告解释。
readiness verdict。
失败项关闭记录。
人工确认记录。
```

Readiness 不基于模型自信，而基于可观察证据。

### 13. LLM Gateway

该模块封装 provider 调用、请求/响应标准化、流式输出、错误恢复和 provider 能力差异。

它拥有：

```text
LLM request/response adapter。
provider/model 选择结果。
streaming event normalization。
tool call block normalization。
错误分类、重试、fallback 策略的底层执行。
```

它不拥有 prompt 语义、grow 目标、工具权限或 readiness。

### 14. Tool Runtime

该模块管理工具注册、工具可见性、输入校验、权限检查、执行、结果归档和错误 settlement。

它拥有：

```text
tool registry。
tool definition materialization。
tool input parsing。
Policy decision 调用。
tool execution。
tool result artifact。
tool failure event。
```

它不决定哪些工具应进入本轮 message list。Context Compiler 根据 grow 状态和 skill/tool policy 选择可见工具。

### 15. Hatch Builder

该模块从 grow 单元提取稳定能力，生成可复制能力包。

它拥有：

```text
被采纳候选的选择。
hatch package manifest 的概念产物。
资源、依赖、运行入口和版本来源。
排除成长噪声、本机秘密、未采纳候选和临时上下文。
附带验证报告、调试能力和反馈路由能力。
```

它不能把 grow 目录原样复制成产物。

### 16. Runtime Contract Registry

该模块定义和管理 hatch 产物的运行契约。

它拥有：

```text
输入契约。
输出或事件契约。
运行内核类型。
动作边界。
调试接口。
反馈入口。
失败处理。
版本兼容说明。
```

它服务所有 hatch 产物，包括 non-LLM runtime、standard agent kernel、custom agent kernel 和 hybrid runtime。

### 17. Agent Runtime Kernel

该模块是 hatch 产物在需要 LLM agent 形态时使用的运行底座。

它拥有：

```text
runtime message list 编译。
runtime prompt sections。
运行时短期上下文。
已采纳长期记忆读取。
LLM/action loop。
runtime trace。
debug feedback candidate 生成。
生产模式版本锁定。
```

它不是 feng 的产品中心。它是 hatch 产物的一种可选高质量运行内核。

### 18. Target World Adapter

该模块把目标世界接入 Runtime Contract 和 Grow 过程。

它拥有：

```text
目标世界输入状态描述。
目标世界输出动作或事件描述。
验证入口。
调试信号。
运行失败映射。
场景策略扩展点。
```

它让小说、boss、小车、音乐等目标世界按自己的方式接入，而不是都变成对话接口。

### 19. Debug & Feedback Bridge

该模块连接 hatch 运行时和上游 grow。

它拥有：

```text
debug mode correlation。
runtime trace 上报。
feedback unit 生成。
跨层来源链路。
隐私过滤。
上游提议包。
```

它不能直接修改上游 grow 状态。所有上报都进入 Admission & Feedback Inbox。

### 20. CLI

该模块提供用户入口。

它拥有：

```text
命令解析。
当前工作区定位请求。
调用 Grow Unit Manager、Hatch Builder、Agent Runtime Kernel 等模块。
展示关键状态、缺口、readiness 和错误原因。
```

CLI 不拥有业务状态，不直接改写 grow 文件，不绕过 Policy。

## 关键流程

### Grow 流程

```text
CLI 接收用户目标或反馈。
Admission & Feedback Inbox 记录输入候选。
Grow Unit Manager 创建或继续 grow 单元。
Agenda & DoD Manager 更新目标、缺口和 DoD。
Context & Message Compiler 生成 message list artifact。
Grow Attempt Runner 调用 LLM Gateway。
LLM 输出 tool/action 请求时，Grow Attempt Runner 调用 Tool Runtime。
Tool Runtime 执行并通过 Artifact Registry 保存结果。
Grow Attempt Runner 写入 attempt trace 和退出原因。
Evidence & Readiness 根据证据给出 verdict。
Grow Unit Manager 更新 grow lifecycle。
```

### Hatch 流程

```text
Evidence & Readiness 给出 ready_to_hatch。
Hatch Builder 选择被采纳候选。
Runtime Contract Registry 固化运行契约。
Artifact Registry 收集资源、验证报告和排除清单。
Policy & Capability Boundary 检查发布边界。
Hatch Builder 生成能力包 artifact。
Event Ledger 记录 hatch lifecycle。
```

### Hatch Agent 运行与反馈流程

```text
Agent Runtime Kernel 接收目标世界输入。
Target World Adapter 归一化输入状态和输出动作边界。
Agent Runtime Kernel 编译 runtime message list。
LLM Gateway 执行模型调用。
Agent Runtime Kernel 解析输出并通过 Runtime Contract 校验。
运行 trace 写入 Artifact Registry。
Debug & Feedback Bridge 在 debug 模式下生成反馈候选。
Admission & Feedback Inbox 接收反馈候选。
Feedback 经过归因后留在本地、上游提议或拒绝。
```

### 小说多层链路

```text
F:\code\feng
  运行 Grow Kernel 和默认 skill。
  hatch 出 feng 默认能力或 xiaoshuo 创建能力。

F:\code\xiaoshuo
  作为领域 agent grow 单元。
  hatch 出 xiaoshuo 小说 agent runtime。

F:\code\libai-chongshengle
  作为具体作品运行层。
  使用 xiaoshuo runtime 写作、修订、记录 trace。
  作品级问题留在本地，小说能力问题回流 xiaoshuo，系统性问题提议 feng。
```

## 数据所有权

```text
Domain Model & Contracts
  拥有类型语言，不拥有持久数据。

File-Native Store
  拥有文件安全读写，不拥有业务语义。

Event Ledger & Projection
  拥有事件事实和状态投影，不拥有业务决策。

Artifact Registry
  拥有大型产物、trace、message list、tool result、hatch package 的引用和生命周期。

Grow Unit Manager
  拥有 grow lifecycle 和业务协调。

Context & Message Compiler
  拥有模型可见表示。

Grow Attempt Runner
  拥有 attempt 执行过程和 trace。

Evidence & Readiness
  拥有 readiness verdict。

Hatch Builder
  拥有能力包生成过程。

Agent Runtime Kernel
  拥有 hatch agent 运行时 trace 和 runtime loop。
```

这个数据所有权防止三个常见错误：

```text
把 message list 当事实来源。
把 tool result 直接塞进上下文。
把 runtime feedback 直接写成上游 grow 事实。
```

## 第一阶段核心与后续扩展

第一阶段核心包括：

```text
Domain Model & Contracts
File-Native Store
Event Ledger & Projection
Artifact Registry
Policy & Capability Boundary
Skill Registry
Grow Unit Manager
Admission & Feedback Inbox
Agenda & DoD Manager
Context & Message Compiler
LLM Gateway
Tool Runtime
Grow Attempt Runner
Evidence & Readiness
Hatch Builder
Runtime Contract Registry
Agent Runtime Kernel
Target World Adapter
Debug & Feedback Bridge
CLI
```

以下能力作为后续扩展，不进入第一阶段核心模块集合：

```text
GUI。
Local Runtime API。
cron/background 自动 grow。
多 agent 团队。
worktree 并行实验。
MCP 插件生态。
企业管理后台。
插件市场。
远程分发平台。
```

这些能力可以在后续加入，但必须挂在现有模块边界上，不能反过来改变 feng 的产品本质。

## 后续模块 Spec 顺序

模块 spec 应从低依赖到高依赖推进：

```text
1. Domain Model & Contracts
2. File-Native Store
3. Event Ledger & Projection
4. Artifact Registry
5. Policy & Capability Boundary
6. Skill Registry
7. Grow Unit Manager
8. Admission & Feedback Inbox
9. Agenda & DoD Manager
10. Context & Message Compiler
11. LLM Gateway
12. Tool Runtime
13. Grow Attempt Runner
14. Evidence & Readiness
15. Runtime Contract Registry
16. Hatch Builder
17. Target World Adapter
18. Agent Runtime Kernel
19. Debug & Feedback Bridge
20. CLI
```

越靠后的模块必须读取并遵守前面已经完成的模块 spec。每个模块 spec 都要按 SDD 风格描述“完成后的终态事实”，并经过至少 3 轮：

```text
检测 -> 调整
检测 -> 调整
检测 -> 调整
```

检测必须跳出当前模块，从顶层模块设计、产品概念、概要设计、调研学习和已完成模块 spec 的角度审视是否合理。

## 顶层设计不变量

后续任何模块 spec 不得破坏这些不变量：

```text
feng 没有用户需要理解的 session 概念。
一个 grow 单元是连续成长空间。
关键状态必须 file-native。
message list 是编译产物，不是真相来源。
输入和反馈必须先准入。
工具执行必须经过 policy。
readiness 必须基于证据。
hatch 不能复制 grow 目录。
hatch agent 不能只是 prompt 包装。
runtime feedback 不能绕过 inbox 直接污染上游。
目标世界决定 runtime 形态。
```

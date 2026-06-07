# 小说场景案例：feng -> xiaoshuo -> libai-chongshengle

本文补充小说场景的终态运行流程、生命周期目录角色和数据流转。它仍然是概念层说明，不定义最终目录 schema、文件格式、CLI 细节或运行协议。

## 核心判断

`F:\code\feng`、`F:\code\xiaoshuo`、`F:\code\libai-chongshengle` 不是三个普通项目目录的串联，而是三个生命周期层级：

```text
feng：成长系统自身。
xiaoshuo：由 feng grow/hatch 出来的领域 agent 成长项目。
libai-chongshengle：使用 xiaoshuo 的具体作品项目。
```

这三层的关系不是“所有东西互相同步”。更准确地说：

```text
上游向下游交付能力、默认 skill、runtime kernel 和反馈协议。
下游向上游提交带证据的反馈候选。
每一层只吸收属于自己职责范围的问题。
```

这样才能避免多层循环把所有问题都卷回 feng，导致 feng 被具体小说、具体项目、具体作者习惯牵着走。

## 三层目录的生命周期角色

以下是概念结构示意，不是最终目录规范。

### F:\code\feng

这是 feng 自身的成长项目。

它的生命周期目标是让 feng 这个产品变好：

```text
改进 Grow Kernel。
改进 Message Compiler。
改进默认 feedback router skill。
改进 hatch contract 检查。
改进 Agent Runtime Kernel。
改进 file-native 记录、压缩、恢复和调试能力。
hatch 出新的 feng 版本或默认能力包。
```

它应该接收来自下游的系统性问题，比如：

```text
xiaoshuo 无法判断某类反馈该不该上报。
hatch 包缺少必要的调试能力。
message list 没有保存导致问题无法复盘。
默认 runtime kernel 不能表达某类创作 agent 的长期上下文。
反馈路由 skill 泄漏了不该上报的作品内容。
```

它不应该直接吸收具体作品问题，比如：

```text
李白这一章写得不够潇洒。
某个角色的对白不够好。
某个章节节奏太慢。
某个作者更喜欢另一种文风。
```

这些问题最多作为匿名、归因后的样例进入上游，而不能原样污染 feng 的默认能力。

### F:\code\xiaoshuo

这是小说 agent 的成长项目。

它由 feng 进入目录后开始 grow。它的目标不是写某一本小说，而是成长出一个可复制的小说创作 agent。

它的生命周期目标是：

```text
理解小说创作任务。
定义小说 agent 的目标世界接口。
定义它如何接收故事设定、提纲、章节、反馈和风格要求。
定义它如何输出章节、改稿、问题清单、续写计划和反馈候选。
形成创作相关 memory/skill/context 策略。
验证它能在具体作品项目中稳定工作。
hatch 出 xiaoshuo 运行包。
```

它应该吸收来自具体作品项目的领域能力问题，比如：

```text
长篇上下文保持策略不够好。
章节计划和正文生成之间断裂。
人物设定和已写章节没有被正确纳入上下文。
作者反馈没有被转成可执行修订任务。
同类风格问题反复出现。
```

它不应该把所有作品事实都变成自己的长期记忆。`xiaoshuo` 是小说 agent，不是《李白重生了》的世界书。

### F:\code\libai-chongshengle

这是具体作品项目。

它不是 feng 的成长项目，也不是 xiaoshuo 的训练集仓库。它是一个真实作品的生产空间。

它的生命周期目标是：

```text
维护《李白重生了》的作品设定、提纲、章节和修订记录。
调用 xiaoshuo 生成、续写、改稿或评审。
保留每次运行的输入、message list、输出、trace 和作者反馈。
把运行问题整理成反馈候选。
把作品事实留在本地，除非被明确允许上报。
```

这一层最重要的边界是：具体作品数据默认属于作品项目。它可以反馈给 xiaoshuo，但不应该默认流向 feng。

## 概念目录角色示意

不是最终 schema，只表达不同目录在生命周期中的职责。

```text
F:\code\feng
  feng 产品与核心能力
  默认 grow 能力、feedback skill、agent runtime kernel
  feng 自身 grow 事实、验证证据、hatch 版本
  来自 xiaoshuo 等下游的系统性反馈候选

F:\code\xiaoshuo
  小说 agent 的成长空间
  小说创作材料、写作原则、评审样例、目标世界契约
  xiaoshuo 候选能力、验证记录、hatch 包
  来自具体作品项目的领域能力反馈候选

F:\code\libai-chongshengle
  具体小说项目
  世界观、人物、提纲、章节、修订、作者反馈
  xiaoshuo 运行 trace、debug 上报、本地反馈候选
  作品级记忆和作品级上下文
```

## 终态运行流程

### 1. feng 自身 grow

在 `F:\code\feng` 中，feng 先 grow 自己。

它形成一组默认能力：

```text
Long-running Grow Kernel。
Message Compiler。
默认 feedback router skill。
默认 Agent Runtime Kernel。
Hatch Builder 和 contract 检查。
file-native trace、message list、证据和恢复机制。
```

这些能力成熟后，feng hatch 出一个可复制的 feng 版本或默认能力包。

### 2. feng 进入 xiaoshuo 项目

在 `F:\code\xiaoshuo` 中，创作者提出目标：

```text
我要做一个小说 agent。
```

feng 不应该立刻生成一个 prompt。它应该先定义小说 agent 的目标世界：

```text
输入：作品设定、人物、提纲、已有章节、作者指令、读者/作者反馈。
输出：章节草稿、改稿、续写计划、设定冲突、风格问题、修订建议。
动作边界：能写文件、能读取作品资料、能提出问题，但不能无确认发布或删除作品。
上下文策略：区分作品事实、当前章节上下文、长期写作策略和反馈候选。
验证方式：用样例作品、章节连续性、风格一致性、设定一致性和作者反馈验证。
反馈路由：作品级问题留在作品项目，小说能力问题回流给 xiaoshuo，系统性问题提议给 feng。
```

然后 xiaoshuo grow 多轮：整理材料、生成候选 runtime、运行样例、收集失败、调整 prompt/context/skill/tool 边界，直到达到 hatch readiness。

### 3. xiaoshuo hatch 成小说 agent

`F:\code\xiaoshuo` hatch 出一个 `xiaoshuo` 运行包。

它应该携带：

```text
小说 agent 的运行入口。
作品项目接入契约。
写作和修订的 message list 编译方式。
作品上下文管理策略。
debug trace 和反馈候选生成能力。
本地吸收和上游提议边界。
验证报告和版本信息。
```

此时 `xiaoshuo` 是一个可复制的小说创作 agent，而不是某一本小说的内容包。

### 4. xiaoshuo 进入 libai-chongshengle

在 `F:\code\libai-chongshengle` 中，`xiaoshuo` 被用来写《李白重生了》。

作品项目提供：

```text
世界观。
人物设定。
章节提纲。
已写章节。
作者反馈。
本章目标。
禁用内容或风格边界。
```

`xiaoshuo` 每次运行时，应该编译本轮 message list，生成章节或修订，并写下 trace：

```text
本轮输入是什么。
使用了哪些作品事实。
使用了哪些写作策略。
生成了什么文本。
发现了哪些设定冲突。
作者或验证器反馈了什么。
产生了哪些反馈候选。
```

这里的 trace 属于作品项目。它可以被 xiaoshuo 读取用于调试，但不应默认上报给 feng。

### 5. 反馈先在本层归因

假设出现问题：

```text
李白前后性格不一致。
最新章节忘了第三章埋下的伏笔。
章节写得像说明书，不像小说。
debug trace 没有记录本轮到底用了哪些设定。
上报内容包含了不该离开作品项目的原文。
```

这些问题不能无脑往上游推。

合理归因是：

```text
具体设定没写清楚 -> libai-chongshengle 本地补材料。
单章写坏了 -> libai-chongshengle 本地修订或重跑。
反复忘前文 -> xiaoshuo 的上下文/记忆策略问题。
作者反馈无法转成修订任务 -> xiaoshuo 的反馈理解能力问题。
trace 缺少 message list -> feng 的运行记录底座问题。
上报隐私边界不清 -> feng 默认 feedback router skill 问题。
```

只有经过归因，反馈才会进入正确的 grow 层。

## 数据流转

### 向下游流动

`feng -> xiaoshuo` 流动的是成长能力和默认协议：

```text
Grow Kernel。
Message Compiler 原则。
默认 feedback router skill。
Agent Runtime Kernel。
hatch contract 检查能力。
file-native 记录和恢复能力。
```

`xiaoshuo -> libai-chongshengle` 流动的是小说 agent 能力：

```text
写作 runtime。
作品项目接入契约。
章节生成和修订 workflow。
小说上下文策略。
调试和反馈上报能力。
```

### 向上游流动

`libai-chongshengle -> xiaoshuo` 流动的是作品运行反馈候选：

```text
章节生成失败。
设定冲突。
风格偏差。
作者修订意见。
上下文遗漏证据。
运行 trace 摘要。
```

`xiaoshuo -> feng` 流动的是系统性反馈候选：

```text
默认 agent runtime 不适合某类长篇写作上下文。
message list 编译缺少某类来源说明。
feedback router skill 无法正确处理作品隐私。
hatch 包缺少必要的调试入口。
多层反馈归因规则不足。
```

上游反馈应该尽量是归因后的结构化问题，而不是把下游原始数据整包上传。

## 数据不应该如何流

几个明确禁止或高风险的方向：

```text
libai-chongshengle 的全部章节原文默认进入 feng。
某个作品的设定被 xiaoshuo 当成通用写作规则。
某次作者个人偏好直接改写 feng 默认 skill。
xiaoshuo 运行时绕过 grow，直接自我升级 runtime。
feng 因为某个具体作品失败，就默认修改全局 kernel。
```

多层循环的价值在于分层归因，而不是把所有运行数据集中到最上游。

## 用户看到的体验

理想情况下，用户不需要理解所有内部层级。用户心智应该是：

```text
我在 feng 项目里改进 feng。
我在 xiaoshuo 项目里做一个小说 agent。
我在 libai-chongshengle 项目里用这个小说 agent 写书。
哪里出问题，就先在对应项目里留下证据。
feng/xiaoshuo 会判断问题属于本地、上游还是只是一次作品反馈。
```

这仍然保持简单，但不是虚假的简单。复杂度存在于文件化证据、归因和版本边界里，而不是暴露成一堆用户必须手动配置的 agent 框架选项。

## 这个案例证明什么

小说场景适合作为第一阶段证明，因为它能同时暴露：

```text
长程上下文。
作品级记忆和通用能力的边界。
作者反馈到修订任务的转换。
多层反馈归因。
hatch 包在真实项目中的使用。
debug trace 和 message list 文件化。
默认 feedback router skill 的可改进性。
```

它也能防止 feng 过早被游戏实时性、小车硬件控制或通用 agent marketplace 带偏。小说场景不代表 feng 的全部终态，但适合作为第一个能验证多层闭环的低风险场景。

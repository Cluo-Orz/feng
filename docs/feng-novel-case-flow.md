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

当前阶段还需要一个额外角色：Codex。

Codex 不是终态产品中的第四个生命周期目录，也不是替代 feng 的长期监督者。它是当前开发和 dogfooding 阶段的流程推进者与外部审计者：

```text
推动 feng -> xiaoshuo -> libai-chongshengle 的真实闭环跑起来。
检查每一步是否真的符合本案例，而不是只是在单元测试里模拟通过。
判断 grow、hatch、run、feedback、quality gate 的文件证据是否足够。
发现流程不合理、命令形态不对、门禁缺失或归因错误时，直接调整实现或测试。
把有效的审核标准沉淀回 feng 的 grow 能力、默认 skill、质量门禁和端到端验证中。
```

因此，Codex 的目标不是告诉 feng 应该怎么写小说，也不是代替 xiaoshuo 写好《李白重生了》。它要推动系统形成这种素养：

```text
feng 能持续产出和验证高质量 agent。
xiaoshuo 能成为高质量小说创作 agent。
libai-chongshengle 最终能产出一部质量不错、可被作者继续打磨的小说。
```

这个角色以后应该逐步退场。凡是 Codex 现在靠人工判断发现的问题，都应尽量转化为 file-native 证据、质量门禁、反馈归因规则、端到端测试或 feng 自身的 grow skill。

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

它的质量门禁应该由 feng 自身 grow 产出，而不是由本文写死。门禁方向包括：

```text
能否从用户目标生成 grow 单元。
能否产出质量门禁和目标覆盖表。
能否文件化下一轮 message list。
能否记录 attempt、证据、失败原因和退出状态。
能否 hatch 出带运行契约、调试、反馈和版本边界的能力包。
能否正确处理下游反馈归因。
能否防止作品原文、私有材料或单次噪声污染上游。
```

如果 feng 自己不能产出并验证这些门禁，就不能声称已经具备可靠自我演进能力。

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

`xiaoshuo` 的质量门禁应该由 feng 在 xiaoshuo grow 中生成。示例方向包括：

```text
是否覆盖小说 agent 的输入、输出、动作边界和失败处理。
是否能把作品设定、提纲、章节、作者反馈编译成当前轮写作上下文。
是否能产出章节草稿、改稿、续写计划、设定冲突和修订建议。
是否能说明本轮写作用了哪些材料和策略。
是否能处理长篇上下文、人物一致性、章节连续性和风格约束。
是否能把作者反馈转成可执行修订任务。
是否能把失败归因到作品层、小说 agent 层或 feng 系统层。
是否能在不同作品项目中复用，而不是只会写《李白重生了》。
```

这些只是门禁维度，不是固定评分表。真正的门禁项必须来自 xiaoshuo grow 时的目标、材料、样例、反馈和验证结果。若某个目标没有进入门禁或覆盖表，xiaoshuo 不能 hatch。

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

`libai-chongshengle` 的作品质量门禁应该由 xiaoshuo 在作品项目中生成。它不是 xiaoshuo 自带的一张通用小说评分表，而是从《李白重生了》的作品目标、设定、提纲、已写章节和作者反馈里长出来。

示例方向包括：

```text
题材承诺是否成立。
李白的人物设定和变化轨迹是否稳定。
重生机制、时代背景或世界规则是否自洽。
章节目标是否完成。
人物关系、动机和事件因果是否前后一致。
伏笔、设定和已发生事件是否被继承。
叙事节奏、场景、对白和文风是否符合作者目标。
作者反馈是否被处理、挂起或拒绝并说明原因。
当前章节是否可作为候选发布稿。
```

作品层门禁可以帮助 agent 判断“结构性质量是否达标”或“是否可作为候选稿”。但小说最终是否合格，尤其是审美、趣味、读者吸引力和作者意图，早期不能完全交给 agent 自判，应该保留作者或读者验收。

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
  xiaoshuo 质量门禁和目标覆盖表
  来自具体作品项目的领域能力反馈候选

F:\code\libai-chongshengle
  具体小说项目
  世界观、人物、提纲、章节、修订、作者反馈
  作品层质量门禁和章节覆盖状态
  xiaoshuo 运行 trace、debug 上报、本地反馈候选
  作品级记忆和作品级上下文
```

对 `libai-chongshengle` 这类 hatch 结果的实际使用目录，还要区分业务产出和运行内核状态：

```text
业务产出应该在项目根目录下可见：
  chapters/                 章节正文
  outlines/ 或 outline.md    章节大纲和作品大纲
  setting-conflicts/         面向作者的设定冲突候选
  feedback-candidates/       面向作者或上游归因的反馈候选摘要
  作品设定、人物设定、作者反馈等业务材料

.feng 只放运行和审计层：
  hatch 包、package lock
  每轮 input、message-list、model-output、trace
  quality-eval、semantic-eval、quality-gates
  novel-state 这类供下一轮 runtime 编译上下文的内部索引
  debug report、feedback routing digest
```

也就是说，`.feng` 可以保存“大纲摘要被怎样用于下一轮上下文”的内部索引，但大纲本身作为小说项目的业务产出，应该在根目录业务文件中维护。否则作者使用 `xiaoshuo` 时会被迫翻运行记录，产品心智会从“写小说项目”滑向“调试 agent 内部状态”。

## 终态运行流程

### 0. Codex 推进端到端验证

在当前阶段，Codex 负责把本文描述的概念流程变成可验证的真实闭环，而不是只检查局部模块是否通过测试。

它应该持续做几件事：

```text
阅读本案例和当前实现，抽出端到端验收要求。
用真实或高保真测试目录表达 feng、xiaoshuo、libai-chongshengle 三层角色。
检查命令入口是否符合产品心智；临时命令只能作为实现过渡，不能替代概念中的 feng grow。
运行或构造端到端测试，确认 hatch 包、运行 trace、message list、质量门禁、反馈候选和上游 digest 都真实落盘。
根据实际失败调整实现、测试和门禁，而不是把失败解释成“文档已覆盖”。
```

Codex 判断一个步骤“正确”，不能只看命令退出码。它至少要检查：

```text
这一步的产物是否出现在正确生命周期目录。
这一步的 message list、trace、质量门禁和反馈是否能从文件复盘。
这一步是否没有把作品私有内容错误上报到 feng。
这一步是否把问题归因到 libai、xiaoshuo 或 feng 的正确层级。
这一步是否让下一轮 grow 能看到需要看到的证据。
```

但反过来，命令退出码也不能和质量门禁脱节。若 `run` 已经生成章节文件，但任一章节的质量门禁仍有 `blocking > 0`、`failed`、`waiting_evidence`、`needs_human_judgment` 或未覆盖目标，它只能表示“产出了可调试 artifact”，不能表示“作品通过验收”。此时运行入口应该显式阻断，后续流程必须先路由反馈、人工 review 门禁、或让上游 grow 吸收能力问题。

grow 自身的样例验证也必须按 grow 单元隔离。连续两次 grow 不能共用同一个 sample project 的 `novel-state`、message list、trace 或章节输出，否则第二次 grow 可能是在旧样例后续写，而不是验证当前候选 agent。旧 grow 的证据应该保留在对应 growUnit 的样例目录下，`latest` 类文件只能作为当前摘要或指针。

如果这些条件不成立，Codex 应该先纠正流程或实现，再继续推进下一步。

每形成一个阶段性成果，Codex 应该把当前有效成果提交并 push 到远端，而不是只保存在本地工作区。阶段性成果包括但不限于：概念或概要文档形成新的判断闭环、核心运行机制被修正、质量门禁或端到端验证能力补齐、真实 grow/run 失败被归档并转化为系统层改进。这样后续复盘时能看到每个关键判断、实现修正和验证结果的时间点。

每次准备备份、重跑、清理或替换工作目录之前，Codex 还必须先做一次缓存命中率分析，并把分析作为文件化证据写入当前项目，例如 `.feng/cache-analysis/pre-backup-<timestamp>.md` 或同等可追踪位置。这个分析不能只凭感觉判断，而要从 file-native 的 LLM usage、response artifact 或运行报告中统计：

```text
总 LLM 请求数和完成数。
有 usage 记录的调用数。
input tokens、cache read tokens、cache write tokens。
整体 cache hit rate。
按设计调用、样例运行、语义评审、修订调用等类别拆分的 cache hit rate。
0 命中调用的数量和主要来源。
message list 是否因为时间戳、路径、动态顺序、随机 id、工具面变化或重复改写 system prompt 而破坏稳定前缀。
```

成熟的长程 coding agent 通常会让稳定前缀获得很高的缓存命中率，常见目标应接近 80%-95%。feng 不应该把 10% 左右甚至更低的命中率视为正常成本；这通常说明 message list 编译、上下文分层、稳定前缀或 provider cache 观测存在问题。

缓存门禁必须区分 provider 的 cold/warm 行为，不能只看前两次调用就下结论。以 DeepSeek 官方 context cache 行为为例，两次形如 `A+B`、`A+C` 的请求可能用于识别并持久化公共前缀，第三次 `A+D` 才是更有效的命中验证点。因此 `feng -> xiaoshuo` 的样例验证如果要判断章节生成缓存，至少需要三次同类、同稳定前缀的 generation 调用，或在报告中明确区分：

```text
cold prefix-discovery calls: 允许低命中，但必须被单独标记。
warm comparable calls: 应进入 80%-95% 目标区间。
phase aggregate: 只能作为辅助指标，不能掩盖 warm call 是否健康。
```

低缓存命中率不是简单的费用问题，而是长程任务质量信号：

```text
如果 usage 没有被完整记录 -> 先补 file-native 成本和缓存观测。
如果 system prompt 或核心规则频繁变化 -> 回流 Message Compiler/Grow Kernel。
如果每轮把历史全文重新拼接到不稳定位置 -> 调整上下文分层和摘要策略。
如果动态材料污染稳定前缀 -> 把稳定规则、工具说明、skill 说明和变动事实分段。
如果 provider 不支持或未启用缓存观测 -> 在运行报告中明确不可观测，不能假装命中率健康。
```

备份只能保存当前证据，不能掩盖上下文编译问题。若备份前发现缓存命中率显著偏低，必须在本轮分析记录中写清原因、影响、是否允许继续备份/重跑、以及是否需要作为 feng 系统层反馈候选进入下一轮 grow。特别是当整体命中率接近 10% 或关键阶段大量 0 命中时，Codex 不能只说“已备份”；它应该先判断 Message Compiler、Prompt / Context Kernel、usage 记录或 provider cache 设置是否已经成为当前端到端流程的阻塞项。

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
质量门禁：由 xiaoshuo grow 产出，覆盖领域 agent 合格性和不能漏题要求。
验证方式：用样例作品、章节连续性、风格一致性、设定一致性、作者反馈和门禁证据验证。
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
质量门禁生成和目标覆盖能力。
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

xiaoshuo 进入作品项目后，应该先产出作品层质量门禁和目标覆盖表，再开始判断章节是否合格。否则它只是在生成文本，不是在维护一部小说。

`xiaoshuo` 每次运行时，应该编译本轮 message list，生成章节或修订，并写下 trace：

```text
本轮输入是什么。
使用了哪些作品事实。
使用了哪些写作策略。
生成了什么文本。
发现了哪些设定冲突。
哪些作品层门禁已通过、失败、待验证或需要作者判断。
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
作品层门禁漏掉了作者目标 -> libai-chongshengle 更新作品门禁。
反复忘前文 -> xiaoshuo 的上下文/记忆策略问题。
多个作品都漏掉同类门禁 -> xiaoshuo 的门禁生成能力问题。
作者反馈无法转成修订任务 -> xiaoshuo 的反馈理解能力问题。
trace 缺少 message list -> feng 的运行记录底座问题。
无法阻止未覆盖目标进入 hatch -> feng 的 quality gate/readiness 机制问题。
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

## 质量目标

这个案例最终要证明的不是“命令能跑通”，而是三层质量都成立。

对 `feng` 来说，质量目标是：

```text
能把模糊目标转成可验证的 grow 单元。
能让目标 agent 自己产出运行契约、门禁、覆盖表和反馈策略。
能用端到端证据判断 hatch 是否真的 ready。
能避免被单个下游项目牵着走。
能把 Codex 当前的外部审核动作逐步内化成 skill、门禁和测试。
```

对 `xiaoshuo` 来说，质量目标是：

```text
不是一个写作 prompt，而是一个能在作品项目中运行、记录、评审、回流的小说 agent。
能稳定管理长篇上下文、人物、时间线、地点、伏笔、章节目标和作者反馈。
能区分作品事实、写作能力问题和 feng 系统问题。
能在多个作品项目中复用，而不是只记住《李白重生了》的设定。
```

对 `libai-chongshengle` 来说，质量目标是：

```text
不是只生成章节文本，而是逐步形成一部可继续打磨的小说。
章节目标、人物弧线、重生设定、时代冲突、伏笔和情节推进都要进入作品层门禁。
agent 可以辅助判断结构性质量，但审美、趣味和作者意图仍需要作者或读者验收。
```

如果端到端测试只证明了文件被写入，而不能证明这些质量目标被检查、失败能被归因、归因能推动下一轮 grow，那么这个闭环仍然不算成立。

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

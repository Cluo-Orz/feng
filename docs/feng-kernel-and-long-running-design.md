# feng 长程任务与 Agent Kernel 设计补充

本文补足当前概要设计里的一个关键缺口：feng 自身为什么能承担长程 grow，以及 hatch 出来的 agent 为什么不是一个只有 prompt 的空壳。

这里仍然不是实现设计。不定义目录结构、文件 schema、provider adapter、CLI 细节或具体工具协议。它只定义概念层必须成立的 kernel 边界、长程任务保障、prompt/context 管理原则和 hatch agent 的质量底线。

## 顶层判断

feng 不应该只有一个“通用 agent 内核”。更合理的拆法是：

```text
Grow Kernel：feng 自己用来长期 grow、验证、hatch、吸收反馈的内核。
Agent Runtime Kernel：hatch 结果在需要 LLM agent 形态时使用的运行内核。
Runtime Contract：hatch 产物无论是否使用 LLM，都必须遵守的对外运行契约。
```

这三个东西相关，但不能混成一个。

Grow Kernel 关注的是长程成长：目标如何延续、材料如何准入、上下文如何编译、证据如何积累、失败如何恢复、什么时候继续 grow、什么时候 ready to hatch。

Agent Runtime Kernel 关注的是运行时行为：外界状态如何进入模型、模型如何选择动作、动作如何被验证和执行、运行日志如何记录、问题如何回流。

Runtime Contract 关注的是可复制和可接入：目标世界如何调用它、它能输出什么、失败怎么处理、如何调试、如何上报。

这个拆分很重要。否则 feng 会被做成一个 agent creator：先设计一个 agent 模板，再把所有目标都塞进模板。feng 的产品本质不是模板生成，而是智能行为成长。只是当目标世界需要 LLM agent 时，feng 必须能 hatch 出足够优秀的 agent。

## 不能照搬的地方

优秀 agent 项目值得学习，但不能让 feng 变成“被调研对象牵着走”的拼装产品。

可以学习的是：

```text
opencode 的持久输入、事件事实、上下文投影和压缩边界。
learn-claude-code 的小 loop、大 harness、system prompt 分节、memory/skill 按需注入和完整 transcript 保留。
Hermes 的长程任务治理、heartbeat、reclaim、cron fresh run 和失败边界。
CodeWhale 的 context/memory 分层、artifact handle 和子任务隔离。
AssistantAgent 的 Prompt Contributor、经验渐进披露和工具视图对齐。
Shinsekai 的目标世界协议、模板分层和运行管线塑形。
```

不能复制的是它们的产品心智：session 管理、聊天产品、coding agent UI、多 agent 团队、Java/Spring 平台、角色对话桌面端、通用模板市场。这些都不是 feng 的终态。

## Grow Kernel

Grow Kernel 是 feng 自己的长程任务内核。

它的承诺不是“无限跑下去一定成功”，而是：

```text
目标不会丢。
状态可以恢复。
下一轮模型输入可检查。
失败会留下原因。
长程上下文不会只靠聊天历史延续。
外部反馈不会无准入地污染 grow。
ready/hatch 不依赖模型自信。
```

### 长程任务的最小保障

一个长程 grow 必须有稳定的任务骨架，而不是只靠一串 messages。

概念上，Grow Kernel 至少维护这些层：

```text
目标契约：当前 grow 到底要成为什么。
DoD：什么证据能说明它足够 hatch。
议程：下一步要推进的缺口、候选和验证点。
事实账本：用户输入、材料、工具结果、运行记录、反馈和采纳决定。
尝试记录：每次 grow attempt 的输入快照、message list、动作、结果、退出原因。
阻塞状态：缺什么材料、权限、确认或验证环境。
恢复点：中断后从哪里继续，而不是从聊天尾巴猜。
```

这才是长程任务能力。长程不是把上下文窗口变大，也不是把所有历史压成一个摘要。长程任务的核心是：每次 wake up 时，系统都能从文件化事实重新编译出“现在该看什么、该做什么、为什么”。

### 状态机，而不是无尽循环

Grow Kernel 应该把 grow 看成一个可恢复状态机。概要状态可以是：

```text
created：目标刚进入。
clarifying：缺少关键材料或目标边界。
planning：正在形成 DoD、运行契约和验证路径。
growing：正在生成、修改或运行候选能力。
waiting_input：需要用户、外部材料或权限。
waiting_feedback：等待 hatch 产物或调试环境回流。
verifying：正在基于证据判断是否满足 DoD。
ready_to_hatch：证据足够，可以进入 hatch。
hatched：已产出能力包。
blocked：连续失败或缺口无法自行推进。
archived：本 grow 单元被关闭或冻结。
```

这些状态不一定要直接暴露给用户，但它们必须影响下一轮 message list。比如 `waiting_input` 时，模型不应该继续编造缺失材料；`verifying` 时，模型不应该继续无限改 prompt；`ready_to_hatch` 时，系统应该收敛到打包和契约检查。

### Wake 与 Resume

feng 的长程 grow 会被很多事情唤醒：

```text
用户补充材料。
用户给反馈。
定时 grow。
后台验证完成。
hatch 产物调试上报。
目标目录文件变化。
手动 resume。
上游 skill 更新。
```

这些事件不应该直接塞进模型上下文。它们应该先进入 grow 单元的输入队列或反馈队列，再经过准入判断：采纳、拒绝、等待更多证据、只作为参考、上报上游或留在本地。

Resume 的关键不是恢复进程，而是恢复判断。下一轮 message list 应该由 Grow Kernel 从稳定文件状态编译出来，并写成文件。这样即使进程崩溃、模型请求失败或工具执行中断，feng 也能知道上一次做到哪、留下了什么证据、哪些外部效果已经发生、哪些动作不能重放。

### 尝试记录

每次 grow attempt 都应该留下可检查记录：

```text
本次 wake 来源。
进入模型前的 message list。
本轮使用的目标、DoD、材料、skill 和工具面。
模型输出。
工具调用和结果。
候选能力变化。
验证结果。
失败或退出原因。
下一步建议。
```

这不是为了“保存所有垃圾”，而是为了防止长程任务变成不可追踪的连续幻觉。可以压缩、归档、摘要和脱敏，但关键状态不能只留在进程内存或 provider 上下文里。

### 失败、重试和阻塞

长程 grow 必须限制无限重试。

合理规则是：

```text
模型错误可以重试，但要有次数和退避。
上下文过长可以触发压缩，但不能丢失完整记录。
工具失败要记录失败类型、输入、环境和外部副作用。
同一缺口连续失败后进入 blocked 或 waiting_input。
缺少材料时列出最小缺口，而不是继续自说自话。
```

这也是 feng 可行性的关键。没有阻塞状态的“自我演进”会把所有失败都解释成还要再跑一轮，最终产物不可验证、不可复现、不可信。

## Feng Prompt / Context Kernel

feng 的 prompt 不应该是一个巨大的固定系统提示词。它应该由当前 grow 单元状态编译出来。

### System Prompt 分节

Grow Kernel 需要一个稳定但可编译的 system prompt 结构。概念上可以分成：

```text
身份和产品边界：feng 是智能行为成长系统，不是通用 agent creator。
核心不变量：file-native、无用户 session、证据优先、反馈候选、hatch 非固定 LLM loop。
当前 grow 目标：本 grow 单元要塑造什么。
目标世界契约：输入、输出、动作边界、观察和验证方式。
DoD：什么才算可以 hatch。
当前阶段：clarifying、growing、verifying、waiting 等。
可见材料：本轮允许模型使用的材料摘要和引用。
可见 skill：本轮激活的 skill 及其作用范围。
可见工具：本轮可调用能力和权限边界。
反馈状态：待归因、已采纳、已拒绝、待上游提议。
行动要求：本轮应该推进什么，不能做什么。
```

这套分节要由真实状态驱动，而不是靠关键词猜测。例如有新的 hatch 调试上报，不代表它自动进入当前 prompt；工具面变化也必须让 message list 重新编译，不能让模型继续基于旧工具集行动。

### Context 分层

feng 的上下文至少要分层：

```text
完整事实层：文件化真相来源。
活跃表示层：本轮 message list。
索引/摘要层：大材料、长日志和旧记录的可见摘要。
artifact 层：大工具结果、候选产物、验证报告和完整 transcript。
memory/skill 层：可复用知识和流程，但按需进入。
反馈候选层：未采纳的上报、运行问题和归因建议。
```

模型看到的是活跃表示，不是完整事实。文件是事实来源，message list 是当前轮视图。压缩只改变活跃表示，不应该改写事实层。

### Message List 编译原则

下一轮 LLM loop 的 message list 必须是一等文件化产物。

它应该能回答：

```text
为什么本轮要解决这个问题？
哪些事实被纳入？
哪些事实被排除、压缩或只给 handle？
哪些反馈已被采纳，哪些只是候选？
当前可见工具和 skill 为什么是这些？
本轮有哪些权限和动作边界？
如果本轮失败，下一次如何恢复？
```

这意味着 message list compiler 不是 prompt 模板，而是一个状态投影器。它把长程成长状态投影成模型当前能处理的输入。

### Memory 与 Skill

Memory 和 skill 都不能变成“隐藏地往 prompt 里塞东西”。

更稳的原则是：

```text
目录和描述可以轻量常驻。
正文、示例、脚本和长经验按需载入。
每次载入都要有原因和来源。
学习到的经验默认是候选，不自动成为规则。
skill 变更需要版本、来源、证据和回滚边界。
```

这对 feng 自我演进尤其重要。默认反馈路由 skill 可以 grow，但基础协议不能被某个下游项目随意改坏。

## Agent Runtime Kernel

hatch 产物不一定是 LLM agent。但当 hatch 结果需要 LLM agent 形态时，feng 应该提供一个高质量的默认 Agent Runtime Kernel。

这个 kernel 不是 feng 的全部，也不是 feng 的产品定位。它是 hatch 结果的一种强能力底座。

### 最小运行循环

一个优秀 hatch agent 的 loop 应该足够小：

```text
接收目标世界输入。
编译本轮运行 message list。
调用 LLM。
解析输出或 tool/action 请求。
验证动作是否合法。
执行动作或产生输出。
记录 trace。
根据结果进入下一轮、停止、等待或上报反馈。
```

复杂度应该在 loop 周围：权限、上下文、memory、工具、调试、反馈路由、错误恢复、版本和打包，而不是把所有东西塞进一个神秘 prompt。

### Runtime Prompt 分节

Agent Runtime Kernel 的 prompt 与 feng Grow Kernel 的 prompt 不能完全相同。

runtime prompt 应该围绕目标世界行动：

```text
角色/任务：这个 agent 在目标世界中负责什么。
输入状态：本轮外界给了什么观察。
允许动作：它能输出什么、调用什么、修改什么。
禁止动作：哪些动作需要拒绝、降级或请求确认。
目标约束：体验目标、风格目标、安全目标或业务目标。
短期上下文：当前运行片段中的必要状态。
长期记忆：已验证可复用的事实、偏好或策略。
工具说明：本轮真实可调用工具。
输出格式：目标世界能消费的事件、动作或文本。
调试要求：需要记录的决策理由、置信度或异常。
停止/求助条件：什么时候不能继续行动。
```

这能保证 boss agent、小说 agent、小车 agent 不会被迫使用同一种对话心智。它们可以共享内核原则，但 prompt 的目标世界 section 必须不同。

### Runtime Context 管理

hatch agent 也需要 file-native 的上下文治理，但它的重点不同。

运行时至少应该区分：

```text
当前观察：外界本轮输入。
运行短记忆：本次运行片段需要保留的状态。
长期记忆：经过采纳的跨运行知识。
目标世界规则：输入/输出/动作边界。
工具结果：本轮或近期工具调用结果。
trace：模型输入、输出、动作、执行结果和异常。
反馈候选：运行中发现的问题和上报建议。
```

运行日志不应该自动成为长期记忆。一次 boss 死亡、一章小说的局部失败、一次小车碰撞，都可能是重要证据，但未必应该变成 agent 的永久规则。它们应该先成为反馈候选，再由本地 grow 或上游 grow 归因。

### 对外能力

hatch agent 可以支持对话，但不能默认把对话当唯一能力。

一个优秀的 agent 产物应该声明：

```text
是否支持对话。
是否支持事件输入。
是否支持流式状态输入。
是否支持工具调用。
是否支持外部动作。
是否支持调试模式。
如何输出结果。
如何暴露错误。
如何上报反馈。
```

对于游戏 boss，主要接口可能是状态输入和动作输出；对于小说 agent，对话、文件材料和章节生成都重要；对于小车 agent，传感器输入和控制动作更重要。Agent Runtime Kernel 要服务目标世界，而不是把所有目标变成聊天机器人。

### Trace 与 Debug

Agent Runtime Kernel 必须提供运行可观察性。

每次运行至少要能追踪：

```text
收到什么输入。
编译了什么 message list。
模型看到了哪些材料和工具。
模型输出了什么。
系统执行了什么动作。
动作是否合法。
外部世界返回了什么结果。
本轮是否产生反馈候选。
```

这不是为了调试炫技，而是为了让 hatch 产物能参与后续 grow。如果产物不能解释自己怎么失败，就无法形成可靠反馈路由，也无法自我改进。

### 更新边界

hatch agent 不能在生产运行中随意改写自己。

更合理的边界是：

```text
开发/调试模式：允许采集 trace、形成反馈候选、请求本地 grow。
发布/生产模式：运行版本锁定，反馈只上报，不自动改内核。
升级：由 grow 产生新版本 hatch 包，经验证后替换。
回滚：保留旧版本和验证证据。
```

否则“自我演进”会变成不可复现的运行时漂移。

## Hatch Kernel 选择

hatch 产物应该声明自己使用哪类运行内核：

```text
standard-agent-kernel：使用 feng 默认 LLM agent runtime。
custom-agent-kernel：使用 grow 出来的定制 LLM loop。
non-llm-runtime：不使用 LLM loop，但仍遵守 Runtime Contract。
hybrid-runtime：部分 LLM，部分规则/状态机/行为树/脚本。
```

这不会让 feng 退化成 agent creator。原因是：feng 不是让用户从模板市场选择一个 kernel，而是在 grow 过程中根据目标世界、证据和 DoD 判断什么形态最合适。

kernel 选择本身也是 grow 的结果。

## 两个 Kernel 的关系

Grow Kernel 和 Agent Runtime Kernel 可以共享一些基础能力：

```text
message list 编译。
上下文分层。
artifact handle。
skill 按需加载。
工具权限。
trace。
反馈候选。
版本边界。
```

但它们的目标不同：

```text
Grow Kernel 负责让能力变成熟。
Agent Runtime Kernel 负责让成熟能力在目标世界中行动。
```

Grow Kernel 可以改进 Agent Runtime Kernel。Agent Runtime Kernel 可以把运行问题上报给 Grow Kernel。但运行中的 agent 不应该绕过 grow 直接改写自己的核心规则。

## 对当前概念的修正

这次补充后，feng 的概念终态更清晰：

```text
feng 是 file-native 的智能行为成长系统。
它自身具备长程 grow kernel。
它通过文件化事实、message list 编译、状态机、证据和反馈准入来保证长程任务。
它 hatch 的结果不一定是 LLM agent。
但当结果是 agent 时，必须具备优秀的 runtime kernel。
runtime kernel 至少包含 prompt 分节、上下文治理、工具/动作边界、trace、debug 和反馈路由。
多层回流通过 feedback skill 进入 grow，但上报不等于吸收。
```

这也解释了为什么 feng 仍然不是 agent creator：agent kernel 是 hatch 可能使用的高质量运行底座，不是产品的起点和中心。

## 仍然开放的问题

```text
Grow Kernel 的状态机第一版要保留多少状态，才能不显得沉重？
message list 文件应该如何让人能读懂，同时不暴露过多内部噪声？
默认 Agent Runtime Kernel 是否应该第一阶段只服务创作类 agent？
非 LLM hatch 产物如何共享同一套反馈和 trace 原则？
哪些 skill 属于 feng 核心不变量，哪些允许被 grow 替换？
生产模式下哪些反馈可以自动生成候选，哪些必须人工确认？
```

这些问题可以进入下一阶段详细设计，但它们不改变本文的核心判断：feng 必须先有可信的长程 Grow Kernel，hatch agent 才可能成为真正可用的 agent，而不是一段被包装起来的 prompt。

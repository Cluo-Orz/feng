# Agent 设计学习总结

本文是调研阶段总结，不是 feng 的系统概要设计。它的目的，是把 CodeWhale、opencode、Hermes、Shinsekai、AssistantAgent、learn-claude-code 的设计理念压缩成可复用判断，并继续防止 feng 变成“被调研对象牵着走”的拼装产品。

## 总体判断

优秀 agent 项目的共同点不是“功能多”，而是它们都把模型行动放进了一个清晰的运行世界里。这个世界通常包含：输入准入、上下文编译、工具边界、权限、观察、证据、任务状态、错误恢复、反馈通道、打包和版本。

另一个共同点是：成熟系统不会把聊天历史当能力。聊天历史只是原始材料。能力必须被整理成可复用、可约束、可验证、可部署的状态或契约。对 feng 来说，这一点是最核心的纠偏：grow 不能等同于“多聊几轮”，hatch 不能等同于“复制一段记忆”。

第三个判断：agent 的运行形态不应该先验固定。Shinsekai 说明目标世界会重塑 LLM 输出；AssistantAgent 说明能力可以被表达成代码片段、工具契约、回复渠道和触发器；learn-claude-code 说明 coding agent 的核心 loop 可以很小。feng 未来 hatch 出来的东西可能是 LLM loop，也可能是命令、服务、行为树、脚本、目标世界组件或混合体。关键不是形态，而是它是否带有运行契约、验证证据和反馈路由。

## 六个核心学习

### 1. 小 loop，大 harness

learn-claude-code 和 CodeWhale 都证明，agent core 可以保持很小：messages 进入模型，模型选择工具，工具结果回到下一轮。复杂度应该挂在 loop 周围，而不是塞进一个不可解释的大循环。

feng 应学习这种分层：grow loop 可以小，但 grow 单元外部必须有文件化状态、工具/世界接口、权限、证据、压缩、错误恢复、反馈路由和 hatch contract。复杂度不可消失，只能被放到能审计的位置。

### 2. 文件事实和模型可见表示必须分开

opencode、learn-claude-code 和 CodeWhale 都在做同一件事：把完整事件、transcript、tool result、memory、context source、projection 和 provider message list 分层。模型看到的是编译后的当前表示，不是全部事实。

这直接支持 feng 的 file-native 要求：运行中产出的关键内容都应该能找到，包括下一轮 LLM loop 使用的 message list。但 file-native 不等于把所有文件都塞进上下文。文件是事实来源，message list 是当前轮编译结果。

### 3. 目标世界决定对外契约

Shinsekai 最有价值的地方，是把 LLM 输出塑造成角色演出事件，而不是普通聊天。角色、旁白、选项、场景、BGM、CG、TTS、插件和 UI handler 共同组成了目标世界。

这说明 feng 的 hatch 产物必须从目标世界出发。游戏 boss agent 需要游戏可消费的决策/事件契约，小说 agent 需要章节、风格、素材和修订工作流，音乐 agent 需要结构、素材、生成和评审接口。不能把所有产物都压成一个通用对话 agent。

### 4. 成长必须有证据链和采纳边界

AssistantAgent 的 Experience/Learning 和 Hermes 的 skills/curator 都说明：记录不等于学习，候选不等于采纳，模型总结不等于能力成熟。

feng 的反馈回流必须分层：下游问题、证据、归因、建议、采纳请求、拒绝原因、版本影响和上游沉淀都要有边界。不能让所有问题无脑往上游吸收。尤其在多层循环中，默认上报 skill 可以存在，但它本身也要可审计、可替换、可演进。

### 5. 安全边界要诚实

Hermes 和 Shinsekai 都明确说明：插件、hook、MCP、权限提示和模式匹配不是强安全边界。真正边界来自 OS 隔离、沙箱、权限模型、网络限制、凭据管理、执行记录和可撤销策略。

feng 不能把“模型被提示不要做”当安全设计。hatch contract 必须声明实际能做什么、需要什么权限、有哪些外部动作、日志在哪里、失败如何处理、如何停止和回滚。

### 6. 可复制不是复制目录

Shinsekai、AssistantAgent 和 opencode 都在提醒：交付物需要版本、依赖、资源、schema、manifest、导入导出、冲突策略、诊断、测试和运行说明。可复制能力必须把稳定能力从原始成长历史、失败尝试、本地秘密和临时上下文中分离出来。

feng 的 hatch 应该产出“可运行能力包”，而不是把 grow 目录原样搬走。包里要有目标世界契约、输入输出、权限、资源、验证报告、反馈路由和版本信息。

## 主要误区

```text
把 grow 当聊天记忆累积。
把 hatch 当复制上下文或目录。
把任务清单推进当能力成熟。
把自动记录经验当自我演进。
把插件/MCP/动态工具当安全能力。
把多 agent 团队当产品高级感。
把文件化理解成无节制记录所有垃圾。
把优秀项目的具体形态拼成 feng 的终态。
```

## 对 feng 的阶段性压力

feng 最小可信闭环不应该是“能生成一个 agent”，而应该是：

```text
创作者提出一个智能行为目标。
feng 在一个 grow 单元中收集材料、定义目标世界接口、生成/修改候选行为。
候选行为在可观察环境中运行，产生文件化证据。
feng 根据 DoD、反馈和验证判断是否继续 grow。
达到 readiness 后 hatch 成可复制交付物。
交付物在调试/运行中上报结构化反馈。
反馈经过过滤、归因和采纳边界后，进入本层或上游 grow。
```

这个闭环可以内部复杂，但产品第一心智必须简单：用户不是在配置 agent 平台，而是在塑造一个目标行为，直到它“成了”。

## 仓库级结论

```text
CodeWhale：学习 typed state、history、tool evidence 和小步可审计自改进；不要复制聊天/线程产品面。
opencode：学习事件事实、投影消息、context source 和 provider request 的分层；不要复制 coding UI/session/fork。
Hermes：学习长期运行治理、观察/阻断/改写权分离、skills/curator/cron 的生命周期；不要复制大平台和多 agent 运营面。
Shinsekai：学习目标世界契约、输出事件协议、资产迁移和发布诊断；不要复制角色聊天/桌面设置中心。
AssistantAgent：学习 CodeAct、Prompt Contributor、Experience 披露、外部能力契约、package 管理和 trace；不要复制 Java/Spring 企业平台。
learn-claude-code：学习小 loop、大 harness、上下文治理、任务/后台/cron/team/worktree/MCP 在 loop 中的位置；不要复制 Claude Code 功能全集。
```

## 当前结论

feng 仍然可行，但可行点不在“做一个更强的 agent creator”。更准确的定位是：feng 是一个 file-native 的智能行为成长系统。它让模糊目标在真实材料、目标世界接口、运行证据、反馈回流和版本边界中被逐步塑形，并在足够成熟时 hatch 成可复制能力包。

这个方向的难点不是做出很多工具，而是让“成长”可信：每一次变化为什么发生、依据是什么、验证了什么、失败了什么、采纳了什么、下一轮模型会看到什么，都必须能在文件中找到。

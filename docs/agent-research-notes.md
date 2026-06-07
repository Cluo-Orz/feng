# Agent 调研笔记

本文记录当前目录中几个优秀 agent 项目的设计观察。重点不是表层功能，而是它们背后的产品理念、运行约束和对 feng 的启发。

本文混合记录预读结论和已完成 5 轮深读后的修正。只有完成 5 轮“看代码 -> 记笔记 -> 写小结 -> 再看代码”的仓库，才能作为后续 feng 设计阶段的依据；未完成仓库的内容只能作为后续深读起点。

阅读范围：

```text
CodeWhale/
opencode/
hermes-agent/
Shinsekai/
AssistantAgent/
learn-claude-code/
```

## 调研流程约束

每个仓库至少 5 轮。每轮必须包含：

```text
看代码：阅读核心源码、入口、状态模型、工具/插件/运行循环，而不只读 README。
记笔记：记录观察到的设计事实、代码结构和关键取舍。
写小结：用自己的话判断这个设计为什么好、风险在哪里、feng 能学什么。
再看代码：带着上一轮问题回到代码，验证小结是否成立。
```

所有仓库完成 5 轮前，不进入 feng 系统概要设计。feng 设计开始前，还需要额外进行至少 5 轮：

```text
复习学习结果。
看 feng 概念和草稿。
反思概念是否被外部项目误导。
写新草稿。
```

这条流程是为了防止“看了几个表层功能就开始设计”，也防止 feng 变成“被调研对象牵着走”的拼装产品。feng 的目标不是复制某个优秀 agent，而是吸收它们对状态、边界、证据、上下文、工具和演进的处理方式。

因此，每轮小结都必须区分：

```text
可以学习的底层原则。
只适合原项目的产品形态。
如果照搬会把 feng 带偏的设计。
需要回到 feng 概念重新判断的开放问题。
```

## 总体发现

优秀 agent 项目的共同点不是“prompt 更神”，而是把模型放进一个可观察、可约束、可复现的运行环境里。模型负责推理和生成，系统负责输入准入、上下文构造、工具边界、权限、证据、回放、压缩、发布和回滚。

这对 feng 很重要：feng 不应该试图证明自己“会自动变聪明”，而应该证明自己能把一个智能行为的成长过程变成可追踪的工程事实。

关键共识：

```text
上下文不是记忆，聊天历史不是能力。
能力必须被契约化、验证化、可复用化。
运行记录必须能回看，否则无法信任自我演进。
工具和权限是 agent 产品的一部分，不是实现细节。
对外形态可以变化，但边界、证据和反馈路由必须稳定。
自我改进必须小步、可审计、可回滚，不能等同于自由改写自己。
```

## CodeWhale

参考文件：

```text
CodeWhale/README.md
CodeWhale/docs/ARCHITECTURE.md
CodeWhale/docs/RECURSIVE_SELF_IMPROVEMENT.md
CodeWhale/docs/SUBAGENTS.md
CodeWhale/docs/MEMORY.md
CodeWhale/docs/RECEIPTS.md
CodeWhale/docs/TOOL_LIFECYCLE.md
CodeWhale/docs/SKILL_INVOCATION_DESIGN.md
CodeWhale/docs/RUNTIME_API.md
```

CodeWhale 的强点在于它把 agent 的“行为可信度”拆成很多可治理的层：宪法、工具生命周期、子 agent 生命周期、记忆边界、运行 API、回执、任务管理、快照和回滚。

最值得学习的理念是“自我改进不是大规模自我改写，而是小的、可审计的贡献”。它的递归改进不是让 agent 随便修改自身，而是要求改变能被描述、验证、审查和回滚。这一点直接击中 feng 的风险：如果 feng 的 grow 可以改任何东西，但没有证据链和版本边界，它不是自我演进，而是不可控漂移。

对 feng 的启发：

```text
grow 应该产出候选变化，而不是直接把变化等同于能力。
hatch 前需要可检查的 ready 证据，而不是模型自信。
每轮 grow 应该留下可回滚的边界。
默认 skill 可以演进，但其基础协议和审计要求不能被轻易删除。
工具输出过大时应该成为可引用 artifact，而不是全部塞回上下文。
memory 必须有明确不收录内容：密钥、临时片段、原始失败噪音、无来源判断。
```

不能照搬的地方：

CodeWhale 更像一个完整 coding agent 运行时，而 feng 的产品心智不是“另一个编程助手”。feng 应该吸收它的治理思想，但不应该把自身首屏复杂度做成工具平台。

5 轮深读后的修正：

```text
CodeWhale 最值得 feng 学的不是 thread/session，而是状态变迁、工具证据、权限边界、artifact/receipt 分层和小步自我改进。
CodeWhale 的 message list 来自 session.messages；feng 不能照搬 session 心智，而应该让 message list 属于 grow 单元。
CodeWhale 的自我改进是“一个小补丁 + 可审查证据”，不是自由改写自己；feng 的 grow 也应该停在候选和证据层，hatch/上游吸收另行确认。
CodeWhale 会主动压缩模型可见工具面；feng 也要避免因为 grow 和 skill 机制不断膨胀成拼装产品。
```

## opencode

参考文件：

```text
opencode/README.md
opencode/specs/project.md
opencode/specs/v2/session.md
opencode/specs/v2/instructions.md
opencode/specs/v2/config.md
opencode/specs/v2/todo.md
opencode/specs/v2/schema-changelog.md
```

opencode v2 的强点是把 session 当成一个持久、可重放的运行系统，而不是一段聊天。它区分用户输入 inbox、模型可见历史、事件、投影消息、上下文 epoch、工具调用、权限状态和压缩边界。

最值得学习的是“下一轮模型输入不是随手拼 prompt，而是由持久状态编译出来的”。这和 feng 的 file native 要求高度一致：下一轮 LLM loop 使用的 message list 必须是文件化产物，能解释它从哪些目标、材料、反馈和约束编译而来。

对 feng 的启发：

```text
用户输入可以先进入 durable inbox，再被 grow 准入和归类。
message list 应该是可检查的编译产物，而不是临时请求体。
上下文变化需要 epoch 边界，避免隐性污染下一轮判断。
压缩不能丢失完整记录，只能改变活跃上下文表示。
事件顺序应该由系统序号决定，不依赖时间戳或 UI 到达顺序。
工具注册、权限和插件贡献需要有作用域，否则 replay 会失真。
```

不能照搬的地方：

opencode 的核心问题是“人在代码仓库里和 agent 协作”。feng 的问题更泛化：创作者想塑造一个智能行为，并最终 hatch 到游戏、写作、音乐或其它目标世界。feng 需要学习 opencode 的状态模型，但不能把产品收缩成 coding session。

5 轮深读后的修正：

```text
opencode 最值得 feng 学的不是 session API，而是 durable input、context epoch、事件/投影/活跃上下文分层、scoped transform、权限和 schema 版本治理。
opencode 的输入准入层提示 feng：用户材料、调试上报和反馈不能一进入目录就污染下一轮 message list，必须经过 grow 单元准入、采纳、拒绝或等待。
opencode 的 context epoch 提示 feng：下一轮 message list 需要来源快照、不可用状态和更新事件，不能每轮隐藏式重拼 prompt。
opencode 的 compaction 提示 feng：压缩只改变模型可见表示，不能替代完整成长证据；file native 要分层，而不是把摘要当真相。
opencode 的 scoped tool/plugin/catalog 机制提示 feng：默认反馈 skill 可以演进，但必须可撤销、可审计、有作用域，不能膨胀成插件市场。
opencode 的 provider/model/request/schema changelog 提示 feng：hatch 产物需要能力契约、版本边界和兼容说明；不支持项应显式失败，而不是猜测降级。
不能被 opencode 带偏：feng 没有面向用户的 session 概念，不应复制 thread/session/fork/coding UI；feng 也不是 provider/model/catalog 管理器。
```

## Hermes

参考文件：

```text
hermes-agent/AGENTS.md
hermes-agent/docs/observability/README.md
hermes-agent/docs/security/network-egress-isolation.md
hermes-agent/docs/kanban/multi-gateway.md
hermes-agent/website/docs/user-guide/features/skills.md
hermes-agent/website/docs/user-guide/features/curator.md
hermes-agent/website/docs/user-guide/features/cron.md
hermes-agent/website/docs/developer-guide/cron-internals.md
hermes-agent/agent/conversation_loop.py
hermes-agent/tools/registry.py
hermes-agent/hermes_cli/plugins.py
hermes-agent/tools/approval.py
hermes-agent/hermes_cli/kanban_db.py
hermes-agent/tools/kanban_tools.py
hermes-agent/agent/curator.py
hermes-agent/tools/skill_manager_tool.py
hermes-agent/cron/scheduler.py
```

Hermes 的强点不是某个神奇 loop，而是“普通 LLM loop 周围的长期运行治理”。它的核心仍然是 messages -> LLM -> tool_calls -> tool_results -> next messages，但外面包了输入修复、工具面治理、observer/action 分离、权限、真实安全边界说明、durable queue、gateway 并发、skill 生命周期、cron 隔离和恢复机制。

最值得学习的是三件事：

```text
第一，观察、阻断、改写、审批、采纳必须分层。上报问题不等于修改事实，修改事实不等于发布能力。
第二，长期运行必须有 durable state machine。任务、run、heartbeat、claim、reclaim、summary、metadata、failure limit 都是可恢复性的来源。
第三，自我维护要有 provenance、usage、archive、rollback、dry-run 和 report。自动演进不能靠模型一句“我优化了”。
```

对 feng 的启发：

```text
默认上报 skill 应默认是 observer，而不是 action；采纳要进入 grow 的显式候选流程。
调试模式需要稳定 correlation：grow 单元、hatch 产物版本、运行轮次、输入来源、动作、结果、失败原因、证据文件。
hatch contract 必须声明真实边界：文件、网络、命令、服务凭证、目标世界 API、素材目录、游戏状态读写权限。
grow/debug/feedback 回流需要 durable feedback unit，包含状态、证据、处理结果、重试和上游传播记录。
每次 grow attempt 应有输入快照、下一轮 message list、动作、结果、退出原因、summary、metadata、失败类型。
多层闭环最终可以沉淀为默认 skill，但这个 skill 必须有版本、来源、适用范围、变更记录、回滚、可禁用和审计。
定时调试或自动更新应是 fresh grow attempt，禁递归、限时、独立输出、可静默，而不是污染主 grow 单元的下一轮 message list。
skill 可以补充运行模式，但强约束必须落在 contract、工具权限和状态机里，不能放在一个可随便改的 prompt 文件里。
```

不能照搬的地方：

Hermes 偏平台化，能力面很宽。feng 不能照搬 gateway、kanban、skills hub、cron、profile、plugin ecosystem，否则会变成“被调研对象牵着走”的拼装产品。Hermes 的 board/task/session/source 是它的平台身份，不应该变成 feng 的用户心智。feng 的核心仍是 grow 单元、file-native 证据、hatch 产物和上游吸收边界。

5 轮深读后的修正：

```text
Hermes 最值得 feng 学的是长期运行工程治理：observer/action 分离、真实安全边界诚实声明、durable queue/state machine、skill 生命周期、cron 隔离和恢复机制。
Hermes 的 Kanban 提示 feng：多层回流需要 triage/candidate/accepted/rejected/upstream-proposed 这样的可审计状态，而不是下游一上报就污染上游。
Hermes 的 Curator 提示 feng：默认回流 skill 可以演进，但必须有 provenance、usage、pinned、archive、rollback、dry-run、report；自动维护范围越窄越可信。
Hermes 的 Cron 提示 feng：自动 grow/update 应该 fresh、限时、禁递归、独立输出、可静默；不能把自动任务写回普通对话或普通 grow 事实。
Hermes 的安全文档提示 feng：approval、redaction、file deny、上报过滤都不是 hard security boundary；hatch contract 必须诚实说清真实边界。
不能被 Hermes 带偏：feng 不是多入口网关、不是看板协作平台、不是 skills hub、不是 cron 平台、不是 provider/plugin 管理器。feng 只吸收这些机制背后的状态、边界、证据、生命周期原则。
```

## Shinsekai

参考文件：

```text
Shinsekai/README.md
Shinsekai/design.md
Shinsekai/main.py
Shinsekai/llm/llm_manager.py
Shinsekai/llm/template_generator.py
Shinsekai/core/runtime/workflow.py
Shinsekai/core/runtime/workers.py
Shinsekai/core/messaging/stream_parser.py
Shinsekai/core/messaging/dialog_tokens.py
Shinsekai/core/handlers/*
Shinsekai/sdk/*
Shinsekai/llm/tools/*
Shinsekai/frontend_bridge.py
Shinsekai/frontend_bridge_core/*
Shinsekai/ui/chat_ui/*
Shinsekai/frontend/src/*
Shinsekai/frontend/src-tauri/*
Shinsekai/tools/file_util.py
Shinsekai/test/*
```

Shinsekai 的强点是非常明确的领域锚点：它不是抽象 agent 平台，而是围绕 galgame、otome、RPG 角色演出，把角色、历史、表情、立绘、TTS、ASR、T2I、MCP 工具、插件和 UI 串成一个目标世界。

最值得学习的是“目标世界会决定 agent 的对外表现形态”。同样是 LLM，进入 Shinsekai 后就不只是聊天，而是角色演出系统的一部分。这说明 feng 的 hatch 不应该执着于导出 LLM loop，而应该从目标世界契约出发：游戏 boss 也许需要行为树，写小说 agent 也许需要章节工作流，音乐 agent 也许需要素材和结构生成流程。

对 feng 的启发：

```text
hatch 产物必须服务目标世界，而不是服务通用 agent 框架。
运行配置和创作资产应该本地可见，不能都藏在应用状态里。
插件可以扩展能力，但插件本身不是安全边界。
输出契约可以被扩展，但核心字段和优先级需要保护。
工作流可以是 DAG，但一次运行应该有清晰选中的 workflow，而不是自动混合一切。
```

不能照搬的地方：

Shinsekai 是强领域产品。feng 不能直接变成某个领域的角色系统，但应该学习它如何让抽象 LLM 能力被目标世界重新塑形。

5 轮深读后的修正：

```text
Shinsekai 最值得 feng 学的是“目标世界契约”：模型输出被塑造成 character_name/speech/sprite/effect/CHOICE/NARR/STAT/SCENE/BGM/CG 等舞台事件，并被 downstream handler 实际消费。feng 应抽象为目标世界事件契约，而不是复制角色字段。
Shinsekai 的模板不是普通 prompt，而是目标世界输出协议。feng 的 grow 应该能迭代出外界输入、处理逻辑、LLM/非 LLM loop、动作输出、调试上报和 DoD，而不是只优化提示词。
Shinsekai 的复杂度分层很清楚：设置中心处理 API/角色/背景/模板/插件/MCP，聊天主窗只负责演出。feng 可以学习“复杂度有归属”，但不能提前变成桌面控制台。
Shinsekai 的插件和工具系统说明扩展能力必须被宿主收束：插件不是安全边界，工具有 group/risk/search/timeout/cooldown，MCP 有 preview/reload/drop/close/prefix/timeout/lifecycle。feng 的默认回流 skill 也必须可审计、可禁用、可替换，而不是万能插件口。
Shinsekai 的 file/data 思想提醒 feng：本地资产、配置、历史、模板和日志要能找到；但 feng 更进一步，下一轮 message list、成长证据、反馈采纳结果也必须文件化。
Shinsekai 的导入导出和发布链路说明“可复制”需要运行条件、资产包、版本、依赖 profile、资源清单、诊断日志和测试 gate。feng hatch 包也要带运行契约和验证报告，而不只是复制目录。
Shinsekai 的测试重点是目标世界事件链路、bridge、runtime、资源包、导入导出和 UI projection。feng 的测试也应该围绕 grow/hatch/debug/file-native/feedback-route，而不是只测模型回复像不像。
不能被 Shinsekai 带偏：feng 不是 galgame 角色聊天系统、不是 TTS/T2I 聚合器、不是 React/PySide 设置中心、不是插件商店、不是 Tauri 发布工程。Shinsekai 只能作为“目标世界塑形、复杂度分层、资产可迁移、输出契约、交付诊断”的参考。
```

## AssistantAgent

参考文件：

```text
AssistantAgent/README_zh.md
AssistantAgent/README.md
AssistantAgent/ROADMAP.md
AssistantAgent/CHANGELOG.md
AssistantAgent/pom.xml
AssistantAgent/assistant-agent-common/
AssistantAgent/assistant-agent-core/
AssistantAgent/assistant-agent-extensions/
AssistantAgent/assistant-agent-prompt-builder/
AssistantAgent/assistant-agent-evaluation/
AssistantAgent/assistant-agent-management/
AssistantAgent/assistant-agent-autoconfigure/
AssistantAgent/assistant-agent-start/
```

AssistantAgent 的强点是企业框架化：它用 Code-as-Action 把模型行动转成 Python 函数，让函数在 GraalVM 中调用 Java 工具桥，再围绕这个执行核心叠加 Evaluation Graph、Prompt Contributor、Experience 披露/管理、Learning、Search、Reply、Dynamic HTTP/MCP、Trigger、OpenTelemetry 和管理后台。

它最值得学习的不是“它有很多模块”，而是三个底层原则：

```text
第一，工具面可以被编译成模型可写代码的 API 视图，同时运行时也要有同一套真实可调用工具 registry，二者必须一致。
第二，经验不是聊天记忆，而是带类型、披露策略、来源、置信度、工具关联、reference、asset、artifact、fast intent 的能力候选。
第三，对外能力需要契约化：search 是信息来源契约，reply 是输出渠道契约，dynamic tool 是外部动作契约，trigger 是运行时唤醒契约。
```

对 feng 的启发：

```text
hatch 产物可以是受限策略脚本、行为片段、命令、服务、目标世界组件或 LLM loop，不必固定成一种形态。
生成出来的行为片段必须有作用域、版本、来源、执行记录、工具调用轨迹和失败证据。
下一轮 message list 可以由评估结果、目标、材料、反馈、工具签名、已采纳 skill 和未解决问题共同编译；贡献源要有优先级、去重、来源记录和生效条件。
多层回流 skill 应把反馈分成候选卡、详情、证据引用、可执行产物和采纳状态；记录不等于采纳。
hatch contract 应声明调用方式、输入 schema、输出/event schema、外部动作边界、资源/鉴权 profile、日志和反馈路由。
hatch 包需要可预览、可导入、可导出、可检测冲突；package 内应区分 reference、asset/script/eval、metadata。
运行 trace、工具调用、失败、输出摘要、下一轮 message list 都应落成文件证据，而不是只进内存 state 或 telemetry。
```

5 轮深读后的修正：

```text
AssistantAgent 的 CodeAct 很强，但它不等于安全自治。HostAccess.ALL、tool bridge、动态工具和 HTTP/MCP 适配说明真正边界在工具 registry、权限、schema 和执行记录，而不是“用了沙箱”。
Evaluation + Prompt Contributor 的价值是条件贡献和证据驱动编译；但它是 Spring hook/state 体系，不是 file-native message compiler。
Experience 披露和工具可见面控制成熟；Learning 闭环不成熟，很多历史获取、工具记录、离线转换、repository search 仍是 TODO，测试也主要验证局部解析。
Search/Reply/Dynamic/Trigger 展示了对外能力契约，但这些模块的自然终态是企业集成平台。feng 不能以支持更多 connector 为核心价值。
Management console 和 skill package import/export 提醒 feng 可复制产物需要 references/assets/metadata、冲突策略、版本、哈希和导入预览；但 feng 不是经验 CRUD 后台。
README 和 ROADMAP 明确当前是“半集成框架”，后续走能力下沉、生产就绪、可视化配置、零代码接入。这条路线和 feng 的轻量 file-native 成长系统不是同一个产品方向。
配置样例和代码存在属性名漂移，说明 contract 不能只靠文档解释，必须可机器检查。
```

不能照搬的地方：

```text
不能把 feng 做成 Java/Spring AI 企业 agent 平台。
不能把 grow 变成 Experience/Learning/PromptContributor/Trigger 的拼装。
不能把“模型总结经验”当成上游 skill 自动吸收。
不能把 OpenAPI/MCP 动态工具转换包装成安全能力。
不能让用户为了 grow 一个行为先理解一堆 Spring properties、SPI、租户、渠道、知识库和管理后台。
```

## learn-claude-code

参考文件：

```text
learn-claude-code/README-zh.md
learn-claude-code/README.md
learn-claude-code/s01_agent_loop/ ... s20_comprehensive/
learn-claude-code/skills/*
learn-claude-code/tests/*
learn-claude-code/agents/s_full.py
```

learn-claude-code 的强点是把 Claude Code 类 coding agent 拆成一个小 loop 和一组逐步增强的 harness 机制。它的基本立场很明确：agency 来自模型，产品工程主要是在模型周围构建工具、知识、观察、行动接口、权限、上下文、任务、异步事件和外部能力接入。

最值得学习的不是某个单点功能，而是“机制很多，循环一个”的位置感：工具、权限、hooks、todo、subagent、skill、压缩、memory、system prompt、错误恢复、任务图、后台任务、cron、团队协议、自动认领、worktree、MCP 最终都挂回同一个 while loop 的不同阶段。复杂度没有被塞进一个神秘大脑，而是被放在可解释的 harness 层。

对 feng 的启发：

```text
grow loop 应该保持小而稳定；复杂度放在 file-native 状态、工具面、权限、反馈路由、验证、hatch contract、压缩和恢复机制上。
下一轮 message list 应该是编译产物，而不是临时拼接；它受目标、DoD、技能目录、记忆/反馈、外部工具、任务状态、通知、压缩结果和安全边界共同影响。
skill 应分层：目录/描述常驻，正文/引用/脚本按需进入当前轮；不能把所有知识一次性塞进上下文。
完整 transcript、工具结果、大输出、记忆、任务图、后台通知和协议消息可以都在文件中，但活跃上下文只保留当前轮需要的表示。
错误恢复、后台任务、cron、任务图让 grow 更能长期运行，但它们不是成长本身；成长仍要靠目标世界反馈、证据、验证和 hatch readiness。
文件 mailbox、request_id 协议、graceful shutdown、plan approval、worktree/隔离空间可以用于 grow/debug/hatch 之间的受控通信和候选版本审查。
外部工具接入需要命名空间、schema、权限 annotation、认证、配置来源、错误分类和生命周期；文本标注或 mock handler 不能当安全边界。
```

5 轮深读后的修正：

```text
这个仓库是高质量教学样本，不是生产框架。s19 MCP 是 mock，测试主要是旧版 agents 编译检查和一个后台占位结果测试，不能证明多 agent、worktree、MCP、cron、permission、error recovery 的生产正确性。
TodoWrite 是计划工具，不是成长证据。Task System 是持久任务图，也不是能力成熟证明。feng 必须把任务状态和 DoD、验证、hatch readiness 绑定。
Subagent 和 team 能提供上下文隔离与并行协作，但也容易把 feng 带成多 agent 编排器。feng 应优先学习隔离边界、协议和证据回传，不学习团队产品心智。
Memory 自动提取、skill loading、context compact 都说明“文件事实”和“模型可见表示”必须分开。file-native 不等于所有内容都进入 message list。
Background notification、cron queue、inbox message 都是外部事件入口，必须经过反馈过滤和采纳边界，不能无脑进入上游 grow。
Worktree 适合 coding 场景；feng 概念层应抽象为隔离候选运行空间，不能把 git worktree 作为所有目标世界的默认前提。
README 的“造好 harness，模型会完成剩下的”对普通 agent 产品有启发，但对 feng 不够。feng 还必须定义成长目标、证据、版本、回滚、反馈采纳和可复制 contract。
```

不能照搬的地方：

```text
不能把 feng 做成 Claude Code 复刻：bash、read/write、todo、task、subagent、team、worktree、MCP 全都有，但没有“智能行为成长”的产品语义。
不能把 s20 的综合 harness 当 feng 终态。feng 的终态不是功能堆满，而是 grow/hatch/debug/feedback/file-native 的可信闭环。
不能用教学测试替代可用性证明。feng 的测试应围绕 grow/hatch/debug/file-native/feedback-route，而不是只测脚本能编译。
不能把外部工具生态作为核心价值，否则 feng 会变成 MCP/plugin 平台。
不能把“agency 来自模型”推导成“feng 不需要定义成长证据”。模型负责推理，feng 必须负责可追踪、可验证、可复制。
```

## 对 feng 的直接设计压力

这轮调研让 feng 的几个要求更清楚：

```text
feng 必须 file native，不能把成长状态藏在会话和内存里。
下一轮 message list 必须是可检查文件。
grow 的产物应该先是候选、证据和 contract 变化，不是直接发布能力。
hatch 的结果可以不是 LLM loop，但必须带运行契约、观测和反馈路由。
反馈上报必须有过滤、归因、证据和版本边界，不能无脑向上游吸收。
默认 skill 应该存在，但 skill 自身也要有可演进和可审计边界。
自我演进需要 dogfooding、回滚和小步合并，否则不可相信。
```

## 需要避免的误区

```text
把 feng 做成“万能 agent creator”。
把 grow 简化成聊天或 prompt 累积。
把 hatch 简化成复制一段聊天历史。
把 file native 理解成无节制记录所有垃圾。
把反馈回流理解成下游问题自动升级为上游需求。
把自我演进理解成 agent 可以随便改自己。
把多运行形态理解成无限模板市场。
```

## 当前判断

feng 的机会不是做一个更复杂的 agent 平台，而是做一个“智能行为成长系统”：用户用简单入口不断提供目标、材料、运行结果和反馈，feng 把这些变成可文件化追踪、可验证、可 hatch、可回流的行为资产。

产品可以简单，但内部必须严肃。真正能支撑“有一天它说成了”的，不是神秘感，而是文件化状态、证据、契约、反馈路由和可回滚版本。

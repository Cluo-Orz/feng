# Agent 调研轮次记录

本文用于追踪调研是否满足进入 feng 设计阶段的最低门槛。

要求：

```text
每个仓库至少 5 轮：看代码 -> 记笔记 -> 写小结 -> 再看代码。
所有仓库完成前，不编写 feng 系统概要设计。
feng 设计前还需要 5 轮：复习学习结果 -> 看草稿 -> 反思 -> 写新草稿。
本次调研必须防止 feng 变成“被调研对象牵着走”的拼装产品。
```

这意味着每轮调研都要同时做两件事：学习优秀 agent 的真实设计能力，也要反向审查这些设计是否会把 feng 带偏。外部项目的机制只能作为证据和启发，不能直接变成 feng 的产品结论。

## 仓库轮次状态

| 仓库 | 第 0 轮预读 | 第 1 轮 | 第 2 轮 | 第 3 轮 | 第 4 轮 | 第 5 轮 |
| --- | --- | --- | --- | --- | --- | --- |
| CodeWhale | 已完成 | 已完成 | 已完成 | 已完成 | 已完成 | 已完成 |
| opencode | 已完成 | 已完成 | 已完成 | 已完成 | 已完成 | 已完成 |
| hermes-agent | 已完成 | 已完成 | 已完成 | 已完成 | 已完成 | 已完成 |
| Shinsekai | 已完成 | 已完成 | 已完成 | 已完成 | 已完成 | 已完成 |
| AssistantAgent | 已完成 | 已完成 | 已完成 | 已完成 | 已完成 | 已完成 |
| learn-claude-code | 已完成 | 已完成 | 已完成 | 已完成 | 已完成 | 已完成 |

## feng 设计前复习状态

| 轮次 | 状态 | 产物 |
| --- | --- | --- |
| 第 1 轮 | 已完成 | docs/feng-design-prep-rounds.md：草稿 v1 |
| 第 2 轮 | 已完成 | docs/feng-design-prep-rounds.md：草稿 v2 |
| 第 3 轮 | 已完成 | docs/feng-design-prep-rounds.md：草稿 v3 |
| 第 4 轮 | 已完成 | docs/feng-design-prep-rounds.md：草稿 v4 |
| 第 5 轮 | 已完成 | docs/feng-design-prep-rounds.md：草稿 v5 |

## 轮次记录模板

```text
### 仓库 / 第 N 轮

看代码：
- 

记笔记：
- 

写小结：
- 

再看代码：
- 

下一轮问题：
- 
```

## CodeWhale / 第 1 轮

看代码：

```text
CodeWhale/crates/core/src/lib.rs
CodeWhale/crates/state/src/lib.rs
CodeWhale/crates/tools/src/lib.rs
CodeWhale/crates/protocol/src/lib.rs
```

记笔记：

```text
core 将 Runtime 组织为 config、model_registry、thread_manager、tool_registry、mcp_manager、exec_policy、hooks、jobs。
state 使用 SQLite 管 threads/messages/checkpoints/jobs/dynamic_tools，并额外维护 append-only session_index.jsonl。
messages 不是简单线性列表，而是通过 parent_entry_id/current_leaf_id 形成可分叉树。
append_message 在事务中读取 current_leaf_id、插入 message、更新 current_leaf_id。
JobManager 记录 queued/running/paused/completed/failed/cancelled、progress、retry、history，并持久化 detail。
tools 有 ToolCapability、ApprovalRequirement、ToolError、ToolSpec、ToolRegistry、dispatch，以及 parallel/serial execution lock。
protocol 将 EventFrame、ToolCallStart/Result、ExecApprovalRequest、ToolOutput 等都结构化。
```

写小结：

CodeWhale 的优势是把“agent 正在发生什么”变成强类型状态，而不是让 UI 或聊天历史承担事实来源。它的可信度来自多层记录：message 树、checkpoint、job history、tool lifecycle event、approval event、dynamic tool state。

feng 能学的原则：

```text
成长状态需要明确父状态，不能只有最新结果。
工具结果、失败和审批不是旁路日志，而是成长证据。
每次状态变迁应该能被回放或至少能被审计。
后台任务必须有生命周期、重试和历史，而不是一条“正在处理”文案。
```

如果照搬会带偏 feng：

```text
CodeWhale 的 thread/session 是 coding agent 协作心智；feng 已明确没有独立 session 心智。
feng 的 grow 单元下只有一个连续成长空间，不应该让用户管理多个 session/fork。
message tree 对 feng 有启发，但不能直接变成产品表面的“会话分叉”功能。
```

再看代码：

回看 `state/src/lib.rs` 的 `append_message`、`list_messages`、`fork_at_message`，确认它的分叉能力依赖 current_leaf_id 和 parent_entry_id。这个机制很强，但产品含义是“会话树”；feng 只能吸收“父状态可追踪”这个底层原则。

下一轮问题：

```text
CodeWhale 的真实 LLM loop 在哪里组装 message list？
它如何处理大工具输出、artifact 和上下文压缩？
它的 hooks/receipts 如何避免泄漏 raw CoT 或私密状态？
```

## CodeWhale / 第 2 轮

看代码：

```text
CodeWhale/crates/tui/src/core/engine/turn_loop.rs
CodeWhale/crates/tui/src/core/engine/context.rs
CodeWhale/crates/tui/src/artifacts.rs
CodeWhale/crates/tui/src/tool_output_receipts.rs
CodeWhale/crates/tui/src/tools/truncate.rs
CodeWhale/crates/tui/src/client/chat.rs
CodeWhale/docs/RECEIPTS.md
CodeWhale/docs/TOOL_SURFACE.md
```

记笔记：

```text
turn_loop 每轮先刷新 system prompt，检查 compaction/capacity，再构造 MessageRequest。
MessageRequest.messages 来自 messages_with_turn_metadata；该函数直接 clone session.messages，避免请求时重写历史破坏 prefix cache。
工具执行成功后，会先 compact_tool_result_for_context，再把压缩后的 ToolResult 写入 session.messages。
大工具输出会写 session artifact，并在 transcript 中留下 artifact ref 和 retrieve_tool_result 指令。
保存/恢复历史时，tool_output_receipts 会把超大原始 ToolResult 替换成 TOOL_OUTPUT_RECEIPT。
receipt 文档强调本地只读、保守构造、不导出 raw chain-of-thought、不从 UI 文本推断缺失证据。
```

写小结：

CodeWhale 对“模型下一轮应该看到什么”做了分层：完整事实在 artifact/持久记录里，活跃上下文里是摘要或引用，审计时再用 receipt 读取结构化证据。它没有把“保存一切”误解成“把一切塞进上下文”。

feng 能学的原则：

```text
file native 不等于所有文件都进入下一轮 message list。
下一轮 message list 应该是从文件化成长状态编译出来的当前表示。
原始证据、上下文摘要、审计 receipt 应该分层。
大对象必须能被引用和按需取回，否则 context 会被日志污染。
编译 message list 时不能偷偷改写历史语义，否则可复现性和缓存稳定性都会被破坏。
```

如果照搬会带偏 feng：

```text
CodeWhale 的 message list 是 session.messages；feng 的 message list 应该属于 grow 单元。
CodeWhale 的 artifact 主要服务会话转录和工具输出；feng 的 artifact 应该服务成长证据、候选能力、验证和 hatch。
CodeWhale 的 receipt 是 turn receipt；feng 更需要 grow-step/grow-unit receipt。
```

再看代码：

回看 `turn_loop.rs` 的请求构造和工具结果写回，确认模型下一轮输入来自已维护的 `session.messages`，而工具结果进入上下文前已被压缩。回看 `tool_output_receipts.rs`，确认持久化阶段会把大结果替换成 receipt，而不是把原始大输出长期留在活跃历史里。

下一轮问题：

```text
CodeWhale 的权限、审批、沙箱和安全策略如何进入工具执行路径？
哪些安全判断是可配置策略，哪些是运行时硬边界？
feng 的 grow/hatch 边界是否需要类似“审批事件也是成长证据”的机制？
```

## CodeWhale / 第 3 轮

看代码：

```text
CodeWhale/docs/SANDBOX.md
CodeWhale/crates/execpolicy/src/lib.rs
CodeWhale/crates/tui/src/core/engine/approval.rs
CodeWhale/crates/tui/src/network_policy.rs
CodeWhale/crates/tui/src/child_env.rs
CodeWhale/crates/secrets/src/lib.rs
```

记笔记：

```text
SANDBOX.md 明确列出每个平台 sandbox 能防什么、不能防什么。
ExecPolicyEngine 有 RulesetLayer：BuiltinDefault、Agent、User，并用 deny-wins、trusted prefix、typed ask rule、approval mode 共同决策。
AskForApproval 包含 UnlessTrusted、OnFailure、OnRequest、Reject、Never。
ExecApprovalRequirement 分为 Skip、NeedsApproval、Forbidden，并带 reason、policy amendment、network policy amendment。
approval.rs 让 agent loop 在需要工具审批或用户输入时阻塞等待，取消和超时都有明确错误。
network_policy.rs 用 allow/deny/default/prompt 和 audit log 管 outbound host，且 deny 优先。
child_env.rs 默认清空环境，只把 allowlist 环境变量传给子进程；MCP 有更宽但仍受限的 env allowlist。
secrets crate 将密钥存储抽象为 keyring/file/in-memory，强调 secret store 优先和 env fallback。
```

写小结：

CodeWhale 的安全设计有两个好点。第一，它不把“审批”当 UI 弹窗，而是当运行策略的一部分。第二，它不假装 sandbox 全能，而是公开边界和缺口。这让用户能理解风险，也让运行时能把“需要审批/被拒绝/越界失败”作为结构化事件。

feng 能学的原则：

```text
grow/hatch 的边界也必须是产物：权限、网络、文件范围、密钥、外部动作都应被记录。
审批不是阻碍成长，而是高风险成长材料进入真实世界前的闸门。
被拒绝和越界失败是有价值的反馈，但不能自动变成“下次绕过限制”。
默认运行环境应该少传密钥；hatch 包不能继承开发机环境。
安全文档必须说清不能防什么，不能用 agent 能力包装不确定性。
```

如果照搬会带偏 feng：

```text
CodeWhale 的 execpolicy 主要面向 shell/coding agent；feng 的边界要面向目标世界。
游戏 boss 的边界是帧内状态读取、行为输出、延迟和可复现；小说 agent 的边界是素材、风格、版权和发布动作。
feng 不应一开始复制复杂审批模式，而应该要求每个 hatch 包带最小可理解边界。
```

再看代码：

回看 `ExecPolicyEngine::check`，确认规则顺序是 deny -> trusted -> typed ask -> approval mode。这个顺序对 feng 有启发：上报和吸收也应该有类似“硬拒绝优先、候选其次、人工确认最后”的分层，而不是把所有反馈都变成可吸收材料。

下一轮问题：

```text
CodeWhale 的 skill、memory、subagent 如何做上下文隔离和按需加载？
这些机制哪些适合 feng 默认 skill，哪些会把 feng 做成复杂 agent 平台？
```

## CodeWhale / 第 4 轮

看代码：

```text
CodeWhale/docs/SKILL_INVOCATION_DESIGN.md
CodeWhale/docs/MEMORY.md
CodeWhale/docs/SUBAGENTS.md
CodeWhale/crates/tui/src/commands/skills.rs
CodeWhale/crates/tui/src/tools/subagent/mod.rs
CodeWhale/crates/tui/src/core/capacity_memory.rs
```

记笔记：

```text
skill 设计把 `$skill-id` 作为明确的能力引用，不和 slash command 混用。
skill 解析强调 exact first、namespaced exact、fuzzy 只建议不自动选择、disabled 不激活。
skill 激活会把 body 注入为 active guidance，并计划支持 tool-surface narrowing。
memory 默认关闭，是 user-scoped Markdown，小于 100 KiB；明确不放 secrets、transient task state、conversation snippets、long instructions。
subagent 是后台 agent loop，有角色、fresh/fork context、并发上限、heartbeat、lifecycle、output contract。
subagent 输出固定为 SUMMARY/CHANGES/EVIDENCE/RISKS/BLOCKERS，父 agent 依赖 EVIDENCE 继续工作。
subagent 默认 fresh，fork_context 是显式选择；fork 要保持父 prefix 稳定并追加结构化 snapshot。
```

写小结：

CodeWhale 的 skill/memory/subagent 设计共同指向一个原则：不要把所有知识和任务都塞进一个活跃上下文。skill 是按需加载的指导，memory 是小而稳定的偏好，subagent 是隔离任务边界。

feng 能学的原则：

```text
默认反馈路由应该是 skill，而不是写死在所有 prompt 里的大段规则。
skill 需要可发现、可禁用、可改、可审计；不能隐式激活导致用户不知道哪条规则生效。
memory/notes/skill/grow-state 要分层：长期偏好、项目规则、成长证据、运行反馈不是一类东西。
如果未来引入子 agent，也必须有角色、生命周期、输出契约和上下文边界。
```

如果照搬会带偏 feng：

```text
CodeWhale 的 subagent 是 coding agent 协作增强；feng 不应该变成“多 agent creator/team manager”。
feng 可以用 skill 表达默认回流能力，但不要让用户面对复杂 skill invocation 语法作为核心体验。
memory 不能替代 grow；记住偏好不等于能力成长。
```

再看代码：

回看 `commands/skills.rs`，确认当前 skill 激活是把 skill body 放入下一次请求的 active guidance。回看 subagent 文档和代码，确认 subagent 的价值来自隔离和输出契约，而不是“开更多 agent 就更智能”。

下一轮问题：

```text
CodeWhale 如何处理自我改进、验证、发布和回滚？
它的 recursive self-improvement 为什么不等同于 agent 自己随便改自己？
```

## CodeWhale / 第 5 轮

看代码/文档：

```text
CodeWhale/docs/RECURSIVE_SELF_IMPROVEMENT.md
CodeWhale/docs/REVIEW_PIPELINE.md
CodeWhale/docs/RELEASE_CHECKLIST.md
CodeWhale/docs/TOOL_LIFECYCLE.md
CodeWhale/scripts/release/*
CodeWhale/scripts/verify_task.sh
```

记笔记：

```text
RECURSIVE_SELF_IMPROVEMENT 定义的是“100-to-1 model”：大量 agent 工作最后压成一个维护者可审查 artifact。
它明确不是 benchmark，也不是允许重写项目；要求只选一个小摩擦点，先说明目标，尽量复现，最小补丁，最小检查，完成一个补丁后停止。
明确禁止未经要求触碰产品方向、provider policy、telemetry、sponsorship、branding、auth、sandbox、publishing、release、global prompts。
REVIEW_PIPELINE 要求 CI gates、one concern per PR、link issue、rebase、nightly loop。
RELEASE_CHECKLIST 把发布变成 checklist：changelog、版本 pin、preflight、npm smoke、branch/PR、CI/review、tag/release、post-tag。
TOOL_LIFECYCLE 用 active/deferred/hidden-compatibility/deprecated/removed 管模型可见工具面，同时保留 replay。
```

写小结：

CodeWhale 对自我改进的高明之处，是把“agent 的大量探索”限制成“一个可审查的外部贡献形状”。它不信任 agent 自己给自己无限授权，而是要求目标窄、证据清、补丁小、验证明确、发布流程独立。

feng 能学的原则：

```text
grow 的自主性应该停在候选产物层，不能直接等同于发布。
上游吸收需要像 PR 一样有目标、证据、影响面、验证和回滚边界。
自我演进应该是 dogfooding 产生的小而可审查改进，而不是一轮大规模自我重写。
工具/skill/运行形态的演进需要生命周期，不能永久增加模型可见复杂度。
hatch 版本和 grow 候选要分离；发布包必须可验证、可复现、可回滚。
```

如果照搬会带偏 feng：

```text
CodeWhale 的贡献形状是开源 PR；feng 的贡献形状应该是 grow 候选、hatch candidate、feedback-route candidate 或 default skill patch。
CodeWhale 的工具生命周期面向 coding tool catalog；feng 需要的是 target runtime capability lifecycle。
feng 不应把“自我改进”包装成项目营销点，必须落到可文件化的改进候选和验证证据。
```

再看代码/文档：

回看 `RECURSIVE_SELF_IMPROVEMENT.md` 的工作规则，确认它要求一个补丁后停止。回看 `TOOL_LIFECYCLE.md`，确认优秀项目会主动缩小模型可见面，而不是不断堆工具名。这是 feng 防止变成拼装产品的关键证据。

下一轮问题：

```text
CodeWhale 已完成 5 轮。后续不再从 CodeWhale 直接推导 feng 设计，只把它作为状态、边界、证据、生命周期和自我改进治理的参考。
进入 opencode 5 轮时，重点验证 durable input、context epoch、plugin/service 边界是否能支持 feng 的 file-native grow 单元。
```

## opencode / 第 1 轮

看代码：

```text
opencode/specs/v2/session.md
opencode/specs/project.md
opencode/packages/core/src/session/input.ts
opencode/packages/core/src/session/runner/index.ts
opencode/packages/core/src/session/runner/llm.ts
opencode/packages/core/src/session/schema.ts
opencode/packages/core/src/session/store.ts
opencode/packages/core/src/session/run-coordinator.ts
opencode/packages/core/src/session/execution.ts
```

记笔记：

```text
session spec 把用户输入分成 prompt、steer、queue 三类 delivery 语义，而不是把所有输入直接塞进聊天历史。
SessionInput 先进入 durable inbox；prompt admission 支持幂等重试，相同 input id 返回已有 lifecycle receipt，冲突则失败。
输入在 Promoted 之前不进入模型可见历史；projector 在一个事件事务里写入 visible user message 并标记 inbox row promoted。
steer input 在下一次安全 provider-turn 边界提升；queue input 作为未来 activity FIFO 排队。
SessionRunner 从 session id 启动，按 location 解析 catalog、model、tool、filesystem，然后在 provider turn 前准备 context epoch、提升合格输入、加载历史、构造 LLM request。
runner 对每个 provider turn 调用一次 llm.stream(request)，工具调用先被持久记录，再执行本地工具；继续下一轮前会重新读取投影后的历史。
旧进程遗留的 running/pending tool 会被标记为 Tool execution interrupted，避免状态假装仍然可继续。
RunCoordinator 让同一个 session key 只有一条 active drain chain；run 是显式执行，wake 是可合并提示，interrupt 会停止本地 ownership chain 并压制旧 wake。
```

写小结：

opencode 的第一个关键价值，是把“用户说了一句话”和“模型下一轮可见内容”拆开。输入先被承认为 durable inbox 事实，再由运行循环在安全边界提升为模型可见消息。这比把对话记录当事实来源更稳，也更接近 feng 的 file-native 要求。

feng 能学的原则：

```text
grow 单元也需要类似 durable inbox 的准入层：用户材料、运行反馈、调试上报、外部观察不能一进来就污染下一轮 message list。
下一轮 message list 应该由 grow 单元的文件化状态编译出来，并能说明哪些输入被采纳、哪些仍在等待、哪些被拒绝。
同一个 grow 单元内只应有一个连续成长运行线；并发唤醒可以合并，但不能制造多个互相竞争的“成长会话”。
中断、失败、遗留工具状态都应该成为明确事实，不能被下一轮 grow 默默忽略。
```

如果照搬会带偏 feng：

```text
opencode 的 session API 是 coding agent 产品心智；feng 已明确没有面向用户的 session 概念。
feng 在一个 grow 单元下只有一个 session/连续成长空间，因此不能照搬多 session、thread list、session fork 这类表层形态。
prompt/steer/queue 的语义有启发，但不能直接变成 feng 的交互复杂度；feng 需要的是材料准入和成长节奏，而不是把用户训练成 session operator。
这一轮必须警惕：opencode 的优秀之处来自严密状态机，不等于 feng 应该变成 opencode 风格的拼装 coding agent。
```

再看代码：

回看 `session/input.ts` 和 `session/runner/llm.ts`，确认 input promotion 与 LLM request 构造之间有清晰边界：输入不是立即进入 messages，而是在运行循环中被提升、投影、再用于 provider request。这个原则适合 feng，但产品名词必须从 session 改写为 grow 单元。

下一轮问题：

```text
opencode 的 context epoch 和 system context 如何决定哪些系统信息进入下一轮 provider turn？
它如何处理上下文缺失、epoch 更新和 provider-turn 安全边界？
这些机制能否帮助 feng 表达“下一轮 message list 是文件化编译产物”，同时避免隐藏状态牵着 grow 走？
```

## opencode / 第 2 轮

看代码：

```text
opencode/packages/core/src/session/context-epoch.ts
opencode/packages/core/src/system-context/index.ts
opencode/packages/core/src/system-context/registry.ts
opencode/packages/core/src/system-context/builtins.ts
opencode/packages/core/src/instruction-context.ts
opencode/packages/core/src/skill/guidance.ts
opencode/packages/core/src/session/history.ts
opencode/packages/core/src/session/projector.ts
opencode/packages/core/src/session/runner/llm.ts
opencode/specs/v2/instructions.md
```

记笔记：

```text
SystemContext 把系统上下文建模为多个带 key、codec、load、baseline、update、removed 的 typed source。
source 返回 unavailable 时，不等于删除该来源；初始化会阻塞，replace 会等待，reconcile 会保留已准入 snapshot。
每个 source 都会生成 baseline 文本和 durable snapshot；后续通过 snapshot 比较 current value，输出 update 文本或触发 replacement。
SystemContextRegistry 只管理 contribution，并按 key 排序后 combine；重复 key 直接失败。
builtins 把 environment/date 作为 source；InstructionContext 把 AGENTS.md 作为 source，项目内已发现的 AGENTS.md 读不到时返回 unavailable。
SkillGuidance 也作为 system context source，只渲染可用 skill 的 name/description，而不是直接注入完整 skill body。
SessionContextEpoch 持久化 baseline、snapshot、baseline_seq、replacement_seq、revision；prepare 时决定 unchanged、updated、replacement ready 或 replacement blocked。
ContextUpdated 会作为 session event 投影成 system message；history 在给 runner 加载时只包含 baseline_seq 之后的 system messages，避免旧 baseline 和新 baseline 同时进入上下文。
runner 在真正调用 llm.stream 前检查当前 epoch revision 是否仍然匹配；不匹配则重建 prepared turn。
```

写小结：

opencode 的 context epoch 解决的是一个很容易被低估的问题：系统上下文不是“每轮随手再拼一次 prompt”，而是有来源、有快照、有更新语义、有不可用状态的特权输入。它把环境、日期、项目指令、skill guidance 这些内容纳入同一套可比较机制，避免上下文在运行中悄悄变化而没有事件证据。

feng 能学的原则：

```text
grow 单元的下一轮 message list 应该区分目标、材料、反馈、环境、skill guidance 等来源，每个来源都需要可追踪快照或引用。
上下文来源不可用时，应该显式阻塞、保留旧快照或产出缺失原因，不能静默构造一个看似完整的 message list。
skill guidance 可以先暴露 name/description 层，完整 skill 按需加载；这符合 feng 防止上下文被经验和工具堆满的需求。
系统上下文更新应该成为 grow 事件或成长证据，而不是隐藏在下一轮 prompt 里的无痕变化。
message list 编译需要 baseline/增量更新边界，避免新旧系统约束同时生效或互相污染。
```

如果照搬会带偏 feng：

```text
opencode 的 context epoch 仍然服务 session runner；feng 不应该把 baseline_seq、replacement_seq 这些实现名词暴露为产品概念。
AGENTS.md、环境、skill guidance 是 coding workspace 的来源组合；feng 的来源应该由 grow 单元的目标世界决定，例如游戏状态、调试上报、素材库、创作约束或运行契约。
如果 feng 直接复制“系统上下文 registry”，很容易变成插件和上下文 source 的拼装产品，被 opencode 的架构牵着走。
feng 需要学习的是“上下文来源可审计、可阻塞、可比较”，不是把所有外部项目的 context source 形态搬进来。
```

再看代码：

回看 `system-context/index.ts` 的 `initialize`、`reconcile`、`replace`，确认 unavailable 在初始化和 replacement 时会阻塞，而不是被当成空值。回看 `session/history.ts`，确认 runner 只读取 baseline_seq 之后的 system message，从而避免 baseline 重复进入模型上下文。

下一轮问题：

```text
opencode 如何处理完整历史、投影消息、事件顺序和 compaction？
它如何保证压缩只改变模型可见表示，而不丢失完整记录？
这对 feng 的 file-native grow state、下一轮 message list 和证据层分离有什么启发？
```

## opencode / 第 3 轮

看代码：

```text
opencode/packages/core/src/session/compaction.ts
opencode/packages/core/src/session/message.ts
opencode/packages/core/src/session/event.ts
opencode/packages/core/src/event.ts
opencode/packages/core/src/event/sql.ts
opencode/packages/core/src/session/projector.ts
opencode/packages/core/src/session/message-updater.ts
opencode/packages/core/src/session/history.ts
opencode/packages/core/src/session/runner/to-llm-message.ts
opencode/packages/core/src/session/runner/publish-llm-event.ts
opencode/packages/core/src/session/runner/llm.ts
```

记笔记：

```text
EventV2 为同步事件维护 aggregateID、seq、version，并在事务中执行 projector、commit hook、event_sequence 和 event 表写入。
replay 会校验 event type/version、aggregate、sequence、event id 和 data；replayAll 要求同一 aggregate 且 seq 连续。
SessionEvent 把 Delta 定义为 ephemeral；Text.Ended、Reasoning.Ended、Tool.Input.Ended 才是 replayable full-value boundary。
Tool.Progress 是可回放但有界的 running-tool state，注释明确不应该持久化每个 stdout/stderr chunk。
SessionProjector 把 durable event 投影为 SessionMessageTable，message row 用事件 seq 排序。
SessionMessageUpdater 把 Step/Text/Reasoning/Tool/Shell/Compaction 事件转成投影消息；Started 建结构，Ended/Success/Failed 写完整值。
Compaction 不是删除旧事实，而是发布 Compaction.Ended，并投影成 summary + recent 的 compaction message。
SessionHistory.messageRows 会选择 latest compaction 后的历史，同时保留 baseline_seq 之后的 system update。
toLLMMessages 将投影消息降低为 provider message；compaction 以 conversation-checkpoint 形式进入用户消息，明确是 historical context，不是新指令。
publish-llm-event 先聚合 streaming fragment，再发布 replayable ended/success/failed 事件；未完成工具可被 failUnsettledTools 明确失败。
```

写小结：

opencode 的第 3 轮价值是“事实层”和“模型可见层”分离。事件是长期事实，投影消息是运行和 UI 可读状态，toLLMMessages 是 provider 请求表示，compaction 是活跃上下文优化。它没有让 stream delta、UI 文本或压缩摘要成为唯一真相。

feng 能学的原则：

```text
file native 必须分层：原始事件/证据、当前 grow 状态、下一轮 message list、上下文摘要不应该混成一种文件。
压缩只能改变下一轮模型可见表示，不能替代完整成长证据。
流式输出、调试心跳、工具 stdout 这类碎片可以用于观察，但长期事实应该落在 ended/success/failed/checkpoint 这样的边界。
每个 grow 单元需要稳定顺序，不能依赖文件修改时间或 UI 到达顺序判断先后。
message list 文件应该是从 grow 状态编译出来的请求表示，并能追溯到它使用了哪些事件、摘要和证据。
```

如果照搬会带偏 feng：

```text
opencode 的 event sourcing 和 projector 设计很完整，但它服务的是 session 协作和 coding-agent UI；feng 不一定需要一开始复制数据库级 event store。
feng 的 file-native 目标更强调“运行产物可找到、可检查、可复制”，不是必须把所有内部状态都做成 opencode 式 aggregate event stream。
如果把 compaction template、session message schema、provider message lowering 直接搬来，feng 会被 coding conversation 结构牵着走。
feng 应该学习“长期事实和活跃上下文分层”，而不是成为 opencode 的文件版复刻。
```

再看代码：

回看 `session/event.ts` 对 Delta 和 Ended 的区分，确认长期可回放边界不是每个流式片段。回看 `session/history.ts` 和 `runner/to-llm-message.ts`，确认 runner 看到的是 latest compaction 之后的活跃表示，而不是完整事件流本身。

下一轮问题：

```text
opencode 的 tool registry、permission、plugin boot 和 catalog 如何划分能力来源与作用域？
工具/skill/plugin 贡献如何避免影响 replay 或越权？
feng 的默认反馈路由 skill 和可演进工具边界，应该如何吸收这些原则而不变成插件平台？
```

## opencode / 第 4 轮

看代码/文档：

```text
opencode/packages/core/src/tool/registry.ts
opencode/packages/core/src/tool/builtins.ts
opencode/packages/core/src/tool/bash.ts
opencode/packages/core/src/tool/skill.ts
opencode/packages/core/src/tool/application-tools.ts
opencode/packages/core/src/permission.ts
opencode/packages/core/src/permission/schema.ts
opencode/packages/core/src/permission/saved.ts
opencode/packages/core/src/plugin.ts
opencode/packages/core/src/plugin/boot.ts
opencode/packages/core/src/catalog.ts
opencode/packages/core/src/state.ts
opencode/specs/v2/catalog-config-plugin-lifecycle.md
opencode/specs/v2/config.md
```

记笔记：

```text
ToolRegistry 用 State.create 管理 scoped transforms；location tools 拥有名字，application tools 只填未被占用的名字。
registry 在 settle 时负责输入 decode、authorize、execute、输出 encode、ToolOutput projection、outputPaths 和 ToolOutputStore bound。
每个工具可以保留自己的 authorize/execute/outputPaths；registry 只绑定统一 invocation 和 assertPermission。
BashTool 描述直接说明它使用宿主用户的 filesystem/process/network authority；外部目录、命令审批、输出截断都在工具边界中处理。
SkillTool 先等 PluginBoot 完成，再只按 available skills list 里的名字加载完整 skill；加载 skill 也需要权限审批，输出仍会截断并可落 outputPath。
PermissionV2 的核心规则是 allow/deny/ask；agent 缺失权限时默认 deny；saved permission 只按 project 保存 allow。
Permission reply=reject 会拒绝同 session 待处理请求；reply=always 会写 PermissionSaved 并尝试释放同项目内已被新规则允许的 pending 请求。
PluginV2 的 hook spec 很窄，当前包括 catalog.transform、account.switched、aisdk.language、aisdk.sdk；plugin add 会替换同 id 旧 scope，remove 会 close scope。
Catalog 使用 replayable transform，按 active transforms 重建 provider/model catalog，再应用 policy；plugin.added 事件会触发 location scoped transform。
config.md 不是把旧配置无脑搬迁，而是大量标记 remove/redesign，例如 command、tools、legacy permissions alias、batch_tool 等。
```

写小结：

opencode 在扩展机制上有两个值得学习的克制。第一，扩展不是无限开放，而是挂在很窄的 hook、registry、transform 和 permission 边界上。第二，配置迁移不追求“什么都兼容”，而是明确删除会制造歧义或重复抽象的旧入口。这对 feng 很重要：grow 可以修改 skill、tool、反馈路由和 hatch 形态，但不能因此把 feng 变成插件市场或 agent creator。

feng 能学的原则：

```text
默认反馈路由 skill 应该是 scoped、可替换、可审计的贡献，而不是写死在所有 prompt 里的隐式规则。
工具/skill 的成长要有生命周期和作用域；关闭或替换后应能重建当前有效能力面。
每个工具必须暴露真实权限边界、输入输出约束、截断/落盘策略和审批点。
权限规则要和目标 agent/目标世界绑定；game boss、小说 agent、音乐 agent 的权限不是同一种资源空间。
配置、skill、工具和策略应避免别名泛滥；如果一个旧入口会造成歧义，应该删除或重设计，而不是为了“强大”继续保留。
```

如果照搬会带偏 feng：

```text
opencode 的 plugin/catalog/provider/model 系统服务的是 coding agent 的供应商生态；feng 不应该把核心概念做成 provider/model/plugin 管理器。
feng 的可演进 skill 不等于通用插件平台。默认上报 skill 可以被改，但必须保留审计、过滤、版本和上游吸收边界。
PermissionV2 的 allow/deny/ask 语义可学，但资源命名不能照搬 shell/tool/action；feng 要从目标世界定义权限资源。
如果 feng 直接复制 tool registry + catalog transform + plugin hook，会很快变成“被调研对象牵着走”的拼装产品。
```

再看代码：

回看 `state.ts`，确认 scoped transform 的价值是可重建、可撤销，而不是随意动态变更。回看 `tool/bash.ts` 和 `tool/skill.ts`，确认优秀工具会清楚说明自己的真实权力、权限检查和输出落盘策略。回看 `config.md`，确认优秀项目也会主动删除历史复杂度。

下一轮问题：

```text
opencode 的 provider/model/request/schema 版本治理如何处理外部模型差异？
它如何把 provider 特有能力和 replay/schema 兼容边界拆开？
这对 feng 的 hatch contract、grow 文件版本和目标 agent 对外能力契约有什么启发？
```

## opencode / 第 5 轮

看代码/文档：

```text
opencode/packages/core/src/model-request.ts
opencode/packages/core/src/provider.ts
opencode/packages/core/src/model.ts
opencode/packages/core/src/session/runner/model.ts
opencode/packages/llm/src/llm.ts
opencode/packages/llm/src/schema/messages.ts
opencode/packages/llm/src/schema/events.ts
opencode/packages/llm/src/provider.ts
opencode/specs/v2/provider-policy.md
opencode/specs/v2/provider-model.md
opencode/specs/v2/schema-changelog.md
```

记笔记：

```text
ModelRequest 将 request 分成 headers、body、generation、options，并把常见 AI SDK 选项归一化为 generation/options/body。
ProviderV2.Info 区分 provider id/name/enabled/env/api/request；enabled 记录可用来源，例如 env/account/custom，而不是简单 boolean。
ModelV2.Info 记录 capabilities、variants、cost、status、limit、enabled、request、api；model id 只在 provider 内唯一。
SessionRunnerModel 先等待 PluginBoot，再从 Catalog 解析模型；没有显式模型时只在 supported route 中选择 default/available，否则明确失败。
fromCatalogModel 只支持很窄的 API surface：OpenAI、Anthropic、OpenAI-compatible with explicit URL；UnsupportedApiError 显式失败。
withVariant 会把 variant request overlay 合并进 model request；withDefaults 将 model request 降到 route defaults。
LLMRequest 是 provider-independent canonical request：system、messages、tools、toolChoice、generation、providerOptions、http、responseFormat、cache、metadata。
LLM schema 明确区分 SystemPart、Message.system、tool call/result、reasoning、media、providerMetadata、native escape hatch。
ToolOutput.toResultValue 不猜测未 materialized 的 URL/file source，而是返回 error；provider lowering 不隐式泄漏本机文件路径。
provider-policy.md 强调 provider configuration 和 provider policy 分离：资源可配置、凭证有效，也可能被 policy 禁止使用。
schema-changelog.md 每条契约变化写 affected schema、change、reason、compatibility；事件版本不直接覆盖已有同步 payload。
```

写小结：

opencode 的第 5 轮价值是“外部差异不能污染核心 loop”。模型供应商、协议、请求选项、能力、成本、限制和兼容性都被放进明确 schema 和 resolver，而不是散落在 agent 推理过程里。遇到不支持的 provider route，它选择显式失败，而不是偷偷降级或猜测转换。

feng 能学的原则：

```text
hatch 产物必须有对外能力契约：输入、输出、权限、限制、运行形态、观测、反馈路由、版本和不支持项都要能被读到。
grow 文件和 hatch contract 需要 schema/version/changelog；契约变化必须说明影响范围、原因和兼容处理。
目标 agent 的能力变体可以存在，但应该是明确 overlay，而不是让 grow 随意改 prompt 后假装同一能力仍然兼容。
外部世界能力和策略要分离：能连接某个系统，不等于允许使用；有材料，不等于允许吸收；能 hatch，不等于允许发布。
不要猜测未 materialized 的资源。文件、URL、游戏状态、素材引用、模型输出都需要明确来源和可用边界。
```

如果照搬会带偏 feng：

```text
opencode 的 provider/model/request schema 面向 LLM 供应商生态；feng 的 hatch contract 面向目标世界，不一定是模型 catalog。
feng 不应该把自身设计成“模型/provider 管理器”；这些机制只能启发 contract、capability、variant、policy、schema changelog。
LLMRequest 的 canonical schema 很好，但 feng hatch 的结果可能不是 LLM loop，不能强迫所有目标 agent 都降成 messages/tools/providerOptions。
如果把 provider policy 直接套到 feng，会把目标世界权限误缩成 provider.use；feng 需要的是 world-specific policy。
```

再看代码：

回看 `session/runner/model.ts`，确认 unsupported route 会显式失败；回看 `llm/src/schema/messages.ts`，确认 provider-independent request 与 providerMetadata/native escape hatch 分离；回看 `schema-changelog.md`，确认优秀项目会记录契约变化原因和兼容性，而不是靠代码读者猜。

下一轮问题：

```text
opencode 已完成 5 轮。后续只把它作为 input admission、context epoch、history/compaction、scoped tool/plugin、schema governance 的参考。
进入 Hermes 5 轮时，重点验证 observability、network egress、multi-gateway 和 observer/action 分离。
同时继续保持调研纪律：不能让 feng 被 opencode 的 session、provider catalog 或 coding-agent UI 牵着走。
```

## hermes-agent / 第 1 轮

看代码/文档：

```text
hermes-agent/AGENTS.md
hermes-agent/run_agent.py
hermes-agent/model_tools.py
hermes-agent/toolsets.py
hermes-agent/hermes_state.py
hermes-agent/agent/conversation_loop.py
hermes-agent/agent/tool_executor.py
hermes-agent/agent/agent_init.py
hermes-agent/tools/registry.py
```

记笔记：

```text
AGENTS.md 明确把 run_agent.py、model_tools.py、toolsets.py、hermes_state.py、agent/、tools/、gateway/、plugins/、skills/ 当作承重入口。
run_agent.AIAgent 现在大量转发到 agent_init、conversation_loop、tool_executor，说明项目在从巨型类中拆出运行脊柱，同时保留兼容入口。
conversation_loop 的核心仍是普通 LLM loop：准备 messages/system prompt -> API call -> assistant tool_calls -> 执行工具 -> tool results -> 下一轮，直到文本响应、预算耗尽、错误或中断。
Hermes 的复杂度主要包在护栏里：iteration budget、interrupt、prompt cache 稳定性、message alternation 修复、tool call 参数修复、empty response recovery、context compression、turn_exit_reason。
系统 prompt 被恢复或构建后尽量逐字节复用；临时 memory/plugin context 注入 user message 或 API-call-time context，避免破坏 prompt cache 前缀。
工具定义由 toolsets -> registry -> model_tools 组装；enabled/disabled toolsets 最后做减法，check_fn 会过滤不可用工具，动态 schema 会根据真实可用能力重建。
Tool Search 不是让模型无限调用所有插件，而是在 deferrable 工具过大时把 MCP/plugin 工具折叠到 tool_search/tool_describe/tool_call 后面，并且 tool_call 会解包成真实工具名再进入审批和 hook。
tools/registry.py 用自注册、generation、check_fn TTL、override 审计、拒绝 shadowing、deregister 来维护工具面。
handle_function_call 的主分发链路包括 tool_search bridge、pre_tool_call block hook、编辑审批、read-loop tracker、observability context、registry.dispatch、post_tool_call、transform_tool_result。
hermes_state.py 用 SQLite 存 session/message 元数据，WAL 支持多读单写，网络文件系统上降级 DELETE；FTS5/trigram 支持搜索，parent_session_id 支持压缩后拆分链路。
messages 表有 observed、active、tool_calls、reasoning、platform_message_id 等字段；sessions 表有 source、handoff_state、parent_session_id、token/cost 等字段，明显服务多入口平台。
```

写小结：

Hermes 的第 1 轮价值不是一个新的 agent 范式，而是“普通 LLM loop 被厚工程护栏包住后，才适合长期运行在多入口真实环境里”。它把模型调用、工具面、状态库、压缩、缓存、权限和可观测性都放在明确链路上，但核心还是 messages/tool_calls/tool_results 的循环。

feng 能学的原则：

```text
grow 单元也需要清晰运行脊柱：输入准入、下一轮 message list、模型请求、行动/工具结果、证据、压缩、退出原因、下一步状态。
file native 不等于排斥数据库或索引；但数据库只能是加速层或投影层，关键状态和下一轮 message list 仍要能被用户在文件里找到。
临时上下文和持久成长事实要分开。调试上报、外部记忆、插件观测可以影响某次请求，但不能悄悄污染 grow 单元的长期事实。
工具可用面必须按目标和权限收缩；动态工具搜索可以学，但要保留“先发现、再描述、再解包、再审批、再执行”的边界。
系统 prompt 或核心规则如果频繁变动，会破坏缓存和可解释性。feng 的 grow 可以改变能力，但每次改变都应落成可审计的版本和原因。
退出原因、预算、失败恢复、压缩触发点都应该成为成长证据，而不是只在日志里一闪而过。
```

如果照搬会带偏 feng：

```text
Hermes 是综合平台：CLI、gateway、Telegram/Discord、kanban、curator、cron、browser、computer_use、webhook safe toolsets 都围绕“全功能 agent 平台”展开。
feng 如果复制 Hermes 的外围，会迅速变成被调研对象牵着走的拼装产品，而不是智能行为成长系统。
Hermes 的 session DB、source tagging、handoff_state 服务多平台会话管理；feng 已明确没有面向用户的 session 概念，不能把 session 产品心智搬过来。
Hermes 的 huge toolsets 证明“工具很多”会制造治理负担；feng 应该学习 scope 和护栏，不应该追求默认全能。
Tool Search 的 progressive disclosure 可学，但不能把 feng 做成插件市场或工具目录产品。
```

再看代码：

回看 `agent/conversation_loop.py` 的 while loop 和 tool-call branch，确认 Hermes 的核心循环并不神秘，复杂度来自长期运行护栏。回看 `model_tools.py` 的 Tool Search bridge 和 `tools/registry.py` 的 shadowing 拒绝，确认优秀项目会主动压缩和保护模型可见能力面，而不是把所有工具直接暴露给模型。回看 `hermes_state.py` 的 WAL/FTS/parent_session_id，确认状态工程服务平台并发和搜索，但不能直接等同于 feng 的 file-native 真相层。

下一轮问题：

```text
Hermes 的 observability/plugin hook 如何区分只观察的 post_tool_call 和会改变结果的 transform_tool_result？
pre_tool_call 的阻断权、post_tool_call 的观察权、transform_tool_result 的改写权之间如何分层？
feng 的默认上报 skill、调试模式和多层反馈回流，应该如何学习这种 observer/action 分离，而不变成插件系统？
```

## hermes-agent / 第 2 轮

看代码/文档：

```text
hermes-agent/docs/observability/README.md
hermes-agent/hermes_cli/plugins.py
hermes-agent/hermes_cli/hooks.py
hermes-agent/tools/approval.py
hermes-agent/model_tools.py
hermes-agent/agent/conversation_loop.py
hermes-agent/tests/test_transform_tool_result_hook.py
hermes-agent/tests/test_transform_llm_output_hook.py
hermes-agent/tests/tools/test_approval_plugin_hooks.py
hermes-agent/tests/agent/test_shell_hooks.py
hermes-agent/tests/agent/test_shell_hooks_consent.py
```

记笔记：

```text
docs/observability/README.md 明确 observer hooks 是 read-only telemetry contract，用于 trace、metrics、audit、replay、export，不替代 planner、provider、memory、tool registry、approval UX 或执行语义。
每个 observer payload 注入 telemetry_schema_version = hermes.observer.v1，并使用 session_id、task_id、turn_id、api_request_id、tool_call_id 等显式关联字段。
pre_api_request/post_api_request/api_request_error 使用 sanitized request/response/error；昂贵 payload 构建被 has_hook 门控，避免无监听者时仍付出遥测成本。
pre_llm_call 可以注入 ephemeral context，但只注入当前 user message，不改 system prompt，且不持久化到 session DB。
pre_tool_call 可以返回 {"action":"block","message":"..."} 阻断工具；post_tool_call 是观察 hook，返回值被忽略；transform_tool_result 在 post_tool_call 之后运行，可以返回字符串替换工具结果。
transform_llm_output 在最终输出后运行，第一条非空字符串获胜；这是明确的行为改变 hook，不是普通观测。
approval hook 只有 pre_approval_request/post_approval_response，返回值被忽略；插件不能预答或否决审批。要阻止工具进入审批，必须用 pre_tool_call。
approval.py 用 contextvars 绑定 session_key、turn_id、tool_call_id，避免并发 gateway 路径依赖 process env。
shell hooks 通过独立 consent/allowlist 控制，第一次使用需要 TTY 同意或显式 accept；mtime 会记录，revoke 可移除。
tests 确认 post_tool_call 返回字符串不会替换结果，transform_tool_result 才能替换；插件异常 fail-open，不应破坏核心 loop 或审批流程。
```

写小结：

Hermes 的第 2 轮价值是“把观察权、阻断权、改写权、审批通知权拆开”。这不是表面插件系统，而是运行治理：谁只能看，谁能阻断，谁能改写，谁只能收到审批事件，谁需要用户同意执行 shell hook，都被放在不同入口和测试里。

feng 能学的原则：

```text
默认上报 skill 应默认是 observer，而不是 action。它可以记录、关联、汇总、导出，但不能自动改 grow 事实。
下游 hatch 产物回传的问题不能直接进入上游 grow；必须经过 intake/triage/adoption 这类“采纳动作”，并留下采纳或拒绝证据。
调试模式应输出稳定关联字段：grow 单元、目标产物版本、运行轮次、输入来源、动作、结果、失败原因、证据文件，而不是只发一段自然语言日志。
行为改变 hook 要比观察 hook 更少、更显式，并且应有 first-winner、版本、失败回退和审计记录。
临时上下文可以影响下一轮模型请求，但必须标注为 ephemeral，不能悄悄变成长期成长事实。
审批和安全事件可以被上报，但上报者不能绕过审批本身。
```

如果照搬会带偏 feng：

```text
Hermes 的 plugin system 面向通用扩展生态，包含工具、命令、LLM facade、平台、backend、exclusive provider 等；feng 不能因此变成插件平台。
pre_llm_call、transform_llm_output、transform_tool_result 这些兼容型行为 hook 如果无节制引入，会让 grow 的事实来源变得不可解释。
session_id/task_id/turn_id 是 Hermes 的会话/平台语义；feng 可以学习 correlation id，但不能重新引入面向用户的 session 心智。
shell hooks 对 feng 有启发，但如果过早开放，会把 file-native grow 变成“外部脚本可以随便改状态”的不可审计系统。
```

再看代码：

回看 `model_tools.handle_function_call`，确认 block、dispatch、post observer、transform result 的顺序是固定的；回看 `plugins.invoke_hook`，确认 hook 异常被吞掉并记录，核心 loop fail-open；回看 `tools/approval.py`，确认 approval observer 不具备 veto 或 auto-answer 能力。

下一轮问题：

```text
Hermes 的 network egress、危险命令、文件写入和执行环境隔离如何构成安全地板？
它如何区分“可观察/可调用”和“允许真实影响外界”？
feng 的 hatch 产物面向游戏、小说、音乐、外部命令时，安全边界应如何先作为 contract，而不是 grow 后再补？
```

## hermes-agent / 第 3 轮

看代码/文档：

```text
hermes-agent/SECURITY.md
hermes-agent/docs/security/network-egress-isolation.md
hermes-agent/tools/approval.py
hermes-agent/tools/terminal_tool.py
hermes-agent/tools/file_tools.py
hermes-agent/agent/file_safety.py
```

记笔记：

```text
SECURITY.md 明确说：对抗性 LLM 的唯一安全边界是 OS-level isolation；approval gate、output redaction、pattern scanner、tool allowlist 都不是 containment。
terminal-backend isolation 只约束 shell/file-tool 路径，不约束 agent Python 进程内的插件、hooks、skills、MCP、code-execution child。
whole-process wrapping 才把 shell、code-execution、MCP、file tools、plugins、hooks、skills 一起纳入文件、网络、进程、推理策略。
network-egress-isolation 文档把 internal network、egress network、egress proxy 和 allowlisted hosts 分开，目标是防 prompt injection 借 curl/wget/raw HTTP 外传。
approval.py 有 hardline floor：rm 根目录、mkfs、raw block device、fork bomb、kill -1、shutdown/reboot 等在 yolo/approvals.off/cron approve 之前无条件阻断。
YOLO mode 在 import 时冻结，避免 skill 在运行中改 env 变量绕过审批。
check_all_command_guards 合并 tirith 和 dangerous command 检查，避免一次 force replay 只绕过其中一个；gateway/ask 会阻塞等待用户，timeout/deny 都明确要求不要重试或换命令实现同结果。
execute_code 因为能直接调用 subprocess/os.system/ctypes/file API，在 gateway/ask 路径走整段脚本 one-shot approval；文档明确本地非交互路径是 trusted-by-config 的限制。
terminal_tool 的 env_type 支持 local/docker/singularity/modal/daytona/ssh；容器/云沙盒路径跳过某些 host dangerous-command 检查，因为它们的破坏半径不同。
terminal_tool 校验 workdir 字符、foreground timeout、background notify，输出会 redaction，但这仍是显示层减错。
file_tools 对 /etc、/boot、docker.sock、Hermes config 等写入做 hard refuse；file_safety 对 auth.json、.env、mcp-tokens、项目 .env 做 read deny，但反复声明不是 security boundary。
cross-profile write guard 和 sandbox-mirror write guard 也被标注为 soft guard：减少混淆、留下审计，不假装能阻止同 OS 用户的终端绕过。
```

写小结：

Hermes 的第 3 轮价值是“安全声明很诚实”。它没有把模式匹配、审批和红action包装成真正隔离，而是明确区分：什么是 OS 边界，什么是减错层，什么是用户同意，什么是部署者必须配置的 egress/network/policy。

feng 能学的原则：

```text
hatch contract 必须声明真实影响外界的边界：文件范围、网络范围、命令范围、服务凭证、游戏引擎 API、素材目录、设备/进程权限。
grow 过程也要在 contract 内运行；不能等 hatch 后再补安全说明。
“默认上报 skill”不是安全边界，只是过滤和准入机制；上游吸收仍需要证据、权限和审计。
file native 不能导致秘密文件、凭证、外部系统状态被无脑落盘；哪些内容可落盘、可摘要、可索引、可上报要分开。
危险操作需要分级：不可恢复操作直接拒绝，可恢复但有风险的操作请求同意，普通操作记录证据。
如果目标世界是游戏 boss，边界可能是读游戏状态、返回动作；如果是小说 agent，边界可能是读写稿件目录；如果是音乐 agent，边界可能是素材库和生成服务。安全资源命名必须来自目标世界，而不是照搬 shell 权限。
```

如果照搬会带偏 feng：

```text
Hermes 的审批系统服务个人 coding/general agent；feng 不能把所有目标世界权限都降成 dangerous shell command patterns。
Hermes 的安全模型默认单租户个人 agent；feng 如果未来 hatch 产物进入游戏运行时、创作流水线或多人环境，不能默认继承这个信任 envelope。
redaction、file deny、approval、上报过滤如果写进 feng 概念时说得太绝对，会制造错误安全感。
network egress proxy 是部署方案，不是 feng 产品核心；feng 应该吸收“egress 是 contract 的一部分”，不应该变成容器网络配置工具。
```

再看代码：

回看 `SECURITY.md` §2.2，确认 Hermes 只把 OS-level isolation 当真正边界。回看 `approval.py` 的 hardline floor 和 gateway deny 文案，确认“拒绝后不得换命令实现同结果”是模型可见的行动约束。回看 `file_safety.py`，确认防护文案主动承认可被 terminal 绕过，避免把软 guard 写成硬安全。

下一轮问题：

```text
Hermes 的 multi-gateway、kanban、handoff 和后台任务如何把长期运行拆成可恢复工作单元？
它如何避免多入口并发时状态乱写、审批错路由或任务丢失？
feng 的 grow/hatch/debug 自动更新循环，应该学习哪些“任务/状态/交接”原则，而不复制 Hermes 的平台调度器？
```

## hermes-agent / 第 4 轮

看代码/文档：

```text
hermes-agent/docs/kanban/multi-gateway.md
hermes-agent/website/docs/user-guide/features/kanban.md
hermes-agent/website/docs/developer-guide/gateway-internals.md
hermes-agent/website/docs/user-guide/multi-profile-gateways.md
hermes-agent/AGENTS.md
hermes-agent/hermes_cli/kanban_db.py
hermes-agent/tools/kanban_tools.py
hermes-agent/hermes_cli/kanban_swarm.py
hermes-agent/tests/stress/test_property_fuzzing.py
hermes-agent/tests/stress/test_concurrency_parent_gate.py
hermes-agent/tests/hermes_cli/test_session_handoff.py
hermes-agent/tests/hermes_cli/test_signal_handler_kanban_worker.py
```

记笔记：

```text
Kanban 的核心不是看板 UI，而是 durable queue + state machine + worker identity。文档明确：每个 task 是 row，每次 handoff 是 row，每个 worker 是有自己 identity 的 OS process。
board 是硬隔离边界：独立 SQLite DB、workspaces、attachments、logs；tenant 只是软 namespace。dispatcher spawn worker 时注入 HERMES_KANBAN_DB、HERMES_KANBAN_WORKSPACES_ROOT、HERMES_KANBAN_BOARD，防止 worker 误读其他 board。
多 gateway 部署中只有一个 gateway 负责 kanban dispatcher/notifier。原因不是产品体验，而是避免多个 gateway 同时打开每个 board DB 造成 WAL reader contention。
tasks 有 triage/todo/ready/running/blocked/review/done/archived 等状态，task_runs 记录每次 attempt：claim_lock、worker_pid、heartbeat、outcome、summary、metadata。
claim_task 用 BEGIN IMMEDIATE + status/claim_lock CAS 做 ready -> running；同时在 claim gate 重新验证父任务完成，发现 racy ready 会降回 todo 并记录 claim_rejected。
release_stale_claims 不粗暴回收所有 TTL 过期任务：host-local PID 活着且 heartbeat 未过旧时延长 claim；PID 活着但长时间无 heartbeat 才回收，避免慢模型单轮调用被误杀。
complete_task/block_task 不只是改状态，还关闭 run、写 task_events、保留 summary/metadata。never-claimed 的人工 complete/block 会合成 zero-duration run，避免 handoff 信息丢失。
completion 的 created_cards 会被验证；虚构 task id 会阻断 completion 并写 completion_blocked_hallucination，summary 里的疑似 phantom references 会作为 advisory event 记录。
dispatch_once 每 tick 做 reclaim、stale heartbeat 检测、crash 检测、timeout、recompute_ready、claim、spawn，并用 global/per-profile concurrency cap、respawn guard、failure_limit 防止无限 thrash。
tools/kanban_tools.py 将 worker 工具面和 orchestrator 工具面分开。dispatcher-spawned worker 只能 mutate 自己的 task lifecycle，不能 destructive mutate foreign task；需要跨任务信息时用 comment/create handoff。
auto heartbeat bridge 把 agent runtime activity 映射成 board heartbeat，rate-limited 且 best-effort；模型不必每次都显式调用 heartbeat，但长期运行仍有可观测 liveness。
kanban_swarm 是 Kanban 上的一层 topology/blackboard，不是第二个 scheduler；root/worker/verifier/synthesizer 都仍然落在 task_comments/task_events。
gateway 有两层 active session guard：base adapter 先 queue/interrupt，gateway runner 再处理 /stop、/new、/queue、/status、/approve、/deny 等 bypass command。session key 有单一 builder，不能手写。
handoff 测试把 CLI -> gateway 交接建模为 pending -> running -> completed/failed；claim_handoff first wins，失败原因截断保存，handoff 命令只在 CLI 发起、gateway 不暴露。
压力测试和 property fuzzing 约束 current_run_id/run/event/claim_lock/status/parent dependency 等不变量，说明 Hermes 的长期运行能力来自状态正确性，而不是“多 agent 很聪明”。
```

写小结：

Hermes 的第 4 轮价值是“长期运行的工作单元必须可恢复”。它把任务、运行尝试、事件、心跳、失败、重试、人工干预、交接摘要都放进状态机，而不是把后台 agent 当作一次长对话。Kanban 的优秀点不是 board 本身，而是状态迁移足够明确，所以崩溃、超时、慢模型、多人入口、人工补救都能被重新接住。

feng 能学的原则：

```text
grow/debug/feedback 回流需要 durable feedback unit：来源、目标产物版本、状态、证据、处理人/处理者、采纳结果、拒绝原因、重试记录都应能找到。
下游 hatch 产物上报的问题不能直接污染上游 grow；应先进入 triage/candidate/accepted/rejected/upstream-proposed 这类可审计状态。
每次 grow 运行尝试都应有 run/attempt 证据：输入快照、下一轮 message list、动作、结果、退出原因、summary、metadata、失败类型。
自动更新不能只靠“再跑一次”。需要 heartbeat/liveness、stale/reclaim、failure limit、人工 block/unblock 这类恢复语义。
调试模式应该允许目标产物回报结构化事件，但回报只是 observer 事实；是否被采纳是另一个显式动作。
handoff summary 很适合 feng 的多层闭环：xiaoshuo 给 feng 上报时，应传的是结构化 handoff，而不是无限聊天记录。
对 game boss 这类运行体，心跳/帧结果/异常/约束违反应该成为 grow 可读事件；但 boss 本身不需要知道 feng 的全部成长历史。
```

如果照搬会带偏 feng：

```text
Hermes Kanban 是多 profile agent fleet 的协作平台；feng 不是看板、不是队列产品、不是多 gateway 管理器。
board/task/session/source 这些是 Hermes 的平台身份，不应该变成 feng 的用户心智。feng 的核心心智仍是 grow 单元与 hatch 产物。
如果把 Kanban 原样搬进 feng，会让 feng 变成被调研对象牵着走的拼装产品：表面拥有任务、看板、dispatcher、gateway，实际偏离“智能行为成长”。
feng 可以吸收 durable queue/state machine 的原则，但 file-native 要求决定了关键状态、下一轮 message list、上报与采纳证据必须以用户可找到的文件形式存在；数据库最多是索引或投影。
Hermes 的 multi-gateway 解决消息平台并发，feng 的多层闭环解决能力演进和上游吸收，两者不是同一个产品问题。
```

再看代码：

回看 `kanban_db.py` 的 `claim_task`、`release_stale_claims`、`complete_task`、`dispatch_once`、`_default_spawn`，确认 durable queue 的关键是 CAS、run/event、heartbeat、failure limit 和 worker env pinning。回看 `kanban_tools.py` 的 gating 和 ownership check，确认 worker 工具面被刻意收缩。回看 `test_property_fuzzing.py`、`test_concurrency_parent_gate.py`、`test_session_handoff.py`，确认这些不是文档愿景，而是被不变量和并发测试约束的运行契约。

下一轮问题：

```text
Hermes 的 skills、curator、cron/self-maintenance 如何管理长期知识和技能生命周期？
它如何避免 skill 无限膨胀、过期知识继续影响运行、计划任务污染普通 session？
feng 的多层闭环最终要沉淀成默认 skill，但这个 skill 如何被版本化、修剪、审计和自我改进，而不演化成插件市场？
```

## hermes-agent / 第 5 轮

看代码/文档：

```text
hermes-agent/website/docs/user-guide/features/skills.md
hermes-agent/website/docs/user-guide/features/curator.md
hermes-agent/website/docs/user-guide/features/cron.md
hermes-agent/website/docs/developer-guide/creating-skills.md
hermes-agent/website/docs/developer-guide/cron-internals.md
hermes-agent/AGENTS.md
hermes-agent/agent/curator.py
hermes-agent/agent/curator_backup.py
hermes-agent/tools/skill_usage.py
hermes-agent/tools/skill_provenance.py
hermes-agent/tools/skill_manager_tool.py
hermes-agent/tools/skills_tool.py
hermes-agent/agent/skill_commands.py
hermes-agent/agent/skill_preprocessing.py
hermes-agent/cron/scheduler.py
hermes-agent/cron/jobs.py
hermes-agent/tools/cronjob_tools.py
hermes-agent/skills/devops/kanban-worker/SKILL.md
hermes-agent/skills/devops/kanban-orchestrator/SKILL.md
hermes-agent/tests/agent/test_curator.py
hermes-agent/tests/agent/test_curator_backup.py
hermes-agent/tests/agent/test_curator_classification.py
```

记笔记：

```text
Hermes skills 是 on-demand knowledge document，不是工具代码本身。Progressive disclosure 分为 skills_list 元数据、skill_view 全文、skill_view 支持文件，避免把全部知识塞进系统提示。
SKILL.md 有 frontmatter、platforms、requires_toolsets/fallback_for_toolsets、required_environment_variables、required_credential_files、metadata.hermes.config。skill 可以携带 scripts/references/templates/assets，但按需加载。
技能通过 slash command 注入为 user message 或 bundle message，不直接修改 system prompt；AGENTS.md 强调会改变 system prompt 状态的命令要 cache-aware，默认下轮生效。
skills_tool 对 platform/environment 做显示层过滤；required env 在本地安全提示，不在 gateway 聊天里收集 secret；声明的 env 才自动 passthrough 到 terminal/execute_code sandbox。
skill_preprocessing 支持 ${HERMES_SKILL_DIR}/${HERMES_SESSION_ID} 和可选 inline shell；inline shell 默认关闭，有 timeout/output cap，失败返回标记而不是破坏加载。
skill_manage 是 agent 的 procedural memory 工具，但 create/delete 需要确认用户，patch 是首选。支持 create/patch/edit/delete/write_file/remove_file，支持文件只能落在 references/templates/scripts/assets，防 path traversal，写入原子化。
skill_manage 只有 background_review origin 创建的 skill 才 mark_agent_created；普通前台 agent 创建的 skill 被视为 user-directed，不进入自动 curator 管辖。
skill_usage 用 ~/.hermes/skills/.usage.json 做 sidecar telemetry：use/view/patch count、last_activity、state、pinned、created_by。Telemetry 记录所有 skill，但自动 curator 只处理显式 eligible 的 skill。
curator 是 inactivity-triggered，不是 cron daemon。首次观察只 seed last_run_at，不立即运行；必须 interval_hours 过期且 idle 足够，避免更新后马上改用户技能库。
curator 自动阶段 deterministic：active -> stale -> archived，pinned 跳过；archive 是可恢复移动到 .archive，不自动 delete。
curator LLM review 是 forked AIAgent，skip_context_files/skip_memory，禁用 recursive nudge，走 auxiliary.curator 模型槽；dry-run 明确禁止 skill_manage mutation 和文件改动。
curator_backup 每次真实 pass 前 snapshot skills tree，排除 .hub 和 .curator_backups，包含 .usage.json/.archive/.curator_state/.bundled_manifest/.curator_suppressed，并备份 cron/jobs.json 的 skill links。
rollback 会先做 pre-rollback snapshot，拒绝 unsafe tarball，恢复 skills tree，同时只恢复 cron jobs 的 skills/skill 字段，不碰 schedule/next_run_at/prompt 等活状态。
curator classification 测试区分 consolidated 与 pruned；absorbed_into 是 delete 的权威声明，避免模型或启发式把“合并吸收”误判成“丢弃剪枝”。
cron jobs 用 jobs.json 原子存储，state 有 scheduled/paused/completed/running；tick 有跨进程文件锁，并在执行前 advance next_run_at 保持 at-most-once 语义。
cron job 每次新建 fresh AIAgent session，禁用 cronjob/messaging/clarify，默认 skip_memory，输出不 mirror 到 gateway 主 session，避免污染普通对话和 message alternation。
cron 支持 skill-backed job：按序加载 skill，bump_use，prompt 最后作为指令。runtime 会扫描 assembled prompt；带 skill 的 assembled prompt 用较窄注入规则，避免安全文档误触发。
cron no_agent 模式允许纯脚本 watchdog，无 LLM；wakeAgent=false 和 [SILENT] 都是显式静默协议。
cron profile/workdir job 会触碰 process-global env/cwd，因此被分到 persistent single-thread sequential pool；普通 job 进 parallel pool，并用 running_job_ids 防重复提交。
kanban-worker/orchestrator skill 表明：某类运行体可以自动加载通用模式库，但强生命周期约束仍在 KANBAN_GUIDANCE/system contract 和 kanban tools 中，skill 是深化细节，不是唯一约束来源。
```

写小结：

Hermes 的第 5 轮价值是“长期知识和自动任务都必须有生命周期”。它不把 skill 当成无限增长的 prompt 仓库，而是用 progressive disclosure、usage sidecar、provenance、pinned、archive、rollback、dry-run、report 来管理。Cron 也不是把主对话定时唤醒，而是 fresh session、禁递归、锁、输出文件、独立交付和显式静默协议。

feng 能学的原则：

```text
feng 的默认回流 skill 可以存在，但它必须有版本、来源、适用范围、变更记录、回滚和可禁用机制；不能变成隐藏的全局 prompt。
多层闭环的 skill 应该是“按需加载的过程知识 + 采纳/拒绝规则”，不是每次 grow 都无条件注入完整历史。
skill 自我演进要区分 foreground user-directed 与 background self-improvement；只有后者才适合进入自动维护域。
上游吸收下游问题时必须区分 consolidated/absorbed、pruned/rejected、pending、accepted；不能让模型一句“已吸收”替代证据。
真实 mutating pass 之前要有 snapshot；dry-run/report 模式要能 preview 将要修改什么。
如果 grow/hatch 引入定时调试或自动更新，它应该运行在 fresh grow attempt 中，禁递归、限时、独立输出、可静默，而不是污染主 grow 单元下一轮 message list。
自动加载给 hatch 产物的通用 skill 只能补充操作模式，强约束仍应落在 hatch contract、工具权限和运行边界里。
file native 下，usage、provenance、reports、rollback、cron-like outputs 都应是用户能找到的文件；数据库或 cache 只能加速。
```

如果照搬会带偏 feng：

```text
Hermes Skills Hub、optional skills、external directories、bundles、curator、cron 是一个成熟平台生态；feng 不应该把产品目标转成“管理一堆技能和定时任务”。
skill 不应该替代 grow/hatch 的核心状态机。若把所有规则都放进可随便改的 skill，feng 的边界会被自身演进绕开。
cron 是 schedule automation；feng 的 grow 自动更新不是泛化 cron 平台。能学 fresh session/lock/recursion guard/output，不应复制 delivery platform 和 scheduler UI。
curator 能修剪 skill，但它仍服务 Hermes 的个人 agent 使用场景；feng 的回流 skill 要围绕“能力演进是否应该上游吸收”，不是围绕技能市场清理。
如果照搬 Hermes 的 skill ecosystem，feng 会变成被调研对象牵着走的拼装产品：有 hub、cron、curator、kanban、gateway，却不一定更接近智能行为成长。
```

再看代码：

回看 `skill_manager_tool.py` 的 telemetry 段，确认只有 `is_background_review()` 的 create 才 mark_agent_created；前台 create 不被 curator 自动管理。回看 `curator.py` 的 `run_curator_review` 和 dry-run banner，确认真实 pass 前 snapshot、dry-run 不 mutation。回看 `curator_backup.py` 和相关测试，确认 rollback 会保护 skills tree 和 cron skill links。回看 `cron/scheduler.py` 的 prompt build、run_job、tick，确认 cron run 是 fresh session、禁递归、锁和输出文件组合，而不是主会话延长。

下一轮问题：

```text
hermes-agent 已完成 5 轮。后续只把它作为长期运行治理、observer/action 分离、安全边界诚实声明、durable queue、skill 生命周期、自动任务隔离的参考。
进入 Shinsekai 5 轮时，重点看“目标世界如何塑造 agent 表现形态”：角色、剧情、工作流、插件、历史、媒体资产、输出契约。
继续保持反向审计：Shinsekai 是强领域角色系统，feng 只能学目标世界契约，不能被带成 galgame/角色聊天产品。
```

## Shinsekai / 第 1 轮

看代码/文档：

```text
Shinsekai/README.md
Shinsekai/design.md
Shinsekai/main.py
Shinsekai/config/schema.py
Shinsekai/config/config_manager.py
Shinsekai/config/character_manager.py
Shinsekai/llm/llm_manager.py
Shinsekai/llm/compact_manager.py
Shinsekai/llm/history_manager.py
Shinsekai/core/sprite/chat_history.py
Shinsekai/core/runtime/workflow.py
Shinsekai/core/runtime/workers.py
Shinsekai/core/runtime/app_runtime.py
Shinsekai/sdk/graph.py
Shinsekai/sdk/messages.py
Shinsekai/core/messaging/stream_parser.py
Shinsekai/core/messaging/dialog_tokens.py
Shinsekai/assets/system/workflow/default.yaml
Shinsekai/assets/system/workflow/headless.yaml
```

记笔记：

```text
Shinsekai 的产品身份非常清楚：面向 Galgame / 乙女 / 剧情向 RPG 的桌面助手，不是泛 agent 平台。它先固定目标世界，再把 LLM、TTS、ASR、T2I、角色、立绘、背景、历史、工具、MCP 和 UI 都装进这个世界。
README 把双窗分工说得很明确：React 设置中心管 API、角色、背景、模板、小工具、插件与 MCP；聊天主窗专注对白与演出。复杂配置不挤进演出主流程。
data/ 下保存 api.yaml、system_config.yaml、characters.yaml、background.yaml、角色资源和历史，普通创作者能备份、迁移、修改；这不是严格 file-native 运行证据，但有“本地可见资产”的产品心智。
schema.py 用 Pydantic 将角色、立绘、情绪标签、语音、背景、BGM、API、TTS、ASR、T2I、系统设置结构化。领域对象不是泛 memory，而是目标世界所需资产。
ConfigManager 拆分保存 API、system、characters、background，读取后组合为 AppConfig；路径稳定且人可读。扩展配置按 llm/tts/asr/t2i 和 provider key 合并到 adapter factory。
CharacterManager 的 AI 设定生成只是辅助角色创作，生成后写入 characters.yaml；它不是让聊天历史自然沉淀成能力，而是把一次生成结果变成可见角色资产。
main.py 启动时从模板、历史、背景、BGM、API、TTS/T2I 配置组装运行时；frozen 环境会设置 EASYAI_PROJECT_ROOT 保持数据根。运行不是只有 LLM，而是目标世界资产 + 多媒体管线。
LLMManager 仍是标准 messages -> LLM -> tool_calls -> tool_results -> recursive next call。它处理 provider 差异、DeepSeek reasoning、Gemini tool extra、工具结果截断、孤立 tool call 修复、上下文 token 估算和自动压缩。
messages 存在内存里，历史可通过 JSON 文件保存/加载；自动压缩会把旧历史总结成 user summary message。对 feng 来说，这是“下一轮 message list 可见”的反例和提醒：如果只在内存里变换，用户难以知道下一轮到底吃了什么。
CompactManager 的优点是 deterministic trim fallback、tool call owner 保持、summary token 上限；弱点是压缩摘要可能成为新事实源，若没有原始证据层，长期成长会丢失可审计性。
Runtime workflow 是 Queue-based DAG。默认 YAML 是 llm_worker -> tts_worker -> ui_worker；headless 是 llm_worker -> tts_worker -> headless_sink。聊天的外部表现由运行管线决定，而不是由 prompt 单独决定。
sdk.messages 将 UserInputMessage、LLMDialogMessage、TTSOutputMessage 类型化；LLM 输出必须解析为 character_name/speech/sprite/effect 等对话片段，保留字包含 COT、NARR、CHOICE、STAT、SCENE、BGM、CG。
stream_parser 从流式文本里切 JSON 对象并立即交付下游，说明 Shinsekai 对模型输出有目标世界协议：不是自由回答，而是舞台系统能消费的对白/资源指令。
DagBuilder 拒绝 cycle、fan-out、fan-in，说明它偏线性演出管线，不是任意 agent 工作流编排。这个约束服务产品体验，也降低运行复杂度。
```

写小结：

Shinsekai 第 1 轮最重要的学习点是：优秀的 agent 产品不一定从“agent 能做什么”开始，而是从“目标世界需要什么表现形态”开始。Shinsekai 的 LLM 能力被重塑为角色演出：输入是用户对白，输出不是普通自然语言，而是角色名、台词、立绘编号、BGM/CG/选项等可被舞台消费的事件。

feng 能学的原则：

```text
hatch 产物不应该默认等于 LLM loop。目标世界可能要求命令、DAG、状态机、行为树、脚本、服务、LLM loop 或混合形态。
grow 的任务之一是明确目标世界契约：外界如何输入、产物如何处理、如何影响外界、哪些输出字段或事件可被宿主消费。
角色、背景、模板、历史这些在 Shinsekai 中都是本地可见资产；feng 的 grow/hatch/debug 也必须把关键状态、message list、证据和运行结果落成可找文件。
Shinsekai 的设置中心/聊天主窗分工提示 feng：创作者配置与终端运行体验应该分层。复杂性可以存在，但不能出现在目标产物的主要使用心智里。
LLM 输出协议必须被下游验证和解析。boss-agent 不能只“回答一段话”，它需要输出游戏引擎可消费的动作、状态或意图。
运行管线是能力的一部分。LLM -> TTS -> UI 在 Shinsekai 中定义了演出；未来 boss-agent 也可能是 perception -> decide -> action -> report，而不是单轮 chat。
```

如果照搬会带偏 feng：

```text
Shinsekai 是强领域角色演出产品。feng 不能变成 galgame 角色聊天框、模板编辑器、TTS/T2I 聚合器或插件 UI。
它的 messages/history 是应用历史，不是成长证据。feng 若照搬这一层，会把“能继续聊天”误当成“能力已成长”。
它的 DAG 目前是线性演出管线，不是通用可复制智能行为系统。feng 可以学习“运行形态可配置”，不能复制一个工作流编排产品。
它的 data/ 本地文件适合创作者备份，但不等于 feng 的 file-native。feng 还要求下一轮 message list、采纳/拒绝、debug 上报、证据和 hatch 契约都能作为文件找到。
如果被 Shinsekai 牵着走，feng 会把产品终态误判为“给各种 agent 做角色化前端和多媒体插件”，这会变成被调研对象牵着走的拼装产品。
```

再看代码：

回看 `main.py` 的启动组装，确认它先把角色模板、历史、背景、BGM、TTS/T2I、workflow 和 UI 管线组合好，再启动对话。回看 `default.yaml` 和 `headless.yaml`，确认输出形态由 DAG 末端决定：桌面模式输出到 UI，headless 输出到 sink。回看 `sdk/messages.py` 和 `dialog_tokens.py`，确认目标世界协议已经渗入消息结构，而不是只存在于 prompt 文案。

下一轮问题：

```text
Shinsekai 如何生成和使用聊天模板？角色、世界书、背景、情绪标签、系统保留字如何进入 prompt？
它如何处理会话历史、回溯、reroll、选项和舞台事件？
feng 能从“模板塑形”中学习什么，又如何避免把 grow 简化成 prompt/template generator？
```

## Shinsekai / 第 2 轮

看代码/文档：

```text
Shinsekai/llm/template_generator.py
Shinsekai/i18n/locales/zh_CN.json
Shinsekai/ui/settings_ui/services/chat_template_handlers.py
Shinsekai/ui/settings_ui/services/template_tab_session.py
Shinsekai/ui/settings_ui/tabs/template_tab.py
Shinsekai/core/handlers/tts_message_handler.py
Shinsekai/core/handlers/ui_message_handler.py
Shinsekai/core/handlers/handler_registry.py
Shinsekai/core/messaging/dialog_tokens.py
Shinsekai/core/messaging/stream_parser.py
Shinsekai/config/character_manager.py
Shinsekai/config/background_manager.py
Shinsekai/test/unit/test_output_contracts.py
Shinsekai/test/unit/test_stream_parser.py
Shinsekai/test/unit/test_dialog_tokens.py
Shinsekai/test/unit/test_chat_history.py
Shinsekai/test/unit/handlers/test_tts_handlers.py
```

记笔记：

```text
TemplateGenerator 是 Shinsekai 把 LLM 塑造成目标世界事件生成器的中心。它不是简单拼接角色设定，而是生成一份输出契约：JSON object -> dialog array -> character_name/sprite/speech/effect/translate 等字段。
模板先声明“RPG 剧情对话系统”，再列出出场人物、JSON 格式、立绘说明、角色设定、场景说明、BGM 说明、工具说明和 requirements。目标世界的信息是按演出消费顺序进入 prompt 的。
角色配置中的 emotion_tags 会直接进入“立绘说明”；character_setting 进入“角色说明”。这让模型根据台词语气选择 sprite，但选择仍是模型判断，不是验证器保证。
背景和 BGM 也以编号 + 标签文本进入模板，随后 SCENE/BGM 保留字通过 character_name 触发下游 handler。场景切换和音乐切换被编码成同一个 dialog 协议里的系统事件。
模板支持可选能力：effect、translate、COT、CHOICE、NARR、STAT、CG、max_speech_chars、max_dialog_items。功能开关会改变字段说明和 requirements，而不是在运行时凭空解释。
OutputContractPatch 允许插件改字段说明、添加字段、增删 requirement。test_output_contracts 证明新增 camera 字段会保留在 LLMDialogMessage.model_extra 中。这说明 Shinsekai 已把“输出契约可被扩展”做成一等概念。
模板把默认工具说明插入 system prompt，只列 default group，其他组用 search_tools 发现。这与第 1 轮看到的工具组 LRU 相连，避免工具面无限塞进 prompt。
chat_template_handlers 将用户情景 scenario 与系统模板 system 分节存盘，启动时 compose_for_llm 合成最终 prompt，写入 data/character_templates/_temp.txt，并用 _temp_split.json 保留分节元数据。
默认 history 文件名由 scenario 文本 hash 决定；模板页保存 last launch session 到 data/config/template_tab_last_launch.json。这个“场景文本决定历史文件”的心智很贴近剧情创作，但不适合 feng 的 grow 单元命名。
LLM 输出在 worker 中被 stream_parser 按完整 JSON 对象逐条切出，立刻放进 tts_queue；parser 对坏 JSON 会跳过并记录 parse_failures，而不是阻塞整个流。
历史恢复时 parse_assistant_dialog_content 解析 assistant content 中的 dialog array，并对 fenced JSON、字符串内控制字符、部分缺失引号做修复。测试承认有些结构缺失无法恢复。
TTS handler 链按 COT/System/BGM/CG/DefaultCharacter 路由。DefaultCharacter 会查角色、切 TTS 模型、按 sprite 取参考音频，最后发 TTSOutputMessage。
UI handler 链按 CHOICE/STAT/SCENE/BGM/CG/COT/SystemMisc/CharacterDialog 路由。保留字不只是文本标签，而是真正会触发选项、数值、背景、BGM、CG、忙碌栏、对白和立绘更新。
COT 在 UI 里只显示 busy bar 预览，不进入对白；但是模板要求 COT 内写“思维链”样内容，这种做法对公开产品有风险，也不适合 feng 作为默认能力证据。
handler_registry 采用 first matching handler；插件 handler 在前，内置 handler 在后。扩展能覆盖行为，但也提高了契约漂移风险。
角色/背景/BGM 的上传和标签维护都落在本地文件与 YAML 中。模型选择的是编号，真实图片/音频路径由 handler 从配置中解析。
```

写小结：

Shinsekai 第 2 轮的关键价值是“模板不是写作提示，而是目标世界输出协议”。模型被要求输出一组可被舞台系统消费的事件：角色台词、立绘编号、旁白、选项、数值、场景、BGM、CG。下游 handler 又把这些事件转成 UI/TTS/媒体动作，所以用户感受到的不是聊天，而是演出。

feng 能学的原则：

```text
hatch contract 要描述目标产物的输出协议，并说明每个字段/事件如何被宿主消费；不能只说“agent 会回答”。
grow 过程要形成“目标世界信息 -> 输出契约 -> 运行处理器 -> 证据”的链条。只有 prompt 没有 handler/validator，不足以说明能力可用。
输出契约可以被 skill 或插件扩展，但必须版本化、可审计、可测试。Shinsekai 的 OutputContractPatch 是很好的概念参考。
用户情景和系统契约应分层。feng 的 grow 单元也要区分用户创作目标、运行约束、输出协议和下一轮 message list。
目标世界事件要尽可能结构化。boss-agent 的动作、小说-agent 的章节段落、音乐-agent 的素材生成，都应有宿主可消费的事件或文件，而不是自由文本。
对模型格式遵守不能盲信。需要 parser、validator、失败显示、重试或降级策略；否则“看似 hatch 成功”会在真实宿主中随机失效。
```

如果照搬会带偏 feng：

```text
Shinsekai 的模板生成是 RPG/角色演出的专用 prompt factory。feng 不能把 grow 简化成 prompt/template generator。
COT/旁白/选项/数值/场景/BGM/CG 是 Shinsekai 的舞台协议，不是 feng 的通用协议。feng 应抽象出“目标世界事件契约”，而不是复制这些字段。
模板里的强命令不能等同于真实保证。feng 如果只把“要求模型严格输出 JSON”当成能力边界，会在调试、游戏引擎、自动更新中失去可信度。
插件可 patch 输出契约很灵活，但如果缺少采纳边界，feng 会变成各种输出字段和 handler 的拼装产品。
Shinsekai 的 history/session 与剧情场景绑定；feng 已明确没有独立 session 心智，不能复制历史文件 hash 场景作为产品表面。
```

再看代码：

回看 `template_generator.py` 的 requirements 组装，确认它把字段、保留字、角色资产、场景资产、工具说明和输出要求都写进同一份系统模板。回看 `tts_message_handler.py` 与 `ui_message_handler.py`，确认保留字会被下游实际消费。回看 `test_output_contracts.py`、`test_stream_parser.py` 和 `test_chat_history.py`，确认 Shinsekai 既扩展输出契约，也承认解析失败和修复边界。

下一轮问题：

```text
Shinsekai 的插件 SDK、工具注册、MCP 接入如何控制扩展边界？
插件如何贡献 adapter、工具、设置页、聊天栏、workflow 和 output contract patch？
feng 能学习哪些“目标世界扩展点”的治理原则，又如何避免变成插件市场或多媒体集成器？
```

## Shinsekai / 第 3 轮

看代码/文档：

```text
Shinsekai/docs/PLUGIN_DEVELOPER_GUIDE.md
Shinsekai/sdk/plugin.py
Shinsekai/sdk/register.py
Shinsekai/sdk/types.py
Shinsekai/sdk/manager.py
Shinsekai/sdk/plugin_host_context.py
Shinsekai/sdk/tool_registry.py
Shinsekai/core/plugins/plugin_host.py
Shinsekai/core/plugins/plugin_requirements_install.py
Shinsekai/core/plugins/registry_catalog.py
Shinsekai/core/plugins/registry_download.py
Shinsekai/core/plugins/github_bundle_update.py
Shinsekai/llm/tools/tool_manager.py
Shinsekai/llm/tools/tool_executor.py
Shinsekai/llm/tools/tool_search.py
Shinsekai/llm/tools/mcp_config_file.py
Shinsekai/llm/tools/mcp_tool_setup.py
Shinsekai/llm/tools/mcp_bridge.py
Shinsekai/llm/tools/character_tools.py
Shinsekai/llm/tools/memory_tools.py
Shinsekai/llm/tools/file_tools.py
Shinsekai/ui/settings_ui/tabs/plugin_mcp_tab.py
Shinsekai/test/unit/managers/test_tool_groups.py
Shinsekai/test/unit/managers/test_tool_executor.py
Shinsekai/test/unit/test_plugin_requirements_install.py
```

记笔记：

```text
插件文档第一句就明确：plugins 是普通 Python package，in-process 执行，不是 security boundary。这个诚实边界比“插件很安全”的误导更重要。
插件由 data/config/plugins.yaml 清单加载，manifest entry import 到 PluginBase subclass；实例化无构造参数，initialize(register, plugin_root, host) 按 priority 顺序执行。
PluginHostContext 是只读快照：ui_language、voice_language、font、theme、selected_llm_provider、tts_provider、live_room_id、project_data_dir。明确不给 API keys、base_url、ConfigManager、save API。
SettingsUI/Tools/Chat UI contribution 也只拿受限 context，避免把全局配置管理器直接交给第三方 UI。插件仍然 in-process，所以这是“减少误用面”，不是硬隔离。
PluginCapabilityRegistry 收集 LLM/TTS/ASR/T2I adapter、LLM tools、TTS/UI handlers、user input trigger/processor、settings/tools/frontend/chat UI、workflow、output contract patch。
PluginManager 把 discovery、instantiate、initialize、apply providers、collect contributions 分开。初始化结果集中进 capability registry，再由 host merge 到 factory/tool/handler 列表。
插件 workflow 是 selectable candidate，不自动 merge 到默认 workflow。register_dag_yaml 只是注册候选，不意味着扩展会偷偷改主运行管线。
OutputContractPatch 允许插件只调整默认 dialog contract 的字段和 requirement，而不替换整套 workflow；core fields character_name/speech/sprite 被保护。
插件管理 UI 支持发现插件、下载 GitHub zip、安装 requirements、维护 data/config/plugins.yaml、启用禁用、重启提示和下载状态。这是完整生态功能，但成本和风险都很高。
plugin_requirements_install 会处理 frozen release 的 plugin_site_packages、runtime python、torch wheel index、pip timeout/output tail。生态可用性背后是大量分发工程，不是概念层的小功能。
ToolRegistry 的 @tool 提供 name/description/group/risk。ToolManager 单例注册 function schema、group、risk，并支持同名覆盖和 MCP tool 注册。
LLMManager 初始只启用 default tool group；search_tools/list_tool_groups 作为 meta-tools 暴露，调用 search_tools 后再激活匹配 group，并受 max_active_tool_groups LRU 限制。
ToolExecutor 在 ToolManager 之上加 timeout、ToolNotReady/loading、group cooldown、risk confirm。medium/high 工具需要 risk_confirm，low 风险不打扰用户。
memory_tools 首次加载 mem0/embedding/vector store 会后台初始化，工具抛 ToolNotReady，宿主冷却并提示模型不要重复调用。这比阻塞聊天更适合重模型能力。
file_tools 的读类工具和写/移动/删除类工具都在 file group，写/复制/删除/移动标记 medium/high risk。但路径解析到 home 或 absolute，作用域比较宽；这对 feng 是警示。
MCP 配置在 data/config/mcp.yaml，支持 enabled、default_call_timeout、servers；server 支持 sse、streamable_http、stdio、headers/env、name_prefix、group、call_timeout。
MCP 注册用了专用 asyncio loop 和 owner task，解决长连接 close 与 anyio CancelScope 的任务归属问题。reload 时会 drop 已注册 MCP 工具、关闭 bridge、再注册。
MCP 工具注册时支持 name_prefix 防冲突，group 默认 mcp，可自定义；调用时用 registered_name 映射回 short name，并带 per-server timeout。
PluginMcpTab 提供 preview、save/apply、YAML 打开、JSON import，说明“外部能力接入”必须有可视化校验和重载入口，而不是只写配置文件。
```

写小结：

Shinsekai 第 3 轮的核心价值是“扩展能力必须被收束到宿主定义的边界里”。它不是把插件当成随意改内部状态的脚本，而是把可扩展面拆成 adapter、tool、handler、UI contribution、workflow candidate、output contract patch，并明确插件不是安全边界。工具侧又用 group/risk/search/timeout/cooldown 把模型可见行动面降下来。

feng 能学的原则：

```text
hatch 产物如果要接外部能力，必须把工具/接口列入能力契约：来源、作用域、风险、权限、超时、失败语义、是否可重载。
默认可见工具面应很小；其他能力通过搜索、激活或显式配置进入本轮。grow 不能把所有工具和资料无条件塞进下一轮 message list。
扩展点要分类：运行形态、输出契约、工具、宿主适配器、调试上报、UI/开发者辅助，不能混成一个“插件万能口”。
外部能力接入需要生命周期：加载、就绪、冷却、重载、关闭、错误报告。ToolNotReady + group cooldown 对 grow/debug 很有参考价值。
多层闭环的默认 skill 可以 patch 上报契约，但 patch 必须目标明确、可排序、可审计，核心字段/边界不能被随意删除。
对安全要诚实：in-process extension 不是 sandbox；approval/risk confirm 只是行动前确认，不是隔离。feng 的 hatch contract 也要这样表达。
```

如果照搬会带偏 feng：

```text
Shinsekai 的插件系统服务桌面多媒体角色产品。feng 不能复制成 plugin hub、MCP 管理器、adapter marketplace 或 GitHub 插件安装器。
插件 ecosystem 的工程成本很高，会把概念阶段拖进分发、依赖、UI、注册表和更新问题，偏离 grow/hatch 最小可信闭环。
如果 feng 让任意插件 patch 核心状态、下一轮 message list 或上游吸收规则，会破坏 file-native 可审计性和自我演进边界。
MCP 接入只是外部工具能力，不是产品终点。feng 的关键是“智能行为如何成长并可复制”，不是“能接多少工具”。
file_tools 的 home/absolute 路径范围提醒 feng：工具边界必须来自 grow 单元/hatch contract，而不是只靠风险等级和用户确认。
如果被 Shinsekai 牵着走，feng 会变成被调研对象牵着走的拼装产品：adapter、handler、MCP、插件商店都很热闹，但智能行为成长仍然没有证据闭环。
```

再看代码：

回看 `PLUGIN_DEVELOPER_GUIDE.md` 和 `plugin_host_context.py`，确认插件不拿 secrets 和全局 ConfigManager。回看 `tool_manager.py`、`tool_executor.py`、`llm_manager.py` 的 group/LRU/risk/cooldown 组合，确认默认行动面是被刻意收缩的。回看 `mcp_tool_setup.py` 和 `plugin_mcp_tab.py`，确认 MCP 不是“配置即可”，而有 preview、reload、drop、close、prefix、timeout、owner task 这些生命周期。

下一轮问题：

```text
Shinsekai 的 React/PySide 设置中心和聊天主窗如何组织创作者工作流？
它如何让复杂配置不压垮主要演出体验？
feng 能从“双窗分工、本地资产管理、调试反馈”中学什么，又如何避免提前进入 UI/桌面产品设计？
```

## Shinsekai / 第 4 轮

看代码/文档：

```text
Shinsekai/docs/GUI_USER_GUIDE_zh-CN.md
Shinsekai/webui_react.py
Shinsekai/frontend_bridge.py
Shinsekai/frontend_bridge_core/handler.py
Shinsekai/frontend_bridge_core/state.py
Shinsekai/frontend_bridge_core/templates.py
Shinsekai/frontend_bridge_core/characters.py
Shinsekai/frontend_bridge_core/chat.py
Shinsekai/frontend_bridge_core/tasks.py
Shinsekai/frontend_bridge_core/media_utils.py
Shinsekai/ui/chat_ui/chat_ui.py
Shinsekai/core/runtime/ui_update_manager.py
Shinsekai/sdk/chat_ui_context.py
Shinsekai/frontend/src/app/routes/AppRoutes.tsx
Shinsekai/frontend/src/shared/platform/httpPlatform.ts
Shinsekai/frontend/src/features/chat-launcher/ChatLauncherPage.tsx
Shinsekai/frontend/src/features/chat-stage/ChatStagePage.tsx
Shinsekai/frontend/src/features/chat-stage/chatState.ts
Shinsekai/frontend/src/entities/chat/repository.ts
Shinsekai/frontend/src/shared/ui/TaskProgress.tsx
Shinsekai/frontend/src/shared/desktop/RuntimeProgressPanel.tsx
```

记笔记：

```text
GUI 用户指南把产品心智拆成两个面：设置窗口负责 API、角色、立绘、背景、模板、插件；聊天窗口负责运行时演出。复杂配置没有消失，而是离开主要聊天体验。
新手流程是 API 设置 -> 角色导入/创建 -> 生成/保存模板 -> 启动聊天；这是创作者 workflow，而不是“打开一个聊天框就完事”。
webui_react.py 启动 React 构建产物，但 YAML、文件系统、插件加载、聊天进程启动仍由 Python bridge 掌握。前端是投影和请求层，不是业务真相层。
frontend_bridge.py 设置 SHINSEKAI_SOURCE_ROOT、SHINSEKAI_APP_ROOT、EASYAI_PROJECT_ROOT，并 chdir 到项目根。bridge 负责把运行根、项目根和发布根显式化。
BridgeState 集中持有 config/character/background/template managers、task store、template/history 目录、chat_session、plugin_load_status。它是进程状态和投影层，不等于完整 durable truth。
handler.py 暴露 config、characters、backgrounds、templates、logs、plugins、MCP、chat、media、tasks、tools 等 API。这个面很宽，说明桌面产品的开发者/创作者接口一旦展开会迅速变大。
templates.py 保持 scenario/system 分离，用 split meta 和 history hash 保存启动会话，说明创作者需要“场景材料”和“系统契约”分层，而不是只维护一坨 prompt。
characters.py 让角色保存、AI 生成、翻译、memory、sprite upload/delete、voice 操作都通过 bridge 校验和持久化，体现本地资产是产品事实。
chat.py 启动 main.py/main.exe 时会写 _temp template、保存 system_config、创建 history 文件、设置 env、记录 logs/main.log，并在失败时返回退出码、日志尾部和依赖缺失提示。运行不是黑盒。
chat.py 的 copy/open/clear history、send-message、submit-option、skip-speech、pause-asr、reroll 返回 ChatSnapshot。React chat stage 主要轮询 snapshot，不直接驱动真实 LLM loop。
_resolve_project_file 对下载/历史文件做项目根限制，但 historyPath 也有绝对路径处理，提示 UI bridge 的文件能力很容易扩大安全面。
tasks.py 给后台操作统一 id/kind/title/message/phase/progress/logs/cancelRequested/createdAt/updatedAt/result/error。TaskProgress 和 RuntimeProgressPanel 把长任务变成可观察投影。
PySide ChatUIWindow 是终端演出面：透明窗口、立绘、CG、对话框、选项、输入、麦克风、工具栏、token 状态、窗口布局持久化。它不是配置中心。
UIUpdateManager 提供 headless/no-op facade 和 Qt facade，说明同一目标世界可以有桌面演出和 headless 运行两种投影；核心事件仍是 dialog/sprite/BGM/CG/options。
ChatUIContext 给插件只读状态访问和有限 UI actions，不暴露底层 Qt Signal；插件可以订阅事件和挂载 UI contribution，但仍在宿主边界内。
React 路由清楚分成 /settings 下的 api/characters/backgrounds/templates/plugins/logs/tools/music-cover/launch/system，以及 /chat 的运行舞台。这是复杂功能分区，不是单一聊天产品。
ChatLauncher 保存 template launch session 后再 launch chat；ChatStage 只 hydrate snapshot、发送 command、显示 background/sprite/dialog/options/input/toolbar。
httpPlatform 为 GET/HEAD 做启动重试、为后台 task 做轮询等待、为失败任务抛错。这是桥接层可靠性工程，不是 agent 智能本身。
```

写小结：

Shinsekai 第 4 轮的关键价值是“复杂度分层”。它没有把角色演出产品伪装成一个简单聊天框，而是把创作者配置、本地资产、插件/MCP、启动参数、运行演出、后台任务和日志拆成不同 surface。这样用户在运行时看到的是角色舞台，创作者在配置时才面对复杂控制面。

feng 能学的原则：

```text
简单产品不等于没有复杂度，而是复杂度必须有明确归属：grow 的材料/契约/证据、hatch 的运行包、debug 的反馈投影不能混在一个交互面里。
file-native 真相层应该优先于 UI/bridge/process state。前端、桌面窗、任务进度都应是投影，关键成长状态、下一轮 message list、证据和日志必须能在文件里找到。
grow/hatch/debug 可能需要开发者 surface，但概念层不能提前设计成桌面 App、React 控制台或任务中心。
运行失败、依赖缺失、日志尾部、进程 PID、历史文件路径这些“可见运行证据”比一句“失败了”更可信。
创作者材料和系统契约要分层。对于 boss-agent，外界输入、处理规则、动作输出、调试上报和验证 DoD 不应该被揉成一个 prompt。
目标产物的运行面可以是 headless、命令、服务、游戏组件或 UI；投影形态服务目标世界，不应反过来定义 feng。
```

如果照搬会带偏 feng：

```text
Shinsekai 的 UI/bridge/API 很强，但它是桌面角色演出产品的必要复杂度。feng 不能被带成设置中心、插件管理器、任务面板、媒体资产管理器。
React bridge 的广 API 面提醒 feng：一旦把“方便配置”当成目标，产品会迅速膨胀，grow/hatch 的核心闭环会被周边工具吞掉。
ChatStage 的 snapshot/polling 对 feng 只是一种投影样例，不能让 feng 的 grow 心智退回“聊天舞台”。
本地资产管理对 Shinsekai 是核心，对 feng 只是目标世界材料的一种。boss、小说、音乐各自的材料边界不同，不能复制角色/背景/模板分类。
如果被 Shinsekai 第 4 轮牵着走，feng 会变成被调研对象牵着走的拼装产品：UI 分区完整、任务进度漂亮、插件按钮很多，但智能行为成长是否可复制仍然没有回答。
```

再看代码：

回看 `frontend_bridge.py`、`frontend_bridge_core/state.py` 和 `httpPlatform.ts`，确认 React 是请求/投影层，Python bridge 仍持有文件、配置、插件和聊天启动边界。回看 `chat.py`，确认启动聊天会落模板、history、env、log，并在失败时返回可诊断证据。回看 `ChatStagePage.tsx`，确认运行舞台只围绕 snapshot 呈现背景、立绘、对白、选项和输入。

下一轮问题：

```text
Shinsekai 如何处理发布、导入导出、测试、日志、配置迁移和回归？
它如何保证目标世界资产和运行契约可以迁移，而不是只能在当前开发机上跑？
feng 能从“可复制/可迁移/可回归”中学什么，又如何避免被带成完整桌面产品分发工程？
```

## Shinsekai / 第 5 轮

看代码/文档：

```text
Shinsekai/README.md
Shinsekai/VERSION
Shinsekai/install.bat
Shinsekai/scripts/install-linux.sh
Shinsekai/requirements.txt
Shinsekai/requirements-runtime-core.txt
Shinsekai/requirements-runtime-local-ai.txt
Shinsekai/frontend/package.json
Shinsekai/.github/workflows/test.yml
Shinsekai/.github/workflows/react-frontend.yml
Shinsekai/.github/workflows/tauri-desktop.yml
Shinsekai/.github/workflows/release.yml
Shinsekai/frontend/scripts/prepare-tauri-resources.mjs
Shinsekai/frontend/scripts/verify-tauri-resources.mjs
Shinsekai/frontend/src-tauri/runtime_manifest.json
Shinsekai/frontend/src-tauri/runtime_sources.json
Shinsekai/frontend/src-tauri/src/runtime.rs
Shinsekai/ui/migrate_helper/release.py
Shinsekai/core/bootstrap/frozen_log.py
Shinsekai/sdk/logging/configure.py
Shinsekai/frontend_bridge_core/logs.py
Shinsekai/frontend_bridge_core/runtime_dependencies.py
Shinsekai/tools/file_util.py
Shinsekai/test/unit/test_frontend_chat_launch_paths.py
Shinsekai/test/unit/test_frontend_bridge_logs.py
Shinsekai/test/unit/test_frontend_runtime_check.py
Shinsekai/test/unit/tools/test_character_import.py
Shinsekai/test/unit/tools/test_background_import.py
Shinsekai/test/e2e/test_chat_flow.py
```

记笔记：

```text
README 把“数据在本地、可备份”明确写成卖点：配置与资源默认落在 data/ 下，角色、历史、API、系统配置都可被用户看到和迁移。
VERSION 是根版本，frontend/package.json 也有版本；release workflow 检查二者必须一致，否则 updater release 失败。版本不是 UI 文案，而是交付契约。
install-linux.sh 强制 Python 3.10，优先用当前非 base conda 环境，其次 uv .venv，再 fallback python3.10；同时创建 data/config、data/sprite、data/speech、data/models、data/chat_history、data/character_templates。
README 对源码、整合包、React 设置中心、Tauri dev、Tauri build 分开说明，说明“开发者运行”和“终端用户运行”是两套路径。
runtime_manifest.json 把 desktop-core/local-ai/full 分成 profile，desktop-core 有 required imports、requirements、bridge_check；local-ai/full 继承扩展，而不是把所有重依赖塞进核心包。
runtime_sources.json 锁定 python-build-standalone release、target、python 版本、asset、sha256、required_files、prune_files。可复制运行时依赖来自 manifest，不来自“机器上刚好有 Python”。
prepare-tauri-resources.mjs 把 VERSION、main.py、frontend_bridge.py、requirements、assets/config/core/frontend_bridge_core/i18n/live/llm/sdk/t2i/tools/tts/ui、frontend/dist 和可选 runtime 拷进 Tauri resources。
verify-tauri-resources.mjs 检查 runtime marker、Python 可执行文件、runtime_manifest、main.py、bridge、requirements、default/headless workflow、关键图片和声音资源。这是发布前的产物完整性 gate。
tauri-desktop workflow 有 runtime-gate：检查 desktop-core runtime、runtime manifest tests、构建前端、Rust runtime tests、verify runtime matrix、desktop runtime UI contract tests。
release workflow 对多平台 package 做版本一致性、updater signing key、嵌入 Python runtime 缓存、prepare runtime、tauri build、收集平台资产、生成 latest.json updater manifest。
frozen_log.py 把无控制台发行版 stdout/stderr 重定向到 <project-root>/logs/<app>.log，避免用户遇到黑盒失败。
sdk/logging/configure.py 建立 queue logging、jsonl rotating file、context filter、版本/session_id、exception hook、日志保留。插件不应配置 logging，宿主拥有 logging。
frontend_bridge_core/logs.py 支持日志列表、日志快照、JSONL entry 解析、diagnostic bundle zip。诊断包带 manifest、runtime environment、version 和最近日志。
runtime_dependencies.py 从启动日志识别缺 Python module，映射到 package name，并允许非 frozen 源码模式下 pip install；frozen 下拒绝直接 pip，避免装错运行时。
file_util.py 的 .char/.bg 导入导出会把素材、语音、模型、YAML、manifest 打包；导出时把绝对路径改成包内文件名，导入时重建到 data/sprite、data/speech、data/models、data/backgrounds、data/bgm。
导入包会解决 name 和 sprite_prefix 冲突，支持旧格式的绝对路径，但使用 _safe_extract_zip、_safe_package_relpath、_safe_package_basename_or_legacy_absolute 拒绝 zip slip、NUL、..、Windows drive 等不安全路径。
测试不是只测 UI：Python unit/e2e 覆盖 output contract、stream parser、tool executor、bridge static/media/logs/tasks/runtime、角色/背景导入导出、worker pipeline；前端用 Vitest/Playwright；Tauri 用 Rust runtime tests。
test_frontend_runtime_check 明确验证 desktop-core 不导入可选重包、requirements marker 在不同平台行为正确、UIUpdateManager 不依赖 cv2、runtime manifest 定义 profile。
test_chat_flow 分层测试：纯数据 pipeline、配置 round-trip、UIUpdateManager signal、worker -> UI 完整流程。它验证目标世界事件链路，不验证“模型自信”。
```

写小结：

Shinsekai 第 5 轮的价值是“可复制不是复制源码目录，而是复制运行条件、资产、契约和诊断能力”。它把本地数据、导入导出包、运行时 profile、Tauri resources、版本一致性、日志诊断和测试 gate 都放进交付链路。这样角色演出产品才不是只能在作者电脑上跑。

feng 能学的原则：

```text
hatch 包必须带运行契约和完整性证据：版本、入口、依赖 profile、资源清单、目标世界契约、验证报告、诊断日志位置。
可复制需要区分源码模式、开发者调试模式、终端运行模式；不能只说“把目录复制过去”。
导入/上报/反馈包必须拒绝不安全路径和宿主绝对路径污染，同时可以兼容旧格式并重建到当前项目的受控目录。
运行失败要产出可诊断文件：日志、退出码、缺依赖映射、运行环境摘要、最近事件，而不是只由模型总结。
验证应该覆盖目标世界事件链路：输入 -> LLM/决策 -> 解析 -> 下游执行 -> 可见输出/证据，而不是只看 LLM 回复是否像样。
依赖 profile 可以表达“核心运行最小集”和“可选增强集”。feng hatch 出 boss-agent、小说-agent、音乐-agent 时也应避免把所有能力打成一个全量包。
```

如果照搬会带偏 feng：

```text
Shinsekai 的发布工程很完整，但 feng 当前仍是概念梳理和 agent 研究阶段，不能被带成 Tauri/桌面安装包优先项目。
角色 .char、背景 .bg、TTS bundle、Python embedded runtime 是 Shinsekai 的目标世界交付物；feng 要抽象为“目标 agent 交付包”，不要复制这些格式。
runtime profile 的思想可学，但具体 Python/Tauri/conda/uv 流程不是 feng 的概念核心。
测试矩阵值得学习，但 feng 的第一批验证应围绕 grow/hatch/file-native/feedback-route，而不是复制 Shinsekai 的 GUI、媒体、打包测试。
如果被第 5 轮牵着走，feng 会变成被调研对象牵着走的拼装产品：发布脚本、诊断包、导入导出格式都很全，但没有证明智能行为能成长、成型并可复制。
```

再看代码：

回看 `runtime_manifest.json`、`runtime_sources.json`、`prepare-tauri-resources.mjs` 和 `verify-tauri-resources.mjs`，确认可复制运行时来自显式资源清单和校验。回看 `tools/file_util.py` 和导入导出测试，确认资产包会把路径重写到包内，并在导入时重建到当前 data 目录。回看 `test/e2e/test_chat_flow.py`，确认测试按目标世界事件链路分层，而不是只对单个函数做表层检查。

下一轮问题：

```text
Shinsekai 已完成 5 轮。后续只把它作为“目标世界契约、复杂度分层、资产可迁移、输出协议、交付诊断”的参考。
进入 learn-claude-code / AssistantAgent 时，需要继续防止 feng 被带成 coding-agent 教程复刻、Java 企业 agent 框架或工具生态拼装平台。
```

## AssistantAgent / 第 0 轮预读

看代码/文档：

```text
AssistantAgent/README_zh.md
AssistantAgent/README.md
AssistantAgent/ROADMAP.md
AssistantAgent/CHANGELOG.md
AssistantAgent/pom.xml
AssistantAgent/assistant-agent-start/src/main/resources/application-reference.yml
AssistantAgent/assistant-agent-start/src/main/java/com/alibaba/assistant/agent/start/config/CodeactAgentConfig.java
AssistantAgent/assistant-agent-*/src/main/java/*
AssistantAgent/assistant-agent-*/src/test/java/*
```

记笔记：

```text
AssistantAgent 是 Spring AI Alibaba 生态下的企业级智能助手框架，定位是 Code-as-Action：模型先生成 Python 代码，再在 GraalVM 沙箱里执行，通过代码编排工具。
README 的主能力是 Code-as-Action、GraalVM sandbox、多维评估图、Prompt 动态组装、COMMON/REACT/TOOL 统一经验、学习提取、搜索、回复渠道、触发器、MCP、动态 HTTP 工具、管理后台。
pom 是 Java 17 / Spring Boot 3.4 / Spring AI 1.1 / GraalVM Polyglot 的多模块 Maven 项目。模块包括 core、evaluation、prompt-builder、extensions、management、autoconfigure、start。
ROADMAP 明确当前阶段是“半集成框架”，目标是开发者二次开发；后续阶段是能力下沉、生产就绪、可视化配置平台和零代码接入。这是企业平台演进路线。
application-reference.yml 显示大量模块可开关：experience、learning、search、reply、evaluation、trigger、MCP、management console。默认大量功能开启，但经验管理 console 默认关。
CodeactAgentConfig 的系统提示很强势：不反问、主动推断、立即行动、用 write_code/execute_code/write_condition_code，代码必须返回 dict，禁 docstring/注释，失败后重新生成代码。
CodeactAgentConfig 把 reply/search/trigger/unified search/MCP/HTTP/custom CodeactTool 合并为 codeactTools，同时 React 阶段只暴露 reply/prompt contribution/codeact signature/experience disclosure 等有限 ToolCallback。
builder 设置 language=PYTHON、enableInitialCodeGen=true、allowIO=false、allowNativeAccess=false、executionTimeout=30000、MemorySaver。这里存在“代码执行很强，但边界靠 GraalVM 配置与工具桥约束”的核心风险。
CHANGELOG 显示项目重视 observability：OpenTelemetry、Hook/Interceptor/React/Execution/CodeGen/ToolCall 指标、ToolCallRecord、ExecutionRecord.callTrace、PromptContributor 替代 PromptBuilder。
```

写小结：

AssistantAgent 的预读价值，是它把“agent 行动”推到代码层：不是让模型选一个工具，而是让模型写一段小程序来组合多个工具。这对复杂业务流程很有吸引力，也很危险。它适合企业助理、运维、客服等业务集成场景，但很容易把 feng 带成企业 agent 框架或工具生态拼装平台。

feng 能先记录的待验证启发：

```text
Code-as-Action 可能启发 hatch 产物：目标 agent 不一定直接 tool-call，也可能生成受限脚本、行为片段或策略代码。
评估图可能启发 grow 前的输入路由和 readiness 判断，但不能替代实际证据。
Prompt Contributor 可能启发 message list 编译：不同来源按优先级贡献，而不是一坨系统 prompt。
COMMON/REACT/TOOL 经验模型可能启发 feng 的 skill/经验分层，但必须和 grow 证据、反馈吸收、hatch contract 分开。
Learning hook 可能启发多层闭环，但必须验证它如何过滤、采纳和存储经验，不能把“执行历史提取经验”当成可信自我演进。
```

如果照搬会带偏 feng：

```text
AssistantAgent 的目标是企业级智能助手框架，路线图会走向配置平台、管理后台、SPI 生态和零代码接入。feng 不应沿着这条产品路线走。
CodeAct 的“不反问、主动推断”对企业 demo 友好，但对 feng grow 可能危险：用户模糊时，有时必须产出缺失输入清单，而不是强行执行。
GraalVM sandbox 不是产品概念上的安全答案；后续必须看 allowIO/allowNativeAccess/tool bridge 到底能防什么、不能防什么。
经验管理 console、触发器、回复渠道、动态 HTTP/MCP 都很容易诱导 feng 变成拼装平台。本仓库必须以“防止被调研对象牵着走”为优先审计。
```

再看代码：

回看 `CodeactAgentConfig.java`，确认 README 里的模块最终会在 Spring 配置中汇合到一个 `CodeactAgent`：React 阶段工具和 CodeAct 阶段工具分离，hooks/model interceptors/experience/fastIntent 都注入 builder。这个入口适合作为第 1 轮切入点。

下一轮问题：

```text
CodeAct 核心 loop 怎么组织：write_code、execute_code、GraalCodeExecutor、ToolRegistryBridge、ExecutionRecord 和 callTrace 如何协同？
GraalVM 沙箱边界到底在哪里：allowIO=false、allowNativeAccess=false 后，代码还能通过 tool bridge 做什么？
feng 能否学习“生成受限行为代码/策略片段”的思想，而不是复制 Java/Spring 企业框架？
```

## AssistantAgent / 第 1 轮

看代码：

```text
AssistantAgent/assistant-agent-autoconfigure/src/main/java/com/alibaba/assistant/agent/autoconfigure/CodeactAgent.java
AssistantAgent/assistant-agent-autoconfigure/src/main/java/com/alibaba/assistant/agent/autoconfigure/tools/WriteCodeTool.java
AssistantAgent/assistant-agent-autoconfigure/src/main/java/com/alibaba/assistant/agent/autoconfigure/tools/WriteConditionCodeTool.java
AssistantAgent/assistant-agent-autoconfigure/src/main/java/com/alibaba/assistant/agent/autoconfigure/tools/ExecuteCodeTool.java
AssistantAgent/assistant-agent-core/src/main/java/com/alibaba/assistant/agent/core/executor/GraalCodeExecutor.java
AssistantAgent/assistant-agent-core/src/main/java/com/alibaba/assistant/agent/core/executor/python/PythonEnvironmentManager.java
AssistantAgent/assistant-agent-core/src/main/java/com/alibaba/assistant/agent/core/context/CodeContext.java
AssistantAgent/assistant-agent-core/src/main/java/com/alibaba/assistant/agent/core/context/SessionCodeManager.java
AssistantAgent/assistant-agent-core/src/main/java/com/alibaba/assistant/agent/core/tool/ToolRegistryBridge.java
AssistantAgent/assistant-agent-core/src/main/java/com/alibaba/assistant/agent/core/tool/DefaultCodeactToolRegistry.java
AssistantAgent/assistant-agent-core/src/main/java/com/alibaba/assistant/agent/core/tool/view/PythonToolViewRenderer.java
AssistantAgent/assistant-agent-core/src/main/java/com/alibaba/assistant/agent/core/tool/schema/DefaultReturnSchemaRegistry.java
AssistantAgent/assistant-agent-common/src/main/java/com/alibaba/assistant/agent/common/tools/CodeactTool.java
AssistantAgent/assistant-agent-common/src/main/java/com/alibaba/assistant/agent/common/tools/CodeactToolMetadata.java
AssistantAgent/assistant-agent-common/src/main/java/com/alibaba/assistant/agent/common/tools/definition/ParameterTree.java
AssistantAgent/assistant-agent-core/src/test/java/com/alibaba/assistant/agent/core/tool/definition/ShapeExtractorTest.java
```

记笔记：

```text
CodeactAgent 继承 ReactAgent，但额外把 write_code、write_condition_code、execute_code 加进 React 阶段工具。
它有两层行动面：React 阶段的 ToolCallback 负责写代码/执行代码/回复/经验披露；CodeAct 阶段的 CodeactTool 由生成的 Python 通过 ToolRegistryBridge 调用。
builder 会自动注入 CodeactToolsStateInitHook 和可选的 CodeactToolSignatureAgentHook，把可用工具签名、state 和执行器接入 loop。
WriteCodeTool 要求模型一次生成完整函数，清理 markdown fence，校验函数名，并把 GeneratedCode 写入当前 OverAllState 的 session 代码区；没有 state 时才落到进程内全局 CodeContext。
WriteConditionCodeTool 是触发器条件函数的同构版本，说明 CodeAct 不只用于业务动作，也用于运行条件判断。
ExecuteCodeTool 从 ToolContext 取 OverAllState，注入自定义变量，调用 GraalCodeExecutor，并更新 execution history/current execution。
GraalCodeExecutor 先合并全局函数和 session 函数，session 覆盖 global，再拼出完整 Python：imports、工具 binding、agent_state/logger/custom variables、函数定义、安全调用和 _result。
Graal Context 默认 allowIO=false、allowNativeAccess=false，但使用 HostAccess.ALL，并通过 __tool_registry__ 暴露 Java tool bridge；所以真正边界不只是 GraalVM，而是 bridge、tool registry、工具权限和运行配置的组合。
PythonEnvironmentManager 用 Base64 生成字符串参数表达式，避免转义破坏生成代码；这说明“让模型写可执行代码”需要大量非智能的工程补丁。
ToolRegistryBridge 负责 Python -> Java 工具调用、JSON 参数归一、ToolCallRecord、replyToUserTrace 和返回 schema 观测，但 `repliedToUser` 依赖字符串包含判断，比较脆弱。
DefaultCodeactToolRegistry 解析 Spring AI inputSchema 为 ParameterTree，再渲染 Python stub；返回值 schema 可以来自声明，也可以从实际工具返回中观察并合并。
PythonToolViewRenderer 把工具变成 Python 代码 stub、docstring、few-shot 和返回结构说明，本质是把工具面编译成模型可写代码的 API 文档。
CodeactAgentConfig 的 system prompt 要求“不要反问、主动推断”，但 WriteCodeTool 描述又要求 docstring，而 system prompt 禁 docstring/注释，存在提示层自相矛盾。
```

写小结：

AssistantAgent 第 1 轮确认：它的核心价值不是“更会聊天”，而是把模型行动转成受限代码片段，再通过工具桥执行、记录调用轨迹、观察返回结构。这对复杂业务集成很强，因为一段函数可以组合多个工具、条件和中间状态；但它不等于安全自治，反而把风险集中到了代码执行边界、工具桥权限、schema 真实性和执行记录完整性上。

feng 能学的原则：

```text
hatch 产物不必总是 LLM loop，也可能是受限策略脚本、行为片段或执行函数。
生成出来的行为片段必须有作用域、版本、来源、执行记录、工具调用轨迹和失败证据。
工具签名可以被编译进下一轮 message list，但不能把所有工具长期暴露给模型。
返回值结构可以通过运行观察逐步修正，但“观察到的 schema”只能作为证据，不能直接变成可信能力声明。
```

如果照搬会带偏 feng：

```text
feng 会变成 CodeAct/Spring AI 企业集成框架，而不是轻量、file-native 的智能行为成长系统。
“模型写代码然后执行”很有诱惑，但它会把 grow 的产品体验拉向开发者框架和调试器。
HostAccess.ALL + tool bridge 说明 sandbox 不能在 README 里被轻率包装成安全承诺。
session/global 代码模型和 feng 的“grow 单元下只有一个连续成长空间”并不一致；feng 只能学习作用域原则，不能复制 session 产品心智。
“不反问、强行推断”不适合 feng 的 grow：输入不足时，grow 应该能产出缺失材料清单或验证阻塞，而不是为了显得主动而执行。
```

再看代码：

回看 `GraalCodeExecutor.generatePythonToolCode`、`PythonToolViewRenderer.renderToolStub` 和 `DefaultCodeactToolRegistry.generateStructuredToolPrompt`，确认 AssistantAgent 实际上维护了两份相互对齐的工具视图：一份给模型看，让模型知道如何写 Python 调用；一份注入 GraalVM，让代码运行时真正调用 Java 工具。这个设计很强，但也说明 feng 不能只说“file native message list”，还必须在未来设计中保证“模型看到的工具/API”和“运行时真正可调用的工具/API”一致。

下一轮问题：

```text
Evaluation Graph 和 Prompt Contributor 如何参与输入路由、工具筛选和 prompt/message 编译？
它是否真的提升判断质量，还是只是把模块开关变成更复杂的拼装系统？
feng 能否学习“按来源贡献上下文”的思想，同时避免被做成 Prompt Builder 框架？
```

## AssistantAgent / 第 2 轮

看代码：

```text
AssistantAgent/assistant-agent-prompt-builder/src/main/java/com/alibaba/assistant/agent/prompt/PromptContributor.java
AssistantAgent/assistant-agent-prompt-builder/src/main/java/com/alibaba/assistant/agent/prompt/PromptContribution.java
AssistantAgent/assistant-agent-prompt-builder/src/main/java/com/alibaba/assistant/agent/prompt/PromptContributorContext.java
AssistantAgent/assistant-agent-prompt-builder/src/main/java/com/alibaba/assistant/agent/prompt/DefaultPromptContributorManager.java
AssistantAgent/assistant-agent-evaluation/src/main/java/com/alibaba/assistant/agent/evaluation/DefaultEvaluationService.java
AssistantAgent/assistant-agent-evaluation/src/main/java/com/alibaba/assistant/agent/evaluation/executor/GraphBasedEvaluationExecutor.java
AssistantAgent/assistant-agent-evaluation/src/main/java/com/alibaba/assistant/agent/evaluation/executor/CriterionEvaluationAction.java
AssistantAgent/assistant-agent-evaluation/src/main/java/com/alibaba/assistant/agent/evaluation/builder/EvaluationSuiteBuilder.java
AssistantAgent/assistant-agent-evaluation/src/main/java/com/alibaba/assistant/agent/evaluation/evaluator/LLMBasedEvaluator.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/evaluation/hook/ReactBeforeModelEvaluationHook.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/evaluation/hook/BeforeModelEvaluationHook.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/evaluation/config/CodeactEvaluationContextFactory.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/evaluation/store/OverAllStateEvaluationResultStore.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/prompt/PromptContributorModelHook.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/prompt/EvaluationBasedPromptContributor.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/prompt/OverAllStatePromptContributorContext.java
AssistantAgent/assistant-agent-start/src/main/java/com/alibaba/assistant/agent/start/config/ExperienceEvaluationCriterionProvider.java
AssistantAgent/assistant-agent-start/src/main/java/com/alibaba/assistant/agent/start/config/ReactPhaseGuidancePromptContributor.java
```

记笔记：

```text
PromptContributor 是一个很小的抽象：name、shouldContribute、contribute、priority。它不直接拼完整 prompt，而是贡献 system text 或前后置消息。
DefaultPromptContributorManager 会按 priority 合并贡献，并避免多个 SystemMessage；但真正接入 hook 时，systemTextToPrepend/systemTextToAppend 又不会生效，只能通过 messagesToAppend 转成注入消息。这暴露了框架抽象和实际 hook 能力之间的不一致。
PromptContributorModelHook 在 BEFORE_MODEL 阶段读取 contributors，按 contributorName + content MD5 去重，再用伪 AssistantMessage + ToolResponseMessage 注入 `<additional_system_guidance>`。
为了防止 LLM 误调用内部注入工具，它还注册 PromptContributionToolCallback 占位工具。这是“把内部系统注入伪装成工具响应”的工程折中。
Evaluation 模块把 EvaluationSuite 编译成 StateGraph：criterion 可以 dependsOn，按层级并行或串行执行，中间用 join 节点汇聚。
CriterionEvaluationAction 将每个 criterion 的结果写成独立 state key：`<criterion>_result/status/completed/value/error`，并处理 timeout、error、defaultValue、conditional skip、batching 和 aggregation。
LLMBasedEvaluator 的 prompt 是固定格式：评估描述、工作机制、RESULT 输出约束、可选 reasoning、few-shot、contextBindings、dependency results。结果解析依赖 `RESULT:` 前缀和枚举/JSON/list 解析。
ReactBeforeModelEvaluationHook 在模型调用前构造 EvaluationContext，评估后把 EvaluationResult 写回 OverAllState 的 `__evaluation_results__`。
CodeactEvaluationContextFactory 取最后一条 UserMessage，而不是简单取 messages 最后一项，因为前置 hook 可能已经注入 AssistantMessage/ToolResponseMessage。
默认 ExperienceEvaluationCriterionProvider 定义 enhanced_user_input 和 is_fuzzy 两个 criterion：先提纯用户输入，再判断“模糊/一般/清晰”。
ReactPhaseGuidancePromptContributor 根据 is_fuzzy 结果生成执行指导：模糊时建议澄清，一般时先分析/检索，清晰时直接执行；但如果已有经验候选，会跳过模糊澄清指导。
```

写小结：

AssistantAgent 第 2 轮最有价值的地方，是它把“下一轮模型输入”拆成两个阶段：先评估输入和状态，再让不同来源按条件贡献指导。它没有把所有规则写死进一个大 system prompt，而是把 guidance 变成可排序、可去重、可由评估结果触发的贡献。这对 feng 的 file-native message list 很有启发：下一轮 LLM loop 不应该是临时拼接，而应该是由目标、材料、评估、反馈、工具面和安全边界共同编译出的可检查文件。

feng 能学的原则：

```text
grow 每轮开始前可以有“输入/状态评估”，但评估结果必须成为文件化证据，而不是内存 state。
message list 可以由多个贡献源编译：目标、约束、反馈、工具签名、已采纳 skill、未解决问题。
贡献源要有优先级、去重、来源记录和生效条件，避免上下文无限膨胀。
模糊输入不应被强行执行；缺失材料清单本身可以是 grow 的合法产物。
评估图适合表达 readiness/checklist 依赖，但不能把 LLM 评估当成最终验收。
```

如果照搬会带偏 feng：

```text
AssistantAgent 的 Evaluation + Prompt Contributor 是 Spring hook/state 体系，不是 file-native 体系。
把 contributor 做成可注册 Bean 很适合企业框架，但会把 feng 拉向配置平台和插件生态。
LLM-based evaluator 仍然是模型判断；如果直接用于 hatch readiness，会产生“模型说成了所以成了”的误区。
伪工具注入是为了适配聊天框架的工程手段，feng 不应该把这种内部实现变成产品概念。
它的默认“模糊/一般/清晰”适合作为输入路由，但 feng 的 grow 更需要把模糊转成材料缺口、验证计划和下一轮 message list，而不是单纯提示模型澄清。
```

再看代码：

回看 `ReactPhaseGuidancePromptContributor` 和 `PromptContributorModelHook`，确认实际路径是：EvaluationResult 存在 OverAllState，Contributor 读取结果，生成 UserMessage 形式的指导，Hook 再把它包装成伪 tool response 注入 messages。这说明 AssistantAgent 的“上下文贡献”并不是最终 message list 编译器，而是围绕已有 agent graph 的 hook 适配层。feng 只能学习“条件贡献和证据驱动编译”这个原则，不能复制它的 hook 形态。

下一轮问题：

```text
Experience、Learning、FastIntent 如何形成经验提取、检索、披露和快速响应？
它是否真的做到可控学习，还是把执行历史粗糙转成 prompt 经验？
feng 的多层回流 skill 能否学习它的经验分层，同时保持采纳门槛、证据和版本边界？
```

## AssistantAgent / 第 3 轮

看代码：

```text
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/experience/model/Experience.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/experience/model/ExperienceMetadata.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/experience/model/ExperienceType.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/experience/model/ExperienceArtifact.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/experience/model/FastIntentConfig.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/experience/internal/InMemoryExperienceRepository.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/experience/internal/InMemoryExperienceProvider.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/experience/disclosure/ExperiencePrefetchHook.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/experience/disclosure/ExperienceDisclosureService.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/experience/disclosure/ExperienceDisclosurePromptContributor.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/experience/disclosure/ExperienceRuntimeModelInterceptor.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/experience/disclosure/ExperienceRuntimeToolStateInterceptor.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/experience/fastintent/FastIntentService.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/experience/hook/FastIntentReactHook.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/learning/extractor/ExperienceLearningExtractor.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/learning/hook/AfterAgentLearningHook.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/learning/hook/AfterModelLearningHook.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/learning/interceptor/LearningToolInterceptor.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/learning/internal/DefaultLearningExecutor.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/learning/internal/DefaultLearningStrategy.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/learning/offline/ExperienceLearningGraph.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/learning/repository/ExperienceLearningRepository.java
```

记笔记：

```text
Experience 被分为 COMMON、REACT、TOOL 三类：COMMON 是概念/规范/安全，REACT 是流程策略，TOOL 是单工具能力和调用边界。
Experience 对象不只是文本：还有 disclosureStrategy、associatedTools、relatedExperiences、artifact、fastIntentConfig、references、assets、metadata(source/confidence/version/tenant)。
经验披露采用渐进式：L1 候选卡，L2 read_exp 读完整正文和 reference/asset manifest，L3 read_exp_doc 按路径读取 reference；asset 明确不能通过 read_exp_doc 读，只能在沙箱 workspace 里用工具访问。
DIRECT grounding 有硬条件：披露策略为 DIRECT、内容短于 500、confidence >= 0.8；否则只给候选，不直接灌进 prompt。
ExperiencePrefetchHook 在 BEFORE_AGENT 预取候选和 direct groundings，写入 state，同时为 TOOL 候选收集当前轮可 React 直调的工具名。
ExperienceRuntimeModelInterceptor 暴露 search_exp/read_exp/read_exp_doc，并按 `experience_allowed_react_tool_names` 过滤 React 阶段可见工具；这说明经验不是无条件开工具，而是当前轮临时放行。
ExperienceRuntimeToolStateInterceptor 在 search_exp/read_exp 后更新 direct tool allowlist、detail cache、direct groundings 和已 read_exp 的 id；read_exp_doc 依赖“先 read_exp”的 session gate。
ExperienceDisclosurePromptContributor 把三类经验、DIRECT/PROGRESSIVE 规则、候选卡、direct grounding、工具调用路径写成结构化 guidance。
FastIntent 给每条经验加条件表达式和 artifact；命中后 FastIntentReactHook 可以跳过模型，直接构造 AssistantMessage.toolCalls 并 jump_to tool。
FastIntent 支持 message_prefix/message_regex/metadata/state/tool_arg 等匹配，按 priority、updatedAt、id 选择 best match，并有工具白名单。
Learning 模块包含 strategy/extractor/repository/executor/hook/interceptor/offline graph，但默认策略基本“总是触发，由 extractor 判断是否学习”。
ExperienceLearningExtractor 先用 LLM 判断是否值得学习，再用 LLM 从上下文提取 COMMON/REACT/TOOL 经验 JSON；会截断用户输入、代码、最后几轮对话和工具记录。
AfterAgentLearningHook 当前只提取 messages，toolCallRecords/modelCallRecords 仍是 TODO；AfterModelLearningHook 也还没有真实模型调用记录提取。
ExperienceLearningGraph 的历史数据获取、清洗、转换也都是 TODO；LearningRepository.search 也未实现。这说明闭环概念强，但实现还处在框架骨架阶段。
```

写小结：

AssistantAgent 第 3 轮证明了一个重要方向：经验不是“聊天记忆”，而是可以带类型、披露级别、来源、置信度、关联工具、引用材料和可执行 artifact 的能力候选。它最好的设计是渐进披露和临时工具放行：先让模型看到轻量候选，需要时再读详情，只有满足 DIRECT 条件的经验才直接进入 prompt，只有被披露允许的工具才在当前轮开放。

但它的 learning 还不能被称为可信自我演进。默认 extractor 依赖 LLM 判断“是否值得学习”和 LLM 生成经验 JSON，很多关键数据源和离线学习链路还标着 TODO。它能形成经验池，却没有足够的采纳门槛、回归验证、冲突处理、版本治理和撤销机制。对 feng 来说，这正是反向审计点：多层回流不能只是“把下游历史总结成上游 skill”。

feng 能学的原则：

```text
多层回流 skill 应该把反馈分成候选卡、详情、证据引用、可执行产物和采纳状态，而不是直接写进上游能力。
经验/skill 的披露要渐进：先暴露摘要和适用条件，再按需读取全文或引用文件。
经验可以带可执行捷径，但自动执行必须有命中条件、优先级、工具白名单、证据和失败回退。
下游上报到上游时，应附带来源、置信度、版本、适用范围、关联工具和原始证据路径。
“被采纳”必须不同于“被记录”；记录可以自动，采纳和替换默认 skill 需要验证门槛。
```

如果照搬会带偏 feng：

```text
feng 会变成经验库 + 检索注入系统，而不是智能行为成长系统。
LLM 总结出来的经验如果未经验证，会污染上游 skill；这正是“无脑往上游吸收”的风险。
FastIntent 很像“曾经成功所以这次跳过思考”，如果没有环境匹配和撤销，会造成错误自动化。
AssistantAgent 的经验状态仍在 OverAllState/session 里周转；feng 必须把候选、详情、引用、采纳决定和下一轮 message list 文件化。
COMMON/REACT/TOOL 的分类对企业助手有用，但 feng 不能直接把它作为产品概念分类；feng 更需要“目标行为、世界输入、动作边界、验证证据、反馈路由”的分类。
```

再看代码：

回看 `ExperienceLearningExtractor`、`AfterAgentLearningHook` 和 `ExperienceLearningGraph`，确认 learning 闭环目前更像“框架预留 + LLM 提炼经验”，不是严肃的自我演进。回看 `ExperienceDisclosureService` 和 `ExperienceRuntimeModelInterceptor`，确认真正成熟的是“经验披露和工具可见面控制”，不是“自动学习”。因此 feng 应该优先学习披露/采纳边界，而不是学习其自动总结经验的表面。

下一轮问题：

```text
动态工具、MCP/HTTP/Search/Reply/Trigger 如何对外提供能力？
这些扩展是否形成可部署 agent 的能力边界，还是继续把项目推向企业拼装平台？
feng hatch 产物对外提供能力时，哪些模式可借鉴，哪些必须避免？
```

## AssistantAgent / 第 4 轮

看代码：

```text
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/search/spi/SearchProvider.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/search/internal/DefaultSearchFacade.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/search/tools/UnifiedSearchCodeactTool.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/search/tools/BaseSearchCodeactTool.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/reply/spi/ReplyChannelDefinition.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/reply/tools/BaseReplyCodeactTool.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/reply/tools/ReplyCodeactToolFactory.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/reply/config/ReplyExtensionAutoConfiguration.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/dynamic/tool/AbstractDynamicCodeactTool.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/dynamic/http/HttpDynamicToolFactory.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/dynamic/http/HttpDynamicCodeactTool.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/dynamic/http/HttpDynamicToolsInstaller.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/dynamic/http/OpenApiSpec.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/dynamic/mcp/McpDynamicToolFactory.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/dynamic/mcp/McpDynamicToolsInstaller.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/dynamic/mcp/McpToolCallbackAdapter.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/trigger/model/TriggerDefinition.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/trigger/model/TriggerExecutionRecord.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/trigger/model/TriggerExecutionResult.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/trigger/model/SessionSnapshot.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/trigger/manager/TriggerManager.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/trigger/executor/TriggerExecutor.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/trigger/backend/SpringSchedulerExecutionBackend.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/trigger/tools/SubscribeTriggerCodeactTool.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/trigger/config/TriggerAutoConfiguration.java
AssistantAgent/assistant-agent-extensions/src/main/java/com/alibaba/assistant/agent/extension/trigger/config/TriggerProperties.java
```

记笔记：

```text
SearchProvider 把外部信息来源正规化为 supports、search、getName 和 getExtendedParameters；扩展参数可以变成工具 schema，而不是靠 prompt 口头描述。
DefaultSearchFacade 默认聚合 PROJECT/KNOWLEDGE 等来源，按 sourceType 或 provider name 找 provider，单个来源失败不会中断整体搜索，结果按 score 合并并记录 duration/source_count/failed_sources。
UnifiedSearchCodeactTool 把多来源搜索暴露成统一工具：query、sources、limit 是显式输入，返回 SearchResultSet 和元数据；BaseSearchCodeactTool 则可以把单个 provider 适配成 CodeactTool。
ReplyChannelDefinition 把“回复用户”变成输出渠道契约：channelCode、description、supported parameters schema、execute(context, params)、supportsAsync。
BaseReplyCodeactTool 会验证参数、补默认值、构造 ChannelExecutionContext，并把 user_id、trace_id、thread_id、channel metadata 传给 channel；它的 returnDirect/alwaysAvailable 说明回复是特殊输出边界，不只是普通工具。
Reply 模块只提供 factory 和基础设施，真实渠道定义由业务方提供。这点很重要：框架不应该假装知道所有目标世界的输出方式。
Dynamic HTTP/MCP 工具把 OpenAPI 或 MCP ToolCallback 适配成 CodeactTool，自动生成 input schema、ParameterTree、Python 调用模板和 target class；这让模型可写代码和实际工具调用保持同一个工具视图。
HttpDynamicCodeactTool 能处理 baseUrl、path/query/header/body、timeout 和响应体，但认证、权限、速率、安全策略基本仍是配置层责任，不能等同于安全边界。
McpDynamicToolsInstaller 从 Spring 上下文找 ToolCallbackProvider，把 MCP 工具注册进 CodeactToolRegistry；这说明“动态工具”容易把产品推向无限集成面。
TriggerDefinition 保存 triggerId、来源、事件协议、调度模式、条件函数、执行函数、放弃函数、函数代码快照、参数、会话快照、状态、过期和重试配置。
SessionSnapshot 保存 sessionId/user/tenant/channel、函数代码和上下文变量，用于触发器脱离当前 agent 体系独立执行；这对 feng 有启发，但命名和心智与 feng 的“无用户 session”冲突。
TriggerExecutor 恢复快照、构建 CodeContext/ToolRegistry、复用 GraalCodeExecutor 执行条件函数、动作函数和放弃函数；默认 allowIO=false、allowNativeAccess=false、timeout=30000。
SpringSchedulerExecutionBackend 支持 CRON/FIXED_DELAY/FIXED_RATE/ONE_TIME，执行时写 TriggerExecutionRecord，包括 backendTaskId、threadId、start/end、status、error、outputSummary。
TriggerManager 负责 subscribe/unsubscribe/pause/resume/list/detail/history，但 validateDefinition 只校验少数字段，cron 格式、确认、过期、重试等语义没有完全闭合。
SubscribeTriggerCodeactTool 的 schema 要求 name/schedule_mode/schedule_value，但 execute_function 在 schema 中不是 required，而 TriggerManager 又要求 executeFunction 必填，存在工具 schema 和运行校验不一致。
```

写小结：

AssistantAgent 第 4 轮说明：一个 agent 对外提供能力，不能只说“支持对话”或“支持工具”。它需要把外部信息来源、输出渠道、外部动作、运行时唤醒都正规化成契约：输入 schema、输出 schema、来源、上下文、权限、执行记录、失败记录和取消/暂停边界。

但这一轮也强化了反向判断：AssistantAgent 的能力外壳已经很平台化。Search、Reply、Dynamic HTTP/MCP、Trigger 都是优秀的企业集成模块，可如果 feng 原样吸收，feng 会从“智能行为成长并 hatch 成可复制产物”滑向“agent integration framework”。对 feng 来说，重要的不是支持多少集成，而是 hatch 产物必须清楚声明自己如何被调用、能读什么、能做什么、输出到哪里、如何被观察、如何回流、失败如何留下证据。

feng 能学的原则：

```text
hatch 结果必须带能力契约：调用方式、输入 schema、输出/event schema、外部动作边界、资源/鉴权 profile、日志和反馈路由。
外部信息来源要被声明和选择，不能把所有搜索源/MCP/OpenAPI 默认暴露给模型。
输出渠道是第一等边界；boss-agent、小说 agent、音乐 agent 的“回复”可能分别是游戏事件、章节文件、MIDI/歌词草稿，而不一定是聊天文本。
运行时唤醒/调试/自动更新可以作为开发者模式或目标世界模式存在，但默认不应成为用户必须理解的复杂 trigger 系统。
自动运行必须留下执行记录、失败证据、输出摘要和取消/暂停边界；否则“跑起来”不等于“可用”。
模型可见的工具/API 与运行时真正可调用的工具/API 必须一致，并且这种一致性应成为文件化证据。
```

如果照搬会带偏 feng：

```text
feng 会变成 OpenAPI/MCP/Search/Reply/Trigger 拼装平台，正好违背“防止 feng 变成被调研对象牵着走的拼装产品”。
动态工具转换不能被包装成安全能力；认证、权限、速率、数据范围和外部副作用仍需要单独边界。
Search/Reply/Trigger 的模块化很诱人，但会让产品以“支持更多 connector”为价值中心，而不是以“行为是否真的成长成熟”为中心。
Trigger 的 SessionSnapshot 命名会把 feng 拉回 session 心智；feng 需要的是 grow/runtime snapshot，而不是用户可管理的多 session。
工具 schema 与运行时校验不一致会让 hatch contract 变脆；feng 必须避免“文档说能调用，运行时才报错”的契约错位。
```

再看代码：

回看 `UnifiedSearchCodeactTool`、`BaseReplyCodeactTool`、`HttpDynamicToolFactory`、`McpDynamicToolsInstaller` 和 `TriggerExecutor`，确认这些模块的共同点是“把目标世界能力正规化成可调用工具/渠道/触发器”。它们能帮助 feng 未来定义 hatch 产物的对外能力契约，但不能直接决定 feng 的产品形态。

下一轮问题：

```text
AssistantAgent 的管理控制台、运行观测、配置样例、测试和发布/路线图如何支撑它作为框架的可用性？
它有哪些地方证明“框架已成熟”，哪些地方只是模块骨架？
完成第 5 轮后，需要更新 AssistantAgent 在总笔记中的纠偏总结：学习它的 schema/contract/adapter 思想，避免复制它的企业平台形态。
```

## AssistantAgent / 第 5 轮

看代码/文档：

```text
AssistantAgent/assistant-agent-management/src/main/java/com/alibaba/assistant/agent/management/controller/ExperienceManagementController.java
AssistantAgent/assistant-agent-management/src/main/java/com/alibaba/assistant/agent/management/internal/RepositoryBackedExperienceManagementService.java
AssistantAgent/assistant-agent-management/src/main/java/com/alibaba/assistant/agent/management/controller/SkillExchangeController.java
AssistantAgent/assistant-agent-management/src/main/java/com/alibaba/assistant/agent/management/internal/SkillPackageParser.java
AssistantAgent/assistant-agent-management/src/main/java/com/alibaba/assistant/agent/management/internal/InMemorySkillExchangeService.java
AssistantAgent/assistant-agent-management/src/main/java/com/alibaba/assistant/agent/management/internal/SkillContentClassifier.java
AssistantAgent/assistant-agent-management/src/main/java/com/alibaba/assistant/agent/management/config/ExperienceConsoleAutoConfiguration.java
AssistantAgent/assistant-agent-management/src/main/java/com/alibaba/assistant/agent/management/config/ExperienceConsoleProperties.java
AssistantAgent/assistant-agent-start/src/main/resources/application-reference.yml
AssistantAgent/assistant-agent-start/src/main/resources/application.yml
AssistantAgent/assistant-agent-extensions/src/main/resources/application-extension-example.yml
AssistantAgent/assistant-agent-extensions/src/main/resources/application-learning-example.yml
AssistantAgent/assistant-agent-extensions/src/main/resources/application-evaluation-example.yml
AssistantAgent/assistant-agent-start/src/main/resources/mcp-servers.json.example
AssistantAgent/assistant-agent-management/src/test/java/com/alibaba/assistant/agent/management/internal/SkillPackageParserTest.java
AssistantAgent/assistant-agent-management/src/test/java/com/alibaba/assistant/agent/management/internal/InMemorySkillExchangeServiceTest.java
AssistantAgent/assistant-agent-extensions/src/test/java/com/alibaba/assistant/agent/extension/experience/disclosure/ExperienceDisclosureServiceTest.java
AssistantAgent/assistant-agent-extensions/src/test/java/com/alibaba/assistant/agent/extension/learning/extractor/ExperienceLearningExtractorTest.java
AssistantAgent/assistant-agent-extensions/src/test/java/com/alibaba/assistant/agent/extension/reply/tools/BaseReplyCodeactToolTest.java
AssistantAgent/assistant-agent-extensions/src/test/java/com/alibaba/assistant/agent/extension/prompt/PromptContributorModelHookTest.java
AssistantAgent/assistant-agent-extensions/src/test/java/com/alibaba/assistant/agent/extension/experience/fastintent/FastIntentServiceTest.java
AssistantAgent/assistant-agent-core/src/test/java/com/alibaba/assistant/agent/core/executor/GraalCodeExecutorStringLiteralTest.java
AssistantAgent/assistant-agent-autoconfigure/src/test/java/com/alibaba/assistant/agent/autoconfigure/tools/WriteCodeToolRequestDeserializationTest.java
AssistantAgent/assistant-agent-core/src/test/java/com/alibaba/assistant/agent/core/tool/definition/ShapeExtractorTest.java
AssistantAgent/assistant-agent-core/src/main/java/com/alibaba/assistant/agent/core/observation/CodeactObservationDocumentation.java
AssistantAgent/assistant-agent-core/src/main/java/com/alibaba/assistant/agent/core/model/ToolCallRecord.java
AssistantAgent/assistant-agent-core/src/main/java/com/alibaba/assistant/agent/core/model/ExecutionRecord.java
AssistantAgent/assistant-agent-core/src/main/java/com/alibaba/assistant/agent/core/observation/ObservationState.java
AssistantAgent/README_zh.md
AssistantAgent/ROADMAP.md
AssistantAgent/CHANGELOG.md
```

记笔记：

```text
README_zh 把项目定位为企业级智能助手框架，核心卖点是 Code-as-Action、多维评估、Prompt 动态组装、统一经验体系、管理后台、快速响应。
ROADMAP 明确当前阶段是“半集成框架”，后续才是能力下沉、生产就绪、可视化配置、零代码接入；这说明它的终态是企业助手平台，不是轻量成长系统。
ExperienceManagementController 提供经验 list/search/stats/get/assets/resummarize/create/update/delete，并支持 tenant/includeGlobal 过滤；管理对象是经验条目，而不是成长过程。
RepositoryBackedExperienceManagementService 负责将 Experience 转成可管理 VO，支持 keyword、tenant、type 过滤，TOOL 经验会解析 toolInvocationPath。
SkillExchangeController 支持 skill markdown 和 skill package 的 preview/import/export/import-package/export-package；导入包时有 conflictStrategy，冲突但未指定策略时不落库。
SkillPackageParser 支持 tgz/zip，识别 SKILL.md、package.json、scripts、references、assets，单文件最大 10MB；路径会做 npm package 前缀和单层目录前缀归一。
SkillContentClassifier 把 references/、agents/*.md、根目录 md/yaml 分到 reference，把 scripts/assets/evals/package.json 分到 asset；这和第 3 轮的渐进披露设计呼应。
InMemorySkillExchangeService 会把 skill package 转成 REACT experience 和可选 TOOL experience，CLI 绑定来自 package.json 的 cli/meow/a1 等 namespace，并生成 provider、runnerImage、sandboxTemplate、authProfile、commandAllowPattern、pipeAllowlist 等 tool artifact。
skill package 导入导出已经开始处理 references/assets、contentHash、description cache、base64 asset、package.json 重建、冲突替换/保留等生命周期问题。
ExperienceConsoleAutoConfiguration 默认 console disabled，只有 `experience.console.enabled=true` 才导入 controller；如果有 ChatModel 就用 LlmReferenceSummarizer，否则 Noop。
配置样例存在漂移：application-reference 里 trigger execution 写 `timeout-seconds`，代码里是 `executionTimeout`；extension 示例也有 `data-source/max-experience-count` 等和当前 properties 不完全一致的旧字段。
测试覆盖重点在经验披露、skill 包导入冲突、reply context 传递、prompt contributor 去重、fast intent 字符串匹配、Graal 字符串转义、WriteCode 参数兼容、返回 shape 合并。
Learning 测试很薄，主要验证 ExperienceLearningExtractor 对 TOOL 类型解析和拒绝旧 CODE 类型，不能证明自动学习闭环成熟。
CHANGELOG 0.1.3 的重点是 OpenTelemetry observability、tool call tracing、PromptContributor 重构；ExecutionRecord 保存 callTrace/replyToUserTrace，Observation 文档定义 hook/interceptor/react/execution/codegen/tool call 的标准属性。
ObservationState 仍是运行期状态和 telemetry，不是 file-native 证据；对 feng 来说 trace 最终也应该能落成文件。
```

写小结：

AssistantAgent 第 5 轮纠偏后的结论是：它最成熟的地方不是“自学习”，而是企业框架化能力：经验/skill 管理、包导入导出、契约适配、可观测性、工具调用轨迹和配置化开关。它能让开发者把一个企业助手搭起来，并逐步接入真实知识库、渠道、存储、MCP/HTTP 工具和触发器。

但它的自我演进闭环并不够强。README 和 ROADMAP 把“自动学习、越用越聪明”作为卖点，但代码里 learning 链路仍有不少 TODO，测试也没有证明采纳、验证、回滚、冲突治理已经闭合。对 feng 来说，这一点非常重要：不能因为一个优秀框架有 learning 模块，就把“记录经验”误判成“能力成长”。

feng 能学的原则：

```text
hatch 包需要可管理、可导入、可导出、可预览、可检测冲突，而不是只把文件复制到目标目录。
package 内部应区分给模型看的 reference、给运行时用的 asset/script/eval、给安装器用的 metadata。
导入/更新必须有冲突策略、版本、来源、哈希、描述和可回滚的判断材料。
可观测性不能只是外部 telemetry；grow/hatch 的关键 trace、执行记录、工具调用、失败和下一轮 message list 都应该落成文件证据。
配置样例和实际代码会漂移，因此 feng 的 hatch contract 必须能被机器检查，而不是只靠 README 解释。
学习闭环要区分“记录”“候选”“采纳”“替换默认能力”“发布”，不能直接把经验存储当成自我演进。
```

如果照搬会带偏 feng：

```text
feng 会变成企业助手管理后台：经验 CRUD、租户、多渠道、知识库、插件、触发器、监控面板。
skill package 双向转换很诱人，但 feng 的核心不是把所有能力都转成 skill 市场，而是让具体智能行为在目标世界中成熟并可复制。
ROADMAP 式的平台愿景会把 feng 推向“零代码配置平台”，这和当前想要的轻、file-native、到处运行的感觉冲突。
如果只学习它的 README 口号，会高估 learning 模块成熟度；必须以代码和测试为准。
配置驱动不能替代产品心智。用户不应该为了 grow 一个行为先理解一堆 Spring properties。
```

再看代码/文档：

回看 `ROADMAP.md`、`ExperienceConsoleAutoConfiguration`、`InMemorySkillExchangeService` 和测试集合，确认 AssistantAgent 的产品重心是开发者二开和企业平台化。它可以为 feng 提供 contract/package/trace/lifecycle 的工程证据，但不能作为 feng 产品终态的模板。

下一轮问题：

```text
AssistantAgent 已完成 5 轮。后续更新总笔记时，需要把它归纳为“代码编排 + 企业能力适配 + 经验披露/管理”的样本，而不是“可直接参考的 feng 架构”。
下一步进入 learn-claude-code 5 轮，重点看它如何解释/复现 Claude Code 的 agent loop、tool protocol、状态管理和上下文策略。
```

## learn-claude-code / 第 1 轮

看代码：

```text
learn-claude-code/README-zh.md
learn-claude-code/README.md
learn-claude-code/s01_agent_loop/code.py
learn-claude-code/s01_agent_loop/README.md
learn-claude-code/s02_tool_use/code.py
learn-claude-code/s02_tool_use/README.md
learn-claude-code/s03_permission/code.py
learn-claude-code/s03_permission/README.md
learn-claude-code/s04_hooks/code.py
learn-claude-code/s04_hooks/README.md
```

记笔记：

```text
README 的核心立场很强：agency 来自模型训练，产品要做的是 harness，不是用工作流编排“发明智能”。
s01 的核心 loop 极小：messages -> client.messages.create -> append assistant -> 如果 stop_reason != tool_use 就结束 -> 执行 tool_use -> append tool_result -> loop。
s01 只有 bash 工具，system prompt 给当前目录，run_bash 有非常粗糙的危险命令字符串拦截、timeout 和输出截断。
s02 不改 loop，只增加 read/write/edit/glob 工具、safe_path 和 TOOL_HANDLERS dispatch map；工具定义告诉模型能做什么，handler 执行真实动作。
s02 的深挖文档强调生产版会做并发安全判断、连续 batch 分区、schema/输入验证、工具结果落盘，而教学版刻意保持简单。
s03 仍不改 loop，只在工具执行前插入 check_permission；权限分硬拒绝、规则匹配、用户审批三道门，硬拒绝优先。
s03 文档承认字符串 deny list 不是可靠安全机制，并指出生产版权限来自多来源规则、工具自检、hooks、分类器、权限冒泡等。
s04 把权限和日志从 loop 中拿出来，挂到 HOOKS 注册表；事件包含 UserPromptSubmit、PreToolUse、PostToolUse、Stop。
s04 的 trigger_hooks 简化为“非 None 返回值阻塞/续跑”；生产版 hook 事件更多，HookResult 字段更复杂，且 hook allow 不能绕过 settings deny/ask。
```

写小结：

learn-claude-code 第 1 轮的价值，是把“agent core”和“harness 机制”拆得非常干净。核心 loop 本身不复杂，复杂度来自工具、权限、hook、上下文、任务、后台、团队等外围机制。它的好处是工程判断很清晰：不要让每个扩展都改主循环，主循环只负责让模型行动，harness 负责边界和执行。

但这也是风险：README 的语言有强烈立场，容易把 feng 带向“只要给模型好 harness 就行”的简化。feng 不只是运行一个现成模型完成任务，还要把行为成长过程文件化、验证化、可 hatch、可回流。因此 feng 可以学习 harness 分层，但不能把 grow 简化成“多跑几轮 agent loop”。

feng 能学的原则：

```text
grow 内部的 LLM loop 应该尽量小，复杂度应落在输入准入、工具/世界接口、权限、证据、反馈路由和文件化状态上。
增加能力时优先增加工具/skill/contract adapter，而不是不断改主循环。
权限、hook、日志、反馈采集应是 harness 机制，不能只靠 system prompt 约束模型。
硬拒绝优先于自动采纳；权限被拒和操作失败都应该成为成长证据。
hook 可以表达扩展点，但强边界不能交给可任意修改的 hook 覆盖。
```

如果照搬会带偏 feng：

```text
feng 会被做成 Claude Code 教学版复刻：一个 loop + tools + hooks，而忽略 grow/hatch 的产品语义。
“agency 来自模型”是对的，但不能由此推出 feng 不需要定义成长证据、DoD、hatch contract 和回流采纳边界。
教学版的权限和 hooks 都是简化模型，不能作为安全或可信自演进的证据。
Bash-first 的编码 agent 心智不适合直接迁移到游戏 boss、小说、音乐等目标世界。
```

再看代码：

回看 s01 到 s04，确认每章都尽量保留同一个 loop，只在 loop 外侧加机制。这个原则值得 feng 学：grow 不应该变成越来越神秘的巨大 loop，而应该保持核心运行可理解，把复杂度放进可审计的文件化 harness 组件。

下一轮问题：

```text
TodoWrite、Subagent、Skill Loading、Context Compact 如何处理计划、隔离、按需知识和上下文压缩？
这些机制哪些能帮助 feng 的 grow 单元，哪些会把 feng 带成 coding-agent 工作流？
```

## learn-claude-code / 第 2 轮

看代码：

```text
learn-claude-code/s05_todo_write/code.py
learn-claude-code/s05_todo_write/README.md
learn-claude-code/s06_subagent/code.py
learn-claude-code/s06_subagent/README.md
learn-claude-code/s07_skill_loading/code.py
learn-claude-code/s07_skill_loading/README.md
learn-claude-code/skills/code-review/SKILL.md
learn-claude-code/skills/agent-builder/SKILL.md
learn-claude-code/skills/pdf/SKILL.md
learn-claude-code/s08_context_compact/code.py
learn-claude-code/s08_context_compact/README.md
learn-claude-code/s09_memory/code.py
learn-claude-code/s09_memory/README.md
learn-claude-code/s10_system_prompt/code.py
learn-claude-code/s10_system_prompt/README.md
```

记笔记：

```text
s05 的 todo_write 只管理计划，不执行动作；CURRENT_TODOS 在内存里，状态为 pending/in_progress/completed，并有 3 轮未更新就注入 reminder 的教学机制。
s05 文档区分 TodoWrite V1 和 Task System V2：V1 是内存平铺列表，V2 是文件持久化、blockedBy 依赖图、锁、Create/Get/Update/List 多工具。
s06 的 task 工具 spawn 子 agent，子 agent 用 fresh messages[]、独立 SUB_SYSTEM、基础工具、30 轮限制，并且没有 task 工具，防递归；只把最终摘要返回父 agent，中间历史丢弃，文件系统副作用保留。
s06 文档指出生产版还有 normal/fork/general-purpose 三种模式，fork 主要为 prompt cache，权限以 bubble 模式冒泡到父终端。
s07 启动时扫描 skills/，只把 name/description 目录注入 SYSTEM；完整 SKILL.md 通过 load_skill 工具按需返回。注册表查找避免路径遍历。
s07 的 skills 证明 skill 是可复用指导/知识包，不是能力本身。code-review 是检查清单与输出格式，pdf 是操作知识，agent-builder 则带有强烈“信任模型、少工程”的理念。
s08 的压缩顺序是 tool_result_budget -> snip_compact -> micro_compact -> compact_history。大工具结果先落盘到 `.task_outputs/tool-results/`，完整 transcript 写 `.transcripts/`，活跃上下文只保留摘要/预览。
s08 强调顺序不能换：先 budget 再 micro，否则旧大结果已经被占位，无法落盘保留完整内容。
s09 的 memory 是 `.memory/` 文件仓库：MEMORY.md 作为索引，每条 memory 是带 frontmatter 的 Markdown，类型 user/feedback/project/reference。
s09 每轮用 LLM side-query 从 name/description 中选择最多 5 条相关记忆，失败时降级关键词匹配；每轮结束后从 pre-compression snapshot 提取新记忆，文件多时 consolidate。
s09 文档区分 User Memory 和 Session Memory：前者跨会话，后者跨 compact 维持当前会话连续性。
s10 把 system prompt 拆成 section，运行时根据真实状态组装，不从消息关键词猜；缓存用 json.dumps 的确定性 key，说明 prompt 是状态编译结果。
```

写小结：

learn-claude-code 第 2 轮展示的是上下文治理，而不是新 agent 类型。计划、子 agent、skill、压缩、memory、system prompt 都在解决同一个问题：不要让所有事实、知识和中间过程挤进一个活跃 messages[]。真正的工程分层是：计划状态、隔离工作、按需知识、完整 transcript、活跃摘要、长期 memory、运行时 prompt section。

这对 feng 的 file-native 概念非常重要。feng 说所有关键运行产物都要能找到，但这不等于全部都进入下一轮 LLM loop。下一轮 message list 应该是从 grow 单元的文件化状态编译出来的活跃表示；完整证据、transcript、tool result、memory、skill 和 hatch candidate 应该各有位置。

feng 能学的原则：

```text
grow 单元需要计划/DoD 状态，但不能只做一张临时 todo；它应文件化、可恢复、能和 hatch readiness 对齐。
子过程可以隔离上下文，只回传摘要/证据/产物路径；但权限和反馈路由不能因为隔离而跳过。
skill 应分两级：目录/描述常驻，正文/引用按需进入 message list。
压缩应分层：大结果落盘、旧结果占位、对话裁剪、LLM 摘要、应急压缩；完整记录不能被摘要替代。
memory/feedback/skill/grow-state 要分层：长期偏好、项目事实、成长证据、下游上报和默认回流规则不是同一种东西。
system prompt/message list 应由真实文件状态和运行状态编译，而不是靠关键词猜测或临时拼接。
```

如果照搬会带偏 feng：

```text
feng 会变成 coding-agent 上下文管理教程，忽略目标世界行为成长。
TodoWrite 是计划工具，不是成长证据；不能把“列了 todo”当作 grow 成熟。
Subagent 的 fresh messages[] 容易诱导多 agent 化；feng 需要的是隔离工作边界，不是 agent team 复杂度。
agent-builder skill 的“信任模型，别过度工程”对普通 harness 有启发，但对自我演进产品不够。feng 必须额外要求证据、验证、版本和回滚。
Memory 自动提取如果没有采纳边界，会重复 AssistantAgent 的风险：记录变成污染。
```

再看代码：

回看 s08/s09，确认完整 transcript 和 memory 文件在活跃上下文外存在，而模型看到的是索引、摘要、占位和相关摘取。这和 feng 的 file-native 要求高度一致：文件是事实来源，message list 是当前轮编译表示。

下一轮问题：

```text
Error Recovery、Task System、Background Tasks、Cron 如何让 agent 从一次性会话变成长任务执行环境？
哪些“长期运行”机制适合 feng 的 grow/debug/update，哪些会把 feng 做成任务调度器？
```

## learn-claude-code / 第 3 轮

看代码：

```text
learn-claude-code/s11_error_recovery/code.py
learn-claude-code/s11_error_recovery/README.md
learn-claude-code/s12_task_system/code.py
learn-claude-code/s12_task_system/README.md
learn-claude-code/s13_background_tasks/code.py
learn-claude-code/s13_background_tasks/README.md
learn-claude-code/s14_cron_scheduler/code.py
learn-claude-code/s14_cron_scheduler/README.md
```

记笔记：

```text
s11 的错误恢复不改变工具和主循环结构，只把 LLM 调用包进恢复策略：max_tokens 先 8K->64K 升级，仍截断才追加截断输出和续写提示；prompt_too_long 触发 reactive compact；429/529 走指数退避和抖动，连续 529 可切换 fallback model。
s11 的关键细节是“何时不写入 messages”：第一次 max_tokens 升级不追加截断输出，而是保持原请求重试，避免把半截输出污染历史。
s11 文档列出 CC 真实 reason/transition 远多于教学版，说明长期 agent 不是只有成功/失败，而是有很多可恢复、可解释、可终止的中间状态。
s12 把 TodoWrite 和 Task System 明确分开：TodoWrite 是当前执行清单，Task System 是 `.tasks/{id}.json` 持久化任务图，有 blockedBy、owner、claim、complete 和跨会话恢复。
s12 教学版没有环检测、release、锁、高水位 ID；文档补充真实 CC 有文件锁、列表锁、高水位标、TaskCreate/Get/Update/List、fs.watch、ownership 和 shutdown unassign。
s13 让慢操作后台执行：bash schema 增加 run_in_background，模型显式请求优先，关键词启发式只是兜底；后台完成后以 `<task_notification>` 注入，而不是复用原 tool_use_id。
s13 的通知语义很重要：原始 tool_use 已经用占位 tool_result 闭合，后台完成是新的外部事件。真实 CC 通过 message queue 管理通知优先级和交付时机。
s14 把时间触发拆成 Scheduler、Queue、Queue Processor、Consumer 四层：调度线程只生产触发，队列解耦交付，processor 在 agent 空闲时启动一轮，agent_loop 只消费已触发消息。
s14 的 durable 只意味着任务定义写入 `.scheduled_tasks.json` 并在进程重启后恢复；进程关闭时并不会继续调度。真正脱离进程的定时需要系统 crontab/systemd。
s14 真实 CC 还有项目级 scheduled_tasks.json、session-only 任务、锁、防重复触发、抖动、自动过期、MAX_JOBS、低 QoS workload 和 feature flag 门控。
```

写小结：

learn-claude-code 第 3 轮展示的是长期运行外壳，而不是自我成长本身。错误恢复让一次 LLM 调用失败后可分类重试；任务系统让目标拆解和进度跨会话可恢复；后台任务让慢操作不阻塞主循环；cron 让外部时间可以生产新的工作。这些都让 agent 更像一个可运行的工作环境，但它们不会自动产生“学会了”的能力。

这对 feng 的判断很关键。feng 的 grow 需要这些机制，因为成长过程一定会遇到失败、长任务、反馈等待、调试回流和定时检查；但 feng 不能因此变成任务调度器、CI 管理器或后台队列产品。grow 的核心仍然应该是目标世界行为在证据、反馈、验证和 hatch contract 下逐步成型，任务/后台/cron 只是承载这个过程的运行韧性。

feng 能学的原则：

```text
grow 需要恢复策略文件化：每次截断、压缩、重试、fallback、终止原因都应该成为可审计证据。
第一次输出截断时不应盲目把半截内容写入下一轮能力状态；污染的中间输出要和可采纳成果分开。
grow 单元可以有任务图，但任务完成不等于能力成熟；任务状态必须和 DoD、验证、hatch readiness 对齐。
后台调试/测试/生成可以作为外部事件返回，且应有独立通知记录，不能混同于原始工具调用结果。
定时触发适合做周期性观察、回归验证、下游反馈拉取和自动更新检查，但必须声明“进程内调度”和“系统级调度”的边界。
调度、后台、任务、错误恢复都应服务于 file-native grow：输入、输出、原因、通知、下一轮 message list 和状态转换都要能在文件中找到。
```

如果照搬会带偏 feng：

```text
feng 会被做成“长任务执行器”：有任务图、后台线程、cron，但不知道什么叫行为成熟。
把 durable cron 误认为真正无人值守自我演进，会遮蔽进程存活、权限、凭据、外部环境和失败恢复这些现实边界。
把 Task System 当成 grow 的核心，会把成长等同于任务清单推进，忽略目标世界反馈和能力证据。
后台任务通知如果没有回流筛选，会把所有外部噪声都推进 grow，违反“不能让所有问题无脑往上游吸收”的原则。
错误恢复如果只为了继续跑，会制造无限重试和上下文污染；它必须有终止条件、证据记录和回滚/降级判断。
```

再看代码：

回看 s11 到 s14，确认这些章节都在维护同一个基本 loop：LLM 调用、工具执行、消息追加仍是核心，新增的是恢复、持久任务、异步通知和时间触发。它们对 feng 的意义不是“增加更多运行形态”，而是给 grow 的单一成长空间提供韧性和外部事件入口。

下一轮问题：

```text
Agent Teams、Team Protocol、Autonomous Agent、Worktree Isolation 如何处理多执行者、协议和隔离？
这些机制是否值得进入 feng，还是会把 feng 推向多 agent 编排和 coding team 复刻？
```

## learn-claude-code / 第 4 轮

看代码：

```text
learn-claude-code/s15_agent_teams/code.py
learn-claude-code/s15_agent_teams/README.md
learn-claude-code/s16_team_protocols/code.py
learn-claude-code/s16_team_protocols/README.md
learn-claude-code/s17_autonomous_agents/code.py
learn-claude-code/s17_autonomous_agents/README.md
learn-claude-code/s18_worktree_isolation/code.py
learn-claude-code/s18_worktree_isolation/README.md
```

记笔记：

```text
s15 的团队机制核心不是“多 agent 更聪明”，而是文件收件箱 MessageBus：每个 agent 一个 `.mailboxes/{name}.jsonl`，send 是 append JSON，read 是消费式读取并删除。
s15 的队友是后台线程，有独立 system prompt、独立 messages、简化工具集和最大轮次限制；Lead 通过 inbox 注入把队友消息变成下一轮上下文。
s15 文档里真实 CC 没有中央消息总线，直接写 `~/.claude/teams/{team}/inboxes/`，并用 proper-lockfile 做并发写保护；队友不能再 spawn 队友，防止递归团队化。
s15 的真实消息类型很多，包括 idle_notification、permission_request/response、plan approval、shutdown、task_assignment、permission update、sandbox permission、teammate_terminated 等，说明团队协作主要是协议治理。
s16 把松散文本消息变成 request-response 协议：ProtocolState 记录 request_id、type、sender、target、status、payload；response 必须按 request_id 匹配，并校验类型。
s16 的 shutdown 和 plan_approval 共用同一种 pending -> approved/rejected 状态机。关键点是请求、响应、状态转换都可追踪，而不是让模型靠自然语言记住“刚才谁批准了什么”。
s16 教学版只演示计划审批消息流，没有真正拦截未批准的 bash/write_file；真实 CC 有 permission gating，未批准高风险操作会被挡住。
s16 统一 consume_lead_inbox，避免 check_inbox 工具把消息读走但协议状态没有更新；这是文件消息系统里很实际的坑。
s17 的“自主”是空闲时轮询 inbox 和任务板，发现可认领任务就 claim，而不是自我设定目标。它仍然受任务图、依赖、owner、shutdown、超时等外壳约束。
s17 的 scan_unclaimed_tasks 找 pending、无 owner、can_start 的任务；真实 CC 还用 task watcher、500ms mailbox 轮询、任务文件锁和 task-list 锁避免并发认领。
s17 的 idle 阶段优先处理 shutdown_request，再看普通 inbox 和任务板；这说明自治执行者必须保留外部终止和控制通道。
s18 用 git worktree 解决“在哪干”的问题：任务和目录隔离分开，create_worktree 创建独立分支/目录，bind_task_to_worktree 只写任务字段，不改变 pending 状态。
s18 的队友认领带 worktree 的任务后，bash/read/write 的 cwd 切到对应 worktree；任务完成后 cwd 清空。
s18 的 remove_worktree 默认拒绝删除有未提交改动或未推送提交的目录，keep_worktree 则保留给人工 review；生命周期写入 `.worktrees/events.jsonl`。
s18 文档指出真实 CC 的 worktree 与 task 没有强绑定，worktree 状态写入 session transcript；教学版的 task.worktree 是简化绑定。
```

写小结：

learn-claude-code 第 4 轮的核心价值是：并发协作必须被文件化、协议化和隔离化。文件收件箱让跨执行者通信可观察；request_id 协议让请求和响应可追踪；空闲认领让执行者减少人工分配；worktree 让并行修改不会互相覆盖。这些机制很工程化，也很容易误导 feng。

误导点在于，“多 agent 团队”和“自治认领任务”并不是 feng 的产品目标。feng 要的是一个目标智能行为在 grow 单元里逐步成熟，然后 hatch 成可复制交付物。多执行者、收件箱、协议和 worktree 只应该服务于 grow 过程中的隔离实验、反馈回流、调试运行、候选版本审查，而不是把 feng 做成 Claude Code team / swarm 产品。

feng 能学的原则：

```text
grow/debug/hatch 之间的通信应有结构化协议，至少要有 request_id、type、status、payload、source、target、created_at 和可追踪文件记录。
下游 agent 或 hatch 结果上报问题时，不能只丢自然语言日志；应该以反馈/问题/证据/建议/采纳请求等类型进入回流队列。
任何“审批”必须绑定执行门控。只记录 plan approved 而不拦截高风险动作，是概念上不可信的。
文件收件箱适合 feng 的 file-native 思路，但必须避免读走即丢、并发写丢失、消息没有被路由就被消费等问题。
自动认领任务可以用于 grow 内部的工作推进，但任务来源和可认领条件必须来自 grow 目标/DoD/反馈边界，不能让执行者自己无限扩张目标。
候选修改、调试运行和 risky experiment 应该在隔离目录/worktree 中完成，并保留事件日志、差异、测试结果和 keep/remove 决策。
graceful shutdown、rollback、keep for review 这类生命周期协议，比“跑完就复制”更接近可信 hatch。
```

如果照搬会带偏 feng：

```text
feng 会变成多 agent 编排器：Lead、teammate、mailbox、shutdown、plan approval、worktree 都齐了，但产品用户不知道自己在 grow 什么能力。
“自主认领任务”会被误读成“自我演进”。实际上它只是从已有任务板拿活；任务板怎么来、是否合理、是否该向上游吸收，才是 feng 的核心问题。
文件 mailbox 如果没有反馈过滤和采纳边界，会把所有下游噪声变成 grow 输入，正好违背我们想设计多层回流环节的原因。
worktree 隔离很适合 coding 场景，但小说、音乐、游戏 boss 不一定都是 git 分支；feng 概念层只能保留“隔离候选运行空间”，不能绑定为唯一形态。
团队协议容易把 feng 带成“协作产品”，而不是“file-native 成长产品”。
```

再看代码：

回看 s15 到 s18，确认这些章节的价值不在“队友数量”，而在四个可复用抽象：文件化 inbox、结构化协议、受控 idle/claim、隔离工作空间。对 feng 来说，这些都应该降级为 grow 内部 skill/harness 能力，而不是进入产品第一心智。

下一轮问题：

```text
MCP Plugin、综合版本和测试如何处理外部工具接入、端到端集成、教学仓库边界和真实可复用性？
最终总结 learn-claude-code 时，需要把它作为 Claude Code harness 教学样本，而不是 feng 架构蓝本。
```

## learn-claude-code / 第 5 轮

看代码：

```text
learn-claude-code/s19_mcp_plugin/code.py
learn-claude-code/s19_mcp_plugin/README.md
learn-claude-code/s20_comprehensive/code.py
learn-claude-code/s20_comprehensive/README.md
learn-claude-code/tests/test_agents_smoke.py
learn-claude-code/tests/test_s_full_background.py
learn-claude-code/agents/s_full.py
learn-claude-code/README-zh.md
```

记笔记：

```text
s19 的 MCPClient 是 mock：register 模拟 tools/list，call_tool 调 Python handler 模拟 tools/call；教学价值在发现、命名、组装、调用流程，不在真实 transport。
s19 的 connect_mcp 连接后把 server 工具加入 mcp_clients；assemble_tool_pool 每轮把 BUILTIN_TOOLS 和 MCP 工具合并，命名为 `mcp__server__tool`，server/tool 名称先 normalize。
s19 去掉 prompt cache，因为工具池会随着 connect_mcp 动态变化；这说明 prompt/message list 缓存必须受“可见能力面”影响，不能只看对话内容。
s19 教学版只把 MCP 工具给 Lead，队友不继承；真实 CC 还有 6 种 transport、连接并发、配置优先级、OAuth、channel 反向通知、权限、重连和超时。
s19 的 readOnly/destructive 只是 description 文本标注，未进入权限执行。真实系统必须让工具 annotation 进入 permission/gating。
s20 的核心判断是“机制很多，循环一个”：用户输入、hook、cron/background、compaction、memory/skills/MCP、LLM、PreToolUse/permission、tool dispatch、PostToolUse、tool_result、Stop hooks 都挂在同一个 loop 的不同位置。
s20 的内置工具池有 27 个左右：基础文件/命令、todo、subagent、skill、compact、任务图、cron、团队协议、worktree、MCP。工具多，但循环仍以 has_tool_use(response.content) 而非只看 stop_reason 驱动。
s20 的 prepare_context 在 LLM 前跑 tool_result_budget、snip_compact、micro_compact、compact_history；call_llm 包 with_retry；max_tokens 第一次重试不追加截断输出，之后才 continuation。
s20 的 PreToolUse hook 负责危险 bash、用户审批和路径越界；但安全仍是教学简化，bash 本身很强，真正边界不能靠字符串规则。
s20 的 cron_autorun_loop 会在 daemon 线程中消费 cron_queue 并自动运行 agent_loop；同时主 CLI 用 agent_lock 防并发。它是进程内自动触发，不是系统级无人值守。
旧版 agents/s_full.py 是 12 章线的综合实现，包含 task-first、microcompact、background、team inbox、shutdown、plan gate、auto-claim 等；新版 s20 是新的 20 章合体版。
tests/test_agents_smoke.py 只 py_compile 旧版 agents/*.py；test_s_full_background.py 只 mock import `agents/s_full.py` 并验证 BackgroundManager 在 result=None 时返回 running placeholder。
测试说明仓库主要证明“脚本能编译”和一个局部回归，不证明多 agent、worktree、MCP、cron、permission、error recovery 的生产正确性。
README-zh 的立场非常强：agency 来自模型，agent 产品是模型 + harness；这个立场能防止用流程图假装智能，但也容易低估 grow/hatch 需要的证据、采纳和版本治理。
```

写小结：

learn-claude-code 第 5 轮完成后，我对它的定位很明确：它是一个高质量的 Claude Code harness 教学样本，不是生产 agent 框架，也不是 feng 的架构蓝本。它最强的地方是把复杂 agent 产品拆成“一个小 loop + 很多挂在 loop 周围的 harness 机制”，并且每个机制都有清晰位置：输入前、LLM 前、工具前、工具执行中、工具后、停止时、后台事件、外部能力接入。

但它的测试和实现边界也很清楚。MCP 是 mock，权限是教学式字符串/路径规则，团队 mailbox 没有完整并发锁，worktree 主要服务 coding 场景，测试没有覆盖大多数端到端行为。因此 feng 不能把它当成“照着做就能自我演进”的证据。它能提供的是 harness 分层语言和概念校准：成长需要一个可靠运行环境，但可靠运行环境本身不是成长。

feng 能学的原则：

```text
feng 的 grow loop 应该保持小而稳定；复杂度放在 file-native 状态、工具面、权限、反馈路由、验证、hatch contract、压缩和恢复机制上。
下一轮 message list 是编译产物，受技能目录、记忆/反馈、MCP/工具面、任务/DoD、外部通知、压缩结果和安全边界共同影响。
可见能力面变化时，prompt/message list 缓存必须失效或重新编译；不能让模型看见旧工具集。
外部工具接入应有命名空间、schema、权限 annotation、认证、配置来源、错误分类和生命周期；mock/文本标注不能当安全机制。
综合 harness 要能说明每个机制挂在 loop 的哪个阶段，否则最后会变成一团拼装。
测试要围绕 grow/hatch/debug/feedback/file-native 的真实闭环，而不能只测脚本能编译。
```

如果照搬会带偏 feng：

```text
feng 会变成 Claude Code 复刻：bash、read/write、todo、task、subagent、team、worktree、MCP 全都有，但缺少“智能行为成长”的产品语义。
README 的“造好 harness，模型会完成剩下的”对普通 agent 产品成立一部分，但对 feng 不够。feng 还必须定义成长目标、可验证证据、hatch readiness、反馈采纳、版本边界和回滚。
把 s20 的综合 harness 当终态，会让 feng 追逐功能完整度，而不是产品心智简单和 grow/hatch 的可信闭环。
MCP/插件能力很诱人，但会把 feng 推向工具生态平台；feng 应默认保守，只接目标世界需要的能力。
教学测试不足以证明自我演进可行，不能用“代码能跑”替代“能力可用、可验证、可复制”。
```

再看代码：

回看 README、s19、s20、旧版 s_full 和 tests，确认这个仓库的最可学之处是“harness 机制的位置感”。它帮 feng 避免两种误区：一是把智能写成流程编排，二是把所有机制揉进一个不可解释的大 loop。它不能替 feng 解决自我演进可信性，只能告诉 feng：运行外壳必须清楚、可检查、可扩展，并且不能抢掉产品核心。

下一步：

```text
全部仓库 5 轮调研已完成。下一阶段需要先产出 agent 设计学习总结文档，再进入 feng 设计前 5 轮复习/草稿/反思循环。
```

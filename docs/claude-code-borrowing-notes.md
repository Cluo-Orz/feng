# 可以从 Claude Code 借鉴哪些设计

本 note 的目的不是把 Claude Code 复制进 feng，而是把其中能增强 feng 核心诉求的 harness 设计提炼出来，再判断哪些应该 native 化到 feng。

阅读范围：

```text
learn-claude-code/README.md
learn-claude-code/README-zh.md
learn-claude-code/s01_agent_loop/ ... s20_comprehensive/
learn-claude-code/skills/
```

## 总原则

Claude Code 的主线是：

```text
Agency 来自模型，产品价值来自 harness。
机制可以很多，但 loop 只能有一个。
```

对 feng 的翻译应该是：

```text
Runtime Kernel 保持小。
Self Repo 表达成长出来的能力。
.feng State 表达长任务生命体征。
Git 表达 self 的代际成长。
```

因此，下面每个借鉴点都必须回到 feng 的四个对象中，不能膨胀成独立大系统。

## 1. 单一 Agent Loop

- 能力简介：LLM 看到 messages 和 tools，决定调用工具或结束；工具结果进入下一轮，循环本身不变。
- 能给 feng 带来什么帮助：确认 feng 的顶层 loop 不需要复杂工作流引擎；grow/check/execute 都应该挂在同一个 loop 上，只改变 mode、可写边界和 active tool pack。
- 目标位置：`learn-claude-code/s01_agent_loop/README.md:28`、`learn-claude-code/s01_agent_loop/README.md:87`、`learn-claude-code/s20_comprehensive/README.md:240`。

## 2. Harness 而不是“预设聪明 Agent”

- 能力简介：模型是决策者，harness 提供工具、知识、观察、行动接口和权限。
- 能给 feng 带来什么帮助：支撑 feng 的白板起点，不应该在模板里塞入领域能力；feng 应该让目标、工具和 world 在 workspace 中长出来。
- 目标位置：`learn-claude-code/README-zh.md:51`、`learn-claude-code/README-zh.md:54`、`learn-claude-code/README.md:162`。

## 3. Tool Schema 和 Handler 分离

- 能力简介：工具定义给模型看，handler 在 kernel 里执行；新增工具不改变 loop。
- 能给 feng 带来什么帮助：feng 的 bootstrap tools 和 grow 出来的领域 tools 都应进入统一 Tool Registry，再由 message compiler 选择 active tool pack。
- 目标位置：`learn-claude-code/s02_tool_use/README.md:28`、`learn-claude-code/s02_tool_use/README.md:101`、该章节源码示例的 tool handler 片段。

## 4. Tool Boundary 先于 Prompt 约束

- 能力简介：每次工具调用前经过权限检查，deny/ask/allow 是执行边界，不靠 prompt 劝模型守规矩。
- 能给 feng 带来什么帮助：permissions.yaml 必须是 tool call 边界；hatch 产物也必须用同一套 permission check，不允许 GUI 或脚本绕过。
- 目标位置：`learn-claude-code/s03_permission/README.md:24`、`learn-claude-code/s03_permission/README.md:93`、`learn-claude-code/s03_permission/README.md:174`、该章节源码示例的 permission check 片段。

## 5. Hooks 是 Loop 周围的少量插口

- 能力简介：UserPromptSubmit、PreToolUse、PostToolUse、Stop 覆盖一个 agent cycle 的关键节点。
- 能给 feng 带来什么帮助：feng 的 hook 不应变成能力本体；hook 只负责“什么时候介入”，能力仍由 skill/tool/check 表达。Stop hook 的防无限循环思想可用于长任务停止和自纠。
- 目标位置：`learn-claude-code/s04_hooks/README.md:47`、`learn-claude-code/s04_hooks/README.md:158`、`learn-claude-code/s04_hooks/README.md:241`、`learn-claude-code/s04_hooks/README.md:267`。

## 6. 当前计划和持久任务要分开

- 能力简介：TodoWrite 是当前会话的轻量计划；Task System 是文件持久化、带依赖和 owner 的任务图。
- 能给 feng 带来什么帮助：feng MVP 不必先做复杂任务系统，但 `.feng/state.yaml` 应表达当前 grow 的 progress；未来持久任务应作为 self/workspace 文件，不与即时 todo 混淆。
- 目标位置：`learn-claude-code/s05_todo_write/README.md:97`、`learn-claude-code/s05_todo_write/README.md:140`、`learn-claude-code/s12_task_system/README.md:29`、`learn-claude-code/s12_task_system/README.md:187`。

## 7. Subagent 的核心价值是上下文隔离

- 能力简介：子 agent 使用 fresh messages，执行子问题后只返回最终结论；fork 模式还能保持 cache-friendly 前缀。
- 能给 feng 带来什么帮助：feng 不应在 MVP 做多 agent，但可以借鉴“隔离 noisy exploration”的思想：大型阅读、review、搜索可以落 artifact，只把结论和引用回到主 context。
- 目标位置：`learn-claude-code/s06_subagent/README.md:35`、`learn-claude-code/s06_subagent/README.md:149`、`learn-claude-code/s06_subagent/README.md:155`、该章节源码示例的 subagent 调用片段。

## 8. Skill 两级加载

- 能力简介：system prompt 只放 skill catalog，完整 SKILL.md 在需要时通过工具加载。
- 能给 feng 带来什么帮助：直接对应 feng 的 token efficiency：stable prefix 放 skill/world index，完整 skill/world 片段按需进入动态后缀或 artifact refs，不能把全部 skill 塞进每轮 prompt。
- 目标位置：`learn-claude-code/s07_skill_loading/README.md:39`、`learn-claude-code/s07_skill_loading/README.md:58`、`learn-claude-code/s07_skill_loading/README.md:93`、`learn-claude-code/s07_skill_loading/README.md:170`。

## 9. Context Compact 是分层管线

- 能力简介：大 tool result 落盘、旧 tool result 微压缩、历史裁剪、LLM 摘要、prompt-too-long reactive compact 分层处理。
- 能给 feng 带来什么帮助：feng 的上下文控制不能只说“压缩”，必须定义顺序：artifact 化优先，摘要其次，低相关 skill/world 出局，仍超长才阻塞。
- 目标位置：`learn-claude-code/s08_context_compact/README.md:38`、`learn-claude-code/s08_context_compact/README.md:80`、`learn-claude-code/s08_context_compact/README.md:129`、`learn-claude-code/s08_context_compact/README.md:154`。

## 10. Memory 和 Artifact 不是同一类东西

- 能力简介：memory 是跨会话有用的知识，artifact 是运行证据；memory 通过索引常驻、内容按需加载。
- 能给 feng 带来什么帮助：feng 的 world/memory/artifact 必须分层：world 是稳定世界说明书，artifact 是证据，稳定经验经过 grow/check 后才写回 self repo。
- 目标位置：`learn-claude-code/s09_memory/README.md:24`、`learn-claude-code/s09_memory/README.md:26`、`learn-claude-code/s09_memory/README.md:151`、`learn-claude-code/s09_memory/README.md:249`。

## 11. System Prompt 运行时组装

- 能力简介：system prompt 由稳定 section 和按需 section 组装，并用真实状态决定是否加载 memory/skill/tool 等内容。
- 能给 feng 带来什么帮助：feng 的 prompt 不应是用户维护的散乱 prompt blocks；message compiler 根据 self repo、state、Git、latest event 编译 messages，并保持稳定前缀。
- 目标位置：`learn-claude-code/s10_system_prompt/README.md:39`、`learn-claude-code/s10_system_prompt/README.md:79`、`learn-claude-code/s10_system_prompt/README.md:121`、该章节源码示例的 system prompt 组装片段。

## 12. LLM 错误恢复是长任务基础能力

- 能力简介：max_tokens 升级/续写、prompt_too_long reactive compact、429/529 指数退避和 fallback model 是独立恢复路径。
- 能给 feng 带来什么帮助：feng 的 grow 是长任务，不能因为一次 provider 错误、上下文过长或输出截断就丢状态；恢复决策应写入 `.feng/events.jsonl` 和 artifacts。
- 目标位置：`learn-claude-code/s11_error_recovery/README.md:32`、`learn-claude-code/s11_error_recovery/README.md:48`、`learn-claude-code/s11_error_recovery/README.md:76`、`learn-claude-code/s11_error_recovery/README.md:91`。

## 13. Durable Task Graph 可作为未来成长任务板

- 能力简介：任务以文件存储，包含 blockedBy、owner、status；claim/complete 改变状态并解锁下游。
- 能给 feng 带来什么帮助：feng MVP 先用 `.feng/state.yaml` 表达长任务状态；当 grow 需要多目标并行或跨天工作时，可引入 `.feng/tasks/`，但不进入第一版核心。
- 目标位置：`learn-claude-code/s12_task_system/README.md:19`、`learn-claude-code/s12_task_system/README.md:59`、`learn-claude-code/s12_task_system/README.md:101`、`learn-claude-code/s12_task_system/README.md:253`。

## 14. 后台任务用通知回到 Loop

- 能力简介：慢命令先返回 placeholder tool_result，完成后以 task_notification 注入后续 turn。
- 能给 feng 带来什么帮助：feng 的 run_command 要能处理长命令，不阻塞整个 grow；MVP 可先记录 running artifact，后续把后台命令作为 `.feng/runs/` 生命周期补齐。
- 目标位置：`learn-claude-code/s13_background_tasks/README.md:36`、`learn-claude-code/s13_background_tasks/README.md:103`、`learn-claude-code/s13_background_tasks/README.md:126`、该章节源码示例的后台任务片段。

## 15. Cron/调度应被视为触发器，不是核心 loop

- 能力简介：调度线程只负责把到期任务放入队列，queue processor 在 agent 空闲时交给 agent_loop。
- 能给 feng 带来什么帮助：feng 后续可支持定时 grow/check/watch，但调度只能产生 latest event，不能成为第二套工作流系统。
- 目标位置：`learn-claude-code/s14_cron_scheduler/README.md:44`、`learn-claude-code/s14_cron_scheduler/README.md:158`、`learn-claude-code/s14_cron_scheduler/README.md:167`、`learn-claude-code/s14_cron_scheduler/README.md:185`。

## 16. 文件邮箱适合可观察的异步协作

- 能力简介：队友通过文件收件箱 JSONL 发送/读取消息，Lead 把 inbox 注入 history。
- 能给 feng 带来什么帮助：feng MVP 不做团队，但 `.feng/events.jsonl` 和 artifacts 的设计可以借鉴文件化消息流：可看、可追、可恢复。
- 目标位置：`learn-claude-code/s15_agent_teams/README.md:24`、`learn-claude-code/s15_agent_teams/README.md:41`、`learn-claude-code/s15_agent_teams/README.md:98`、`learn-claude-code/s15_agent_teams/README.md:145`。

## 17. 协议消息需要 request_id

- 能力简介：结构化请求/响应通过 request_id 关联，并用 pending/approved/rejected 状态跟踪。
- 能给 feng 带来什么帮助：permission request、config missing、用户确认、hatch 风险确认都应该可追踪；不是把审批埋进自由文本。
- 目标位置：`learn-claude-code/s16_team_protocols/README.md:28`、`learn-claude-code/s16_team_protocols/README.md:43`、`learn-claude-code/s16_team_protocols/README.md:87`、`learn-claude-code/s16_team_protocols/README.md:114`。

## 18. 空闲等待要优先处理 shutdown/控制消息

- 能力简介：自治 agent 空闲时轮询 inbox 和任务板，shutdown_request 优先于普通工作。
- 能给 feng 带来什么帮助：feng 的长任务状态机必须有 clean stop、blocked、budget reached 等控制路径；控制事件不能被普通 grow 消息淹没。
- 目标位置：`learn-claude-code/s17_autonomous_agents/README.md:23`、`learn-claude-code/s17_autonomous_agents/README.md:37`、`learn-claude-code/s17_autonomous_agents/README.md:73`、`learn-claude-code/s17_autonomous_agents/README.md:267`。

## 19. Worktree 隔离用于候选变更，不用于默认复杂化

- 能力简介：git worktree 给并行任务独立目录和分支，remove 默认拒绝丢未提交改动，keep 用于人工 review。
- 能给 feng 带来什么帮助：feng 的自迭代可先用 working tree candidate；未来多候选/并行探索再启用 worktree。关键思想是“失败现场保留、候选可审计”，而不是强制回滚。
- 目标位置：`learn-claude-code/s18_worktree_isolation/README.md:27`、`learn-claude-code/s18_worktree_isolation/README.md:91`、`learn-claude-code/s18_worktree_isolation/README.md:110`、`learn-claude-code/s18_worktree_isolation/README.md:180`。

## 20. MCP 是外接工具协议，不是 self 核心

- 能力简介：外部 server 通过标准协议提供 tools/list 和 tools/call，工具进入统一 tool pool 并用 `mcp__server__tool` 命名。
- 能给 feng 带来什么帮助：feng 的初始工具保持四个；未来外部能力可以作为 tool adapter 接入 active tool pack，但不能让 MCP 配置和密钥污染 self repo。
- 目标位置：`learn-claude-code/s19_mcp_plugin/README.md:27`、`learn-claude-code/s19_mcp_plugin/README.md:95`、`learn-claude-code/s19_mcp_plugin/README.md:113`、`learn-claude-code/s19_mcp_plugin/README.md:229`。

## 21. 动态 Tool Pool 会影响缓存边界

- 能力简介：连接 MCP 后工具池改变，旧 prompt/tool cache 失效；Claude Code 对内置和 MCP 工具排序以保护缓存断点。
- 能给 feng 带来什么帮助：feng 的 cache key 必须包含 active_tool_pack_hash；tool growth 后不能误用旧缓存，也不能每轮全量暴露工具。
- 目标位置：`learn-claude-code/s19_mcp_plugin/README.md:117`、`learn-claude-code/s19_mcp_plugin/README.md:131`、`learn-claude-code/s19_mcp_plugin/README.md:215`、该章节源码示例的动态 tool pool 片段。

## 22. 所有机制最后必须回到同一个 Loop

- 能力简介：工具、权限、技能、记忆、压缩、后台、调度、团队、worktree、MCP 都挂在同一个 while loop 的不同位置。
- 能给 feng 带来什么帮助：这是防止架构膨胀的核心检查项。feng 可以增长能力，但不能长出第二套控制流。
- 目标位置：`learn-claude-code/s20_comprehensive/README.md:7`、`learn-claude-code/s20_comprehensive/README.md:41`、`learn-claude-code/s20_comprehensive/README.md:55`、`learn-claude-code/s20_comprehensive/README.md:250`。

## 23. Skill 文件的 frontmatter 足够表达能力入口

- 能力简介：SKILL.md 用 name/description 做轻量索引，正文保存详细工作流或知识。
- 能给 feng 带来什么帮助：feng skill 可以从更小的能力契约开始，先把 when/goal/context/tools/output/checks 结构化；description 进入稳定索引，正文按需加载。
- 目标位置：`learn-claude-code/skills/agent-builder/SKILL.md:2`、`learn-claude-code/skills/agent-builder/SKILL.md:35`、`learn-claude-code/skills/code-review/SKILL.md:2`、`learn-claude-code/skills/mcp-builder/SKILL.md:2`。

## 24. Progressive Complexity 是产品原则

- 能力简介：从 3-5 个能力开始，只有当真实使用证明缺能力时才增加 planning、subagent、skill 等复杂性。
- 能给 feng 带来什么帮助：MVP 必须证明通用自迭代闭环，而不是一开始准备固定 skill、团队、cron、MCP；复杂性应该由 grow 沉淀出来。
- 目标位置：`learn-claude-code/skills/agent-builder/SKILL.md:35`、`learn-claude-code/skills/agent-builder/SKILL.md:41`、`learn-claude-code/skills/agent-builder/SKILL.md:47`、`learn-claude-code/skills/agent-builder/SKILL.md:65`。

## 对 feng 的取舍

应该 native 化进 MVP：

```text
单一 loop
tool registry + active tool pack
permission boundary
四个核心 hook 点
skill 两级加载
artifact 化 + context compact 管线
provider-neutral LLM 层
错误恢复最小集
文件化 state/events/artifacts
Git candidate/validated/tag
```

应该作为后续能力，不进入 MVP 核心：

```text
多 agent 团队
cron
MCP 完整 transport/OAuth
worktree 并行候选
复杂长期记忆
复杂任务图
后台任务完整生命周期
```

判断标准：

```text
能让 feng 白板孵化、长任务稳定、自迭代可运行的，进入 MVP。
只是增强并行性、生态性或高级协作的，放到 grow 之后再长。
```

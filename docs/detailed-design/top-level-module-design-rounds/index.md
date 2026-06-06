# 顶层模块设计轮次索引

本文索引 feng 顶层模块设计的 5 轮草稿与外部视角 review。最终设计见 `../top-level-module-design.md`。

## 输入约束

本轮详细设计继承以下已确认约束：

```text
feng 使用 TypeScript 编写。
feng 是 file-native 的智能行为成长系统。
feng 没有用户需要理解的 session 概念，一个 grow 单元是连续成长空间。
下一轮 LLM loop 使用的 message list 必须是文件化产物。
grow 的对象不是固定 LLM loop，而是目标行为、运行契约、感知方式、动作边界、观测和反馈路由。
hatch 产物不一定是 LLM agent，但必须带运行契约和验证证据。
如果 hatch 产物是 agent，必须有 Agent Runtime Kernel，而不是 prompt 包装。
反馈上报只能成为候选，不能无脑向上游吸收。
默认反馈路由 skill 是通用能力，但基础协议稳定，场景策略可 grow。
```

本轮参考的成熟 agent 设计原则：

```text
CodeWhale：typed state、tool evidence、runtime timeline、artifact/receipt、任务与验证证据。
opencode：durable inbox、context epoch、事件事实、投影历史、compaction 边界、tool registry scope。
Hermes：长期运行治理、durable state machine、heartbeat/reclaim、observer/action 分离、skill 生命周期。
Shinsekai：目标世界契约、输出事件协议、运行管线、导入导出和诊断。
AssistantAgent：Prompt Contributor、Experience 渐进披露、contract/package/trace 管理。
learn-claude-code：小 loop、大 harness、system prompt 分节、memory/skill 按需注入、background/cron/worktree 的位置。
```

## 轮次

```text
round-01.md：直接从概要对象映射模块，发现缺少基础设施和输入准入。
round-02.md：引入 foundation modules，发现仍偏 coding agent runtime。
round-03.md：分层 Grow Kernel / Execution / Hatch Runtime，发现扩展能力过早。
round-04.md：收敛到最小可信闭环，补依赖方向和数据归属。
round-05.md：确定最终 C2 模块集合和后续 spec 基础。
```

## 最终结论入口

最终顶层模块设计采用第 5 轮模块集合，见：

```text
docs/detailed-design/top-level-module-design.md
```

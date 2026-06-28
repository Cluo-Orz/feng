# feng 调研与概要设计完成度审计

## 已完成

```text
6 个仓库均完成至少 5 轮调研：
CodeWhale、opencode、hermes-agent、Shinsekai、AssistantAgent、learn-claude-code。

每轮都在 docs/agent-research-rounds.md 中记录：
看代码 -> 记笔记 -> 写小结 -> 再看代码。

调研总结已沉淀：
docs/agent-research-notes.md
docs/agent-design-learning-summary.md

feng 设计前 5 轮复习/草稿/反思已完成：
docs/feng-design-prep-rounds.md

系统概要设计已产出：
docs/feng-system-overview-design.md

长程任务与 agent kernel 补充已产出：
docs/feng-kernel-and-long-running-design.md

小说场景多层数据流案例已产出：
docs/feng-novel-case-flow.md

质量门禁与不能漏题原则已产出：
docs/feng-quality-gates.md

当前目标覆盖审计已产出：
docs/feng-goal-coverage-audit.md
```

## 关键约束检查

```text
保留了“防止 feng 变成被调研对象牵着走的拼装产品”的目标。
保留了 file-native 原则。
明确下一轮 message list 是文件化编译产物。
明确 feng 没有用户需要理解的 session 概念，一个 grow 单元是连续成长空间。
明确 grow 不等于固定 LLM loop。
明确 hatch 是 grow readiness 满足后的成型转换，不是绕过 grow 的并列用户动作。
明确 hatch 产物不一定是 LLM agent。
明确 feng 自身需要 Long-running Grow Kernel 来支撑长程 grow。
明确 hatch 产物如果是 agent，需要 Agent Runtime Kernel 作为质量底线。
明确 Grow Kernel、Agent Runtime Kernel 和 Runtime Contract 不能混成通用 agent 模板。
明确 feng -> xiaoshuo -> libai-chongshengle 的三层生命周期角色和数据流边界。
明确质量门禁必须由 grow 过程产出，而不是静态写死评分表。
明确每个 grow 单元需要目标覆盖表，未覆盖目标、材料或约束不能进入 ready_to_hatch。
明确 feng、xiaoshuo、libai-chongshengle 三层质量门禁责任不同。
明确反馈回流是候选采纳流程，不是自动上游吸收。
明确默认反馈路由 skill 的基础协议稳定、场景策略可 grow。
明确备份、重跑、清理或替换工作目录之前必须分析缓存命中率，并把低命中率视为 Message Compiler / Prompt Context Kernel 的系统层健康信号。
```

## 未做

```text
未进入具体目录结构设计。
未定义 JSON/YAML schema。
未定义完整 CLI。
未定义 provider/MCP adapter。
未定义 eval runner。
未实现代码。
未运行测试；本次主要是文档和概念/概要设计整理。
```

## 后续问题

```text
第一阶段 proof 应选择小说 agent 还是更窄的创作 agent。
Grow 单元最小文件集合需要详细设计。
Message Compiler 的输入/输出文件格式需要详细设计。
Grow Kernel 的状态机、attempt 记录和恢复策略需要详细设计。
Agent Runtime Kernel 的第一阶段适用范围需要决策。
小说场景的目录角色已概念化，但最终目录 schema 仍需详细设计。
质量门禁和目标覆盖表已概念化，但最终文件格式、评分器、eval runner 和人工验收方式仍需详细设计。
Feedback Router 的基础协议字段需要详细设计。
Hatch 能力包第一阶段形态需要决策。
哪些反馈必须人工确认后才能上游提议，需要策略设计。
缓存命中率分析的 artifact 位置、汇总口径、阶段归因和阻塞阈值需要在详细设计中固化。
```

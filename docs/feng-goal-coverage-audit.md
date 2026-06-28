# feng 当前目标覆盖审计

本文用于审计当前概念/概要设计是否覆盖本轮讨论形成的产品目标。它不是新设计，而是把要求、证据和剩余边界放到同一张表里，方便后续继续 loop 时不重复丢题。

## 审计口径

当前阶段仍然是概念梳理和概要设计阶段，不进入具体目录 schema、CLI、provider adapter、MCP adapter、eval runner 或实现代码。

因此，本文只检查：

```text
产品概念是否清楚。
关键约束是否被写入。
多层闭环是否有边界。
质量门禁是否作为 grow 产物被定义。
小说 case 是否能解释终态流程和数据流转。
当前仍未决的事项是否被明确保留到后续详细设计。
```

## 覆盖矩阵

| 要求 | 当前状态 | 证据 |
| --- | --- | --- |
| 文档定位为产品概念设计，后续可进入 README | 已覆盖 | `docs/product-concept.md` 开头定义概念阶段边界 |
| 不把用户说法和已有文档当成绝对正确，要从顶层判断可行性 | 已覆盖 | `docs/agent-design-learning-summary.md`、`docs/feng-design-prep-rounds.md`、`docs/product-concept.md` 的可行性和误区段落 |
| 防止 feng 变成被调研对象牵着走的拼装产品 | 已覆盖 | `docs/agent-design-learning-summary.md`、`docs/feng-kernel-and-long-running-design.md`、`docs/feng-design-completion-audit.md` |
| 完成 CodeWhale、opencode、Hermes、Shinsekai、AssistantAgent、learn-claude-code 至少 5 轮学习 | 已覆盖 | `docs/agent-research-rounds.md`、`docs/feng-design-completion-audit.md` |
| 对 feng 设计前完成 5 轮复习/草稿/反思 | 已覆盖 | `docs/feng-design-prep-rounds.md`、`docs/feng-design-completion-audit.md` |
| feng 不是普通 agent creator，而是智能行为成长系统 | 已覆盖 | `docs/product-concept.md`、`docs/feng-system-overview-design.md` |
| 产品表面要简单，不能变成沉重对话产品 | 已覆盖 | `docs/product-concept.md` 的核心体验、Grow/Hatch 交互心智、误区段落 |
| grow 是主过程，hatch 取决于 readiness，不是并列用户动作 | 已覆盖 | `docs/product-concept.md` 的 “Grow 与 Hatch 的交互心智”；`docs/feng-system-overview-design.md` 主闭环 |
| file-native：关键运行产物和下一轮 message list 都必须能找到 | 已覆盖 | `docs/product-concept.md` 的 File Native 原则；`docs/feng-system-overview-design.md` 的事实层/编译层 |
| feng 没有用户需要理解的 session；一个 grow 单元是连续成长空间 | 已覆盖 | `docs/product-concept.md`、`docs/feng-system-overview-design.md`、`docs/feng-design-completion-audit.md` |
| feng 自身需要长程任务能力 | 已覆盖 | `docs/feng-kernel-and-long-running-design.md`、`docs/feng-system-overview-design.md` |
| hatch 结果如果是 agent，需要优秀 agent kernel，而不是 prompt 壳 | 已覆盖 | `docs/feng-kernel-and-long-running-design.md`、`docs/product-concept.md` 的 Hatch Agent 质量底线 |
| Grow Kernel 和 Agent Runtime Kernel 不能混成通用 agent 模板 | 已覆盖 | `docs/feng-kernel-and-long-running-design.md`、`docs/feng-system-overview-design.md` |
| hatch 产物不一定是 LLM loop，可由目标世界决定形态 | 已覆盖 | `docs/product-concept.md` 的 Hatch；`docs/feng-system-overview-design.md` 的 Runtime Contract |
| 多层回流不能无脑吸收，上报只能是候选 | 已覆盖 | `docs/product-concept.md`、`docs/feng-system-overview-design.md` 的 Feedback Router |
| 默认反馈路由 skill 是通用默认能力，但基础协议稳定、场景策略可 grow | 已覆盖 | `docs/product-concept.md`、`docs/feng-system-overview-design.md` |
| feng -> xiaoshuo -> libai-chongshengle 的三层生命周期和数据流 | 已覆盖 | `docs/feng-novel-case-flow.md`、`docs/product-concept.md`、`docs/feng-system-overview-design.md` |
| 小说场景要说明终态运行流程 | 已覆盖 | `docs/feng-novel-case-flow.md` |
| 质量门禁必须明确，且“不能漏题” | 已覆盖 | `docs/feng-quality-gates.md`、`docs/product-concept.md`、`docs/feng-system-overview-design.md` |
| 质量门禁应该由 grow 过程产出，而不是人类替 feng 写死评分表 | 已覆盖 | `docs/feng-quality-gates.md`、`docs/product-concept.md`、`docs/feng-novel-case-flow.md` |
| xiaoshuo 是否合格、libai-chongshengle 是否合格要分层判断 | 已覆盖 | `docs/feng-quality-gates.md`、`docs/feng-novel-case-flow.md`、`docs/feng-system-overview-design.md` |
| 小说最终审美不能完全交给 agent 自判，早期需要作者/读者验收 | 已覆盖 | `docs/feng-quality-gates.md`、`docs/feng-novel-case-flow.md`、`docs/feng-system-overview-design.md` |

## 仍未进入详细设计的事项

这些不是当前概念阶段的失败项，而是后续详细设计要接住的内容：

```text
Grow 单元最小文件集合。
message list 文件格式和来源说明格式。
质量门禁和目标覆盖表的文件格式。
feedback router 基础协议字段。
hatch 包 manifest、目录布局和发布/回滚策略。
Agent Runtime Kernel 第一阶段能力范围。
小说 proof 的样例集、评分器、人工验收方式和回归测试方式。
CLI、provider adapter、MCP adapter、eval runner。
```

## 当前结论

概念/概要层面的核心目标已经被覆盖。当前文档已经能表达：

```text
feng 是什么。
feng 不是什么。
grow/hatch 的产品心智。
为什么 file-native。
为什么需要长程 grow kernel。
hatch agent 的内核底线。
多层回流如何避免污染上游。
小说场景的三层生命周期和数据流。
质量门禁如何由 grow 产出并防止漏题。
哪些问题必须留到后续详细设计。
```

下一轮如果继续推进，合理切面不再是继续扩展概念，而是选择一个详细设计入口：Grow 单元最小文件集合、message list 编译、quality gate 文件化、feedback router 协议，或小说 proof 的最小闭环。

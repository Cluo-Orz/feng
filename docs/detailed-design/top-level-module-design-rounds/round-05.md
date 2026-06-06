# 顶层模块设计 Round 05

## 依据回看

opencode 的 context epoch 和 durable inbox、CodeWhale 的 runtime timeline、Hermes 的状态机治理、learn-claude-code 的小 loop 大 harness，都指向同一结论：顶层模块设计必须围绕“状态事实 -> 活跃投影 -> 执行动作 -> 证据回写 -> 版本交付”组织。

## 草稿 v5

最终模块边界如下：

```text
1. Domain Model & Contracts
2. File-Native Store
3. Event Ledger & Projection
4. Artifact Registry
5. Policy & Capability Boundary
6. Skill Registry
7. Grow Unit Manager
8. Admission & Feedback Inbox
9. Agenda & DoD Manager
10. Context & Message Compiler
11. LLM Gateway
12. Tool Runtime
13. Grow Attempt Runner
14. Evidence & Readiness
15. Hatch Builder
16. Runtime Contract Registry
17. Agent Runtime Kernel
18. Target World Adapter
19. Debug & Feedback Bridge
20. CLI
```

## 外部视角 Review

这个版本通过作为 C2 级顶层模块设计的要求：

```text
1. 它不是传统大而全架构图，而是围绕 feng 的核心产品闭环拆模块。
2. 它没有把用户心智变成 session、thread、task board 或 agent marketplace。
3. 它保留了 TypeScript 项目的 typed boundary。
4. 它能解释 file-native、message list、grow attempt、hatch、runtime feedback 的数据归属。
5. 它能自然支持小说 case，也能扩展到 boss、小车、音乐等目标世界。
```

仍然要在最终设计中明确：

```text
Background/cron/local API 属于后续扩展，不进入第一阶段核心模块。
具体目录结构、schema、provider、MCP、eval runner 仍留给模块 spec 或后续实现设计。
每个模块 spec 必须按 SDD 风格写终态事实，并至少经过 3 轮检测和调整。
```

## 进入最终顶层模块设计的结论

最终 C2 级设计应采用第 5 轮模块集合。模块数量看起来不小，但每个模块都有明确理由：它们不是功能堆叠，而是为 file-native 成长闭环提供不可混淆的职责边界。

最重要的依赖方向：

```text
所有模块依赖 Domain Model & Contracts。
所有持久化通过 File-Native Store、Event Ledger、Artifact Registry。
模型可见上下文只由 Context & Message Compiler 生成。
Grow Attempt Runner 只能编排，不能私自决定 readiness 或 hatch。
Agent Runtime Kernel 只能运行 hatch 产物，不能绕过 Feedback Router 改写 grow。
Feedback 只能先进入 Admission & Feedback Inbox，再由 Grow Unit Manager 和 Feedback policy 采纳。
```

这组边界是后续分模块 SDD spec 的基础。
